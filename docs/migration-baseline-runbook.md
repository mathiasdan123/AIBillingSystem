# Baseline reconciliation — maintenance window runbook

Executes steps 1–6 of [docs/migration-safety-gap.md](migration-safety-gap.md):
regenerate the drizzle migration baseline from real production state, mark it
applied, and switch the deploy pipeline from `drizzle-kit push --force` to
`drizzle-kit migrate`, so that CI's migration linter finally reviews the SQL
production actually runs.

All mechanical work is scripted in `scripts/migration-reconciliation/`
(numbered 01–05, each requiring `--i-am-on-a-restored-copy` and hard-refusing
production URLs). This document is the checklist that strings them together.
The window's job is to *execute a reviewed checklist*, not to think — anything
that requires thinking is a NO-GO and you abort (abort is always safe; see
rollback notes on every step).

**Production is touched exactly twice**, both in the second half:

1. Step S6b — one additive `INSERT` into a bookkeeping table
   (`drizzle.__drizzle_migrations`) the app never reads.
2. Step S7 — the normal deploy that fires when the cutover PR merges,
   whose migrate step must be a visible **no-op**.

Everything else runs against a restored copy of a prod snapshot.

---

## Roles, prerequisites, preconditions

| # | Prerequisite | Check |
|---|---|---|
| P1 | AWS CLI authenticated to account 773320320189, us-east-1, with RDS snapshot/restore/delete rights | `aws sts get-caller-identity` |
| P2 | A working host **inside the VPC** (bastion / SSM session) that can reach RDS on 5432 — the restored instance stays private | test with prod SG rules in mind before the window |
| P3 | `psql` + `pg_dump` client major version ≥ the prod server major version | compare `pg_dump --version` with `EngineVersion` from the 01 checklist preflight |
| P4 | Node 20 + `npm ci` completed on the repo checkout that will run scripts 03–05 (drizzle-kit 0.31.9 from the lockfile — the version whose migrate semantics scripts 05 relies on) | `npx drizzle-kit --version` |
| P5 | Repo checkout at the exact commit the cutover PR will contain — **main's HEAD, with a merge freeze in effect** (see P6). The baseline is generated from `shared/schema.ts` at this commit; a schema.ts merged mid-window invalidates it | `git fetch && git status` |
| P6 | **Merge freeze on main** for the whole window. Merging main deploys automatically; a mid-window deploy would run `push --force` against prod and could invalidate the captured schema. Post in Slack + pause any auto-merge PRs (`gh pr list --search "is:open"` → disable auto-merge) | |
| P7 | Draft cutover PR prepared **before** the window with the pipeline diffs from [Appendix A](#appendix-a--cutover-pr-diffs) (deploy.yml + Dockerfile). The baseline files (migrations/) are added to this branch during the window at S4 | `gh pr view` |
| P8 | Prod DB credentials (user/password/dbname) at hand — the restored copy uses the same ones | |
| P9 | Off-peak slot agreed. No customer-visible downtime is expected at any step, but S7 is a real deploy | Kelli/Megan pilot informed if during business hours |

## Timing budget (total ≈ 2–2.5 h, half of it waiting on AWS)

| Step | What | Est. | Prod impact |
|---|---|---|---|
| S1 | Snapshot prod RDS | 5–15 min (wait) | seconds of I/O pause (single-AZ) |
| S2 | Restore snapshot to temp instance | 10–20 min (wait) | none |
| S3 | Capture schema from restored copy | 5 min | none |
| S4 | Regenerate baseline, push to PR branch | 10 min | none |
| S5 | Verify no-op + **human eyeball** | 15–45 min | none |
| S6 | Mark applied: restored copy, then prod | 10 min | one INSERT |
| S7 | Merge cutover PR → deploy runs migrate as no-op | 20–30 min | normal deploy |
| S8 | Smoke test + verification | 10 min | none |
| S9 | Teardown restored instance | 5 min | none |

Abort at any point before S6b costs nothing but the window itself.

---

## S1 — Snapshot production

Run `scripts/migration-reconciliation/01-snapshot-checklist.sh
--i-am-on-a-restored-copy` and paste its **section 0–1** commands (the script
executes nothing itself). Record `PROD_DB_ID`, `EngineVersion`, and the
snapshot id `therapybill-baseline-YYYYMMDD`.

- **Go/no-go G1:** snapshot status `available`; P3 version check passes
  against the recorded `EngineVersion`.
- **Rollback:** none needed — a snapshot is inert. To abandon: delete it.

## S2 — Restore to a temporary instance

Paste the checklist's **section 2–3** commands. The instance identifier
**must** contain `baseline-restore` (scripts 02–05 refuse any other RDS
endpoint — that is the guardrail, do not fight it). Build the restored URL:

```
RESTORED_URL='postgres://<user>:<pass>@therapybill-baseline-restore-YYYYMMDD.<hash>.us-east-1.rds.amazonaws.com:5432/<dbname>?sslmode=require'
```

- **Go/no-go G2:** `psql "$RESTORED_URL" -c 'select count(*) from patients'`
  returns a plausible number (connectivity + right database).
- **Rollback:** delete the restored instance (checklist section 4). Nothing
  else has happened.

## S3 — Capture the true schema

```bash
scripts/migration-reconciliation/02-capture-schema.sh \
  --i-am-on-a-restored-copy "$RESTORED_URL"
```

Produces `scripts/migration-reconciliation/work/prod-schema-captured.sql`
(schema only — no data, no PHI; still never committed).

- **Go/no-go G3:** reported table count ≈ 122 (the script prints it and warns
  on gross mismatch).
- **Rollback:** none — read-only against the copy.

## S4 — Regenerate the baseline

On the cutover PR branch (P7), at frozen HEAD (P5):

```bash
scripts/migration-reconciliation/03-regenerate-baseline.sh \
  --i-am-on-a-restored-copy "$RESTORED_URL"
git add migrations/
git commit   # deletes all legacy migrations/*.sql + meta, adds 0000_baseline.sql
git push
```

(`drizzle-kit generate` is offline; the URL is required only so a production
URL can never sit in the environment.) The old migration files stay in git
history and in `work/migrations-archive-original/`.

- **Go/no-go G4:** script exits 0; `migrations/` now contains exactly
  `0000_baseline.sql` + `meta/`; lint-migrations passed (the script runs it).
- **Rollback:** `git checkout main -- migrations/` (or drop the commit).
  Nothing outside the repo changed.

## S5 — Verify the baseline is a no-op (THE human step)

```bash
scripts/migration-reconciliation/04-verify-noop.sh \
  --i-am-on-a-restored-copy "$RESTORED_URL"
```

The script builds the baseline into a scratch database **on the restored
instance** and compares catalogs category by category:

- **MUST-MATCH** (tables, columns, enums) — any diff is a hard NO-GO. A `-`
  line = prod object the baseline misses (schema.ts behind prod, or a manual
  prod change). A `+` line = schema.ts ahead of prod. Fix `shared/schema.ts`
  and re-run S4→S5, or abort and investigate after the window.
- **REVIEW** (indexes, constraints, sequences, views) — write a one-line
  verdict per diff line into the window notes: *keep-unmanaged* (migrate will
  never touch it) or *model-in-schema.ts-later*.
- **EXPECTED** (functions, triggers, RLS policies) — the hand-written
  migrations' objects (updated_at triggers, RLS policies, audit
  immutability). Confirm each is recognizable from
  `work/migrations-archive-original/`; anything unrecognized is a finding.

Then do the manual spot-checks the script prints (patients / claims /
audit_logs columns across the two dump files).

- **Go/no-go G5:** script exit 0, every REVIEW line has a written verdict,
  every EXPECTED line recognized. **If you cannot explain a line, you abort.**
- **Rollback:** none — the scratch DB lives on the disposable instance.

## S6 — Mark the baseline applied

```bash
scripts/migration-reconciliation/05-print-mark-applied.sh --i-am-on-a-restored-copy
```

The script computes the baseline's sha256 + journal timestamp and **prints**
(never runs) the commands. Then, by hand:

- **S6a — restored copy first.** Paste its section **B**: the psql insert
  against `$RESTORED_URL`, then `DATABASE_URL="$RESTORED_URL" npx drizzle-kit
  migrate`, which must apply **nothing**.
  - **Go/no-go G6:** migrate output shows no DDL, exit 0, and
    `drizzle.__drizzle_migrations` still has exactly the inserted row.
- **S6b — production.** Paste its section **C** against the production URL.
  This is the **first production write** of the procedure: additive
  bookkeeping only (`CREATE SCHEMA/TABLE IF NOT EXISTS` + one guarded
  `INSERT`); the app never reads the `drizzle` schema.
  - **Rollback:** section **D**'s DELETE — fully reverses S6b at any time.

⚠️ The printed hash is bound to the exact bytes of `0000_baseline.sql`
committed in S4. If the file changes after S6 (even reformatting), re-run 05
and redo S6a/S6b before S7.

## S7 — Cutover: merge the PR (final deploy.yml change)

The PR now contains: the regenerated `migrations/` (S4) **plus** the pipeline
diffs from [Appendix A](#appendix-a--cutover-pr-diffs), reviewed and committed
before the window (P7).

```bash
gh pr merge --auto --squash    # or merge directly once checks are green
```

Merging fires **Deploy to Production**. Watch the *Run pending DB migrations*
step: it now runs `npx drizzle-kit migrate`, which must report the baseline as
already applied and execute **no DDL** (that is what S6b bought). Then the
normal rollout + smoke test runs.

- **Go/no-go G7 (before merging):** CI green on the PR — `build` re-runs
  lint-migrations against the new baseline; S6b confirmed done; merge freeze
  still holding for everyone else.
- **Rollback (deploy step fails):** the workflow halts before rollout — old
  tasks keep serving; prod schema untouched. Revert the merge commit
  (restores `push --force`) and re-deploy; the S6b journal row is harmless to
  the old pipeline and should be **left in place** for the next attempt.
- **Rollback (post-rollout problems):** standard procedure — redeploy
  previous SHA via `workflow_dispatch`; no schema changed, so no DB rollback
  exists to perform. The S1 snapshot remains the anchor for catastrophe.

## S8 — Post-cutover verification

1. Deploy workflow green end-to-end, including its own smoke test +
   SHA check against `/api/health`.
2. Migration task log shows migrate ran and applied nothing.
3. `psql` (prod): `SELECT * FROM drizzle.__drizzle_migrations` — exactly the
   S6b row (id may differ from the restored copy; that is fine).
4. Manual smoke: log in, open patients list, open a claim (the 2026-05-27
   failure mode was a 500 on patients).

## S9 — Teardown and follow-ups

- Delete the restored instance (01 checklist section 4). **Keep the snapshot
  14 days.**
- Lift the merge freeze.
- Delete `scripts/migration-reconciliation/work/` if the notes are archived.
- Update `docs/migration-safety-gap.md` status to "remediated" with the date.
- Follow-up PRs (not in the window):
  - CLAUDE.md dev workflow: schema changes now require
    `npx drizzle-kit generate` and committing the migration for the linter to
    review; `npm run db:push` remains for **local** dev databases only.
  - Decide the fate of each S5 REVIEW verdict marked *model-in-schema.ts-later*.
  - Optionally add `"db:migrate": "drizzle-kit migrate"` to package.json.

---

## Appendix A — cutover PR diffs

Prepared before the window (P7), merged at S7. **Do not apply outside the
cutover PR** — running `migrate` before S6b marks the baseline applied would
attempt the whole baseline against prod, fail on the first `already exists`,
and halt the deploy (safe, but a wasted window).

### 1. `.github/workflows/deploy.yml` — the actual switch

```diff
-          OVERRIDES=$(printf '{"containerOverrides":[{"name":"%s","command":["sh","-c","npm run db:push -- --force"]}]}' "$CONTAINER")
+          OVERRIDES=$(printf '{"containerOverrides":[{"name":"%s","command":["sh","-c","npx drizzle-kit migrate"]}]}' "$CONTAINER")
```

Also rewrite the `⚠️ KNOWN GAP` comment block above that line (deploy.yml
lines ~126–157): the gap it documents is closed by this PR; keep the
2026-05-27 history note and the pointer to docs/migration-safety-gap.md, and
state the new invariant — *the deploy applies exactly the reviewed, linted
files in `migrations/`; if migrate exits non-zero the rollout halts.*

### 2. `Dockerfile` — migrate needs the migrations folder in the image

`drizzle-kit migrate` reads `migrations/` + `drizzle.config.ts` at runtime.
The production image (which the migration task reuses) currently copies only
the config and `shared/`:

```diff
 # Copy necessary config files
 COPY --from=builder /app/drizzle.config.ts ./
 COPY --from=builder /app/shared ./shared
+# drizzle-kit migrate applies reviewed SQL from migrations/ (journal in
+# migrations/meta). Without this COPY the migration task dies with
+# "Can't find meta/_journal.json".
+COPY --from=builder /app/migrations ./migrations
```

(`drizzle-kit` itself is in `dependencies`, so it survives
`npm ci --omit=dev` — no change needed there.)

The vestigial `migrate` build stage at the bottom of the Dockerfile (not used
by deploy.yml, which overrides the app task's command) should be updated in
the same PR so it cannot mislead:

```diff
 COPY drizzle.config.ts ./
 COPY shared ./shared
+COPY migrations ./migrations

-CMD ["npx", "drizzle-kit", "push", "--force"]
+CMD ["npx", "drizzle-kit", "migrate"]
```

### 3. What deliberately does NOT change

- `npm run db:push` stays in package.json — it is the right tool for a
  throwaway **local** dev database (`npm run dev:local`).
- `scripts/lint-migrations.sh` and `scripts/lint-schema-diff.sh` are already
  correct and already wired into CI; after this PR the former finally lints
  files that production executes.

---

## Appendix B — abort matrix (quick reference)

| Aborting after… | Do |
|---|---|
| S1–S5 | Delete restored instance; drop S4 commit; lift freeze. Prod untouched. |
| S6a | Same as above (restored copy is disposable). |
| S6b | Optionally run the printed DELETE; the row is harmless either way. |
| S7 merge, deploy failed at migrate step | Rollout never happened. Revert merge commit; leave journal row; retry another day. |
| S7 deploy succeeded, app misbehaves | Redeploy previous SHA (`workflow_dispatch`). Schema unchanged by design. |
