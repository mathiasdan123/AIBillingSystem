# Migration safety gap — findings and remediation plan

**Status:** open. Documentation fixed 2026-08-03; the underlying gap is unremediated.
**Owner:** unassigned. Needs a maintenance window.

## Summary

The zero-downtime migration linter does not guard production schema changes.
It never has. It scans a directory that nothing writes to, so it passes
vacuously on every PR while `drizzle-kit push --force` applies arbitrary DDL —
including `DROP COLUMN` — to production RDS.

## How the gap works

| Piece | What it does | Problem |
|---|---|---|
| `deploy.yml` "Run pending DB migrations" | one-off ECS task, `npm run db:push -- --force` | applies the schema.ts↔DB diff directly |
| `drizzle-kit push` | diffs `shared/schema.ts` against live DB, applies DDL | never reads `migrations/*.sql` |
| `migrations/*.sql` | 26 hand-written files | dead — last addition `e4b2ccb`, 2026-05-28 |
| `migrations/meta/` | drizzle snapshots + journal | frozen at 2026-03-10, journal has 2 entries |
| `lint-migrations.sh` (ci.yml:27) | scans `migrations/*.sql` for breaking patterns | scans the dead directory; passes vacuously |

Nothing in the repo runs `drizzle-kit generate` or `drizzle-kit migrate` —
`push` is the only drizzle-kit command wired up. `shared/schema.ts` has 122
tables and has been modified in 10 commits since the last `migrations/` entry,
none of which the linter saw.

`--force` is documented by drizzle-kit as: *"Auto-approve all data loss
statements. Note: Data loss statements may truncate your tables and data."*

**Net effect:** removing a column from `shared/schema.ts` drops it from
production, with CI green.

## Do not "fix" this by removing `--force`

Measured against drizzle-kit 0.31.9 with stdin closed, reproducing the ECS
task's non-interactive context:

| Scenario | Behaviour without `--force` | Exit code |
|---|---|---|
| Drop a column holding **no data** | dropped silently, no prompt | 0 |
| Drop a column holding **data** | warns, defaults to "No, abort", nothing applied | **0** |

The second row is the trap. The abort exits **0**, so the deploy step — which
gates on exit code under `set -euo pipefail` — reads it as success and rolls
the app forward. The abort also discards the *entire* push, so additive
changes bundled into the same diff are silently skipped too.

That converts a loud data-loss risk into a silent schema-drift risk, which is
exactly the 2026-05-27 failure mode (app deployed, columns didn't, patients
page 500s). Strictly worse in this pipeline. Leave `--force` in place until
the fix below lands.

## The fix: baseline reconciliation, then generate/migrate

The end state is that `lint-migrations.sh` reviews the SQL that actually runs:

- **PR time:** `drizzle-kit generate` writes real SQL into `migrations/`. The
  linter (already wired into CI, already correct) sees it and fails the PR on
  breaking patterns. Verified: a generated `ALTER TABLE ... DROP COLUMN`
  trips the linter, exit 1, no linter changes needed.
- **Deploy time:** `drizzle-kit migrate` applies exactly those reviewed files.
  No prompts, no schema-diffing against live state, no exit-0-on-abort.

The obstacle is the stale baseline. The meta snapshots describe the schema as
of 2026-03-10; production has drifted well past that via `push`. Running
`generate` today would diff against that stale snapshot and emit a huge
migration trying to re-create objects that already exist.

### Steps

1. **Snapshot production RDS.** Non-negotiable. Everything below is reversible
   only from this.
2. **Capture the true current schema.** `pg_dump --schema-only` against a
   restored copy of the prod snapshot — never against live prod.
3. **Regenerate the baseline.** Run `drizzle-kit generate` against the restored
   copy so the meta snapshot reflects reality rather than 2026-03-10.
4. **Diff the catch-up migration by hand.** This is the step that needs human
   eyes: confirm the generated SQL is a no-op against real prod state. Any
   statement that isn't already satisfied in prod is either genuine drift or a
   generation artifact, and must be understood before proceeding.
5. **Mark it applied without running it.** Insert the journal row into
   `__drizzle_migrations` so `migrate` treats the baseline as done. Verify
   against the restored copy first.
6. **Switch the deploy step** from `db:push -- --force` to `drizzle-kit
   migrate`, and add `generate` to the dev workflow in CLAUDE.md.
7. **Add a CI staleness check** so a schema.ts change with no corresponding
   `migrations/` entry fails the PR — otherwise the directory silently goes
   dead again and we are back here.

Steps 1–5 need a maintenance window and should not run unattended. Step 7 is
independently useful and could ship first.

## Interim mitigation

Until the above lands, destructive schema changes are caught only by human
review. When reviewing any PR touching `shared/schema.ts`, check for removed
or renamed columns/tables by hand — CI will not do it for you.
