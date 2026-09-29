#!/usr/bin/env bash
# =============================================================================
# 03-regenerate-baseline.sh — rebuild migrations/ + migrations/meta as a
# fresh single baseline generated from shared/schema.ts.
# (Step 3 of docs/migration-safety-gap.md.)
#
# What it does:
#   1. Archives the current (dead, frozen-at-2026-03-10) migrations/
#      directory to work/migrations-archive-original/ — one time only.
#      Git history is the real archive; this copy is a local convenience.
#   2. Empties migrations/*.sql and migrations/meta/.
#   3. Runs `npx drizzle-kit generate --name baseline`, producing
#      migrations/0000_baseline.sql + a meta/ snapshot that reflects
#      shared/schema.ts as of HEAD (i.e. reality, not 2026-03-10).
#   4. Lints the generated SQL with scripts/lint-migrations.sh and prints
#      exactly what changed.
#
# ⚠️  PRODUCTION SAFETY
#   `drizzle-kit generate` is entirely OFFLINE — it opens no database
#   connection (same property scripts/lint-schema-diff.sh relies on in CI).
#   A DATABASE_URL is still required on the command line because
#   drizzle.config.ts refuses to load without one, and we validate it with
#   the same anti-production guard as every other script so that a prod URL
#   can never even sit in this process's environment.
#
# Idempotent: re-running wipes and regenerates the baseline again. The
# original pre-reconciliation migrations are archived only once (detected
# by a legacy marker file), so re-runs cannot clobber the archive.
#   NOTE: re-running AFTER you have already produced the journal INSERT
#   (script 05) changes the baseline's hash/timestamp — re-run 05 too.
#
# Usage:
#   scripts/migration-reconciliation/03-regenerate-baseline.sh \
#     --i-am-on-a-restored-copy '<restored-copy-DATABASE_URL>'
# =============================================================================
set -euo pipefail

# shellcheck source=_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
require_restored_copy_flag "$@"

DB_URL=""
for arg in "$@"; do
  [ "$arg" = "--i-am-on-a-restored-copy" ] && continue
  if [ -n "$DB_URL" ]; then
    die "unexpected extra argument. Usage:
   03-regenerate-baseline.sh --i-am-on-a-restored-copy '<restored-copy-DATABASE_URL>'"
  fi
  DB_URL="$arg"
done
assert_not_prod_url "$DB_URL"

MIGRATIONS_DIR="$REPO_ROOT/migrations"
ARCHIVE_DIR="$WORK_DIR/migrations-archive-original"
LEGACY_MARKER="$MIGRATIONS_DIR/0000_modern_scarlet_witch.sql"   # first entry of the frozen 2026-03 journal

[ -d "$MIGRATIONS_DIR" ] || die "migrations/ not found — run from the repo checkout."
[ -f "$REPO_ROOT/shared/schema.ts" ] || die "shared/schema.ts not found."
[ -d "$REPO_ROOT/node_modules/drizzle-kit" ] || die "drizzle-kit not installed — run npm ci first."

mkdir -p "$WORK_DIR"

# ---- 1. one-time archive of the original directory --------------------------
if [ -f "$LEGACY_MARKER" ]; then
  if [ -d "$ARCHIVE_DIR" ]; then
    echo "• archive already exists at $ARCHIVE_DIR — leaving it untouched."
  else
    cp -R "$MIGRATIONS_DIR" "$ARCHIVE_DIR"
    echo "• archived original migrations/ -> $ARCHIVE_DIR"
  fi
else
  echo "• migrations/ no longer contains the legacy files (already regenerated?) — skipping archive."
fi

# ---- 2. wipe ----------------------------------------------------------------
BEFORE_COUNT=$(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
rm -f "$MIGRATIONS_DIR"/*.sql
rm -rf "$MIGRATIONS_DIR/meta"
echo "• removed $BEFORE_COUNT old .sql file(s) and migrations/meta/."

# ---- 3. generate ------------------------------------------------------------
echo "• running drizzle-kit generate (offline — no DB connection is made)…"
# DATABASE_URL is scoped to this single command; it never leaks into the
# surrounding shell. drizzle.config.ts only uses it for commands that
# actually connect, which generate does not.
( cd "$REPO_ROOT" && DATABASE_URL="$DB_URL" DIRECT_URL="" \
    npx drizzle-kit generate --name baseline </dev/null )

BASELINE_SQL="$MIGRATIONS_DIR/0000_baseline.sql"
[ -f "$BASELINE_SQL" ] || die "expected $BASELINE_SQL was not created — inspect drizzle-kit output above."
[ -f "$MIGRATIONS_DIR/meta/_journal.json" ] || die "migrations/meta/_journal.json was not created."

# ---- 4. report --------------------------------------------------------------
STMTS=$(grep -c -- '--> statement-breakpoint' "$BASELINE_SQL" || true)
TABLES=$(grep -c 'CREATE TABLE' "$BASELINE_SQL" || true)
INDEXES=$(grep -c 'CREATE .*INDEX' "$BASELINE_SQL" || true)
ENUMS=$(grep -c 'CREATE TYPE' "$BASELINE_SQL" || true)
FKS=$(grep -c 'FOREIGN KEY' "$BASELINE_SQL" || true)

echo
echo "• linting the generated baseline with scripts/lint-migrations.sh…"
# A from-scratch baseline is pure CREATE statements; if the linter flags
# anything here, stop and understand why before proceeding.
( cd "$REPO_ROOT" && bash scripts/lint-migrations.sh "migrations/0000_baseline.sql" )

cat <<EOF

✓ Baseline regenerated.

  What changed under migrations/:
    - ALL previous .sql files deleted ($BEFORE_COUNT of them; archived at
      $ARCHIVE_DIR and, permanently, in git history)
    - meta/ snapshots replaced (were frozen at 2026-03-10)
    + 0000_baseline.sql        ($STMTS statements: $TABLES CREATE TABLE,
                                $ENUMS CREATE TYPE, $INDEXES CREATE INDEX,
                                $FKS FOREIGN KEY refs)
    + meta/0000_snapshot.json  (snapshot of shared/schema.ts as of HEAD)
    + meta/_journal.json       (single entry, tag "0000_baseline")

  Review with:  git -C "$REPO_ROOT" status migrations/
                git -C "$REPO_ROOT" diff --stat -- migrations/

  ⚠️  0000_baseline.sql is generated from shared/schema.ts ONLY. Objects
  that exist in prod but are NOT modelled in schema.ts (RLS policies,
  triggers, functions from the old hand-written migrations) are absent
  here BY DESIGN — 04-verify-noop.sh surfaces them for eyeballing.

Next: 04-verify-noop.sh
EOF
