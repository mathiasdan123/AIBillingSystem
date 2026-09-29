#!/usr/bin/env bash
# =============================================================================
# 05-print-mark-applied.sh — compute and PRINT the __drizzle_migrations
# journal insert for the regenerated baseline. (Step 5 of
# docs/migration-safety-gap.md.)
#
# ⚠️  THIS SCRIPT NEVER EXECUTES SQL AND NEVER CONNECTS TO ANYTHING.
#     It reads two local files —
#       migrations/0000_baseline.sql        (hash = sha256 of its full text)
#       migrations/meta/_journal.json       (created_at = the "when" millis)
#     — and prints (a) the fully-substituted SQL, (b) the psql command that
#     runs the reviewed template 05-mark-applied.sql with those values, and
#     (c) the verification + reversal commands. A human pastes them: first
#     against the RESTORED COPY, and only after the migrate no-op check
#     passes there, against production (the single prod write of the whole
#     procedure — see runbook step S6).
#
# Idempotent: pure computation from files on disk; run any time. If
# 0000_baseline.sql changes AT ALL after you ran this, the printed hash is
# stale — run it again (the template's sanity checks cannot catch a stale
# hash, only a malformed one).
#
# Usage:
#   scripts/migration-reconciliation/05-print-mark-applied.sh --i-am-on-a-restored-copy
# =============================================================================
set -euo pipefail

# shellcheck source=_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
require_restored_copy_flag "$@"

BASELINE_SQL="$REPO_ROOT/migrations/0000_baseline.sql"
JOURNAL="$REPO_ROOT/migrations/meta/_journal.json"
[ -f "$BASELINE_SQL" ] || die "migrations/0000_baseline.sql missing — run 03-regenerate-baseline.sh first."
[ -f "$JOURNAL" ] || die "migrations/meta/_journal.json missing — run 03-regenerate-baseline.sh first."

# ---- hash: sha256 hex of the ENTIRE file text (drizzle-orm migrator does
#      createHash('sha256').update(<file contents>).digest('hex')) ----------
if command -v sha256sum >/dev/null 2>&1; then
  HASH=$(sha256sum "$BASELINE_SQL" | cut -d' ' -f1)
elif command -v shasum >/dev/null 2>&1; then
  HASH=$(shasum -a 256 "$BASELINE_SQL" | cut -d' ' -f1)
else
  die "need sha256sum or shasum on PATH."
fi

# ---- created_at: the journal entry's "when" (epoch millis). node is
#      guaranteed present (repo needs node >= 20), so parse JSON properly
#      instead of grepping. Also assert the journal has exactly ONE entry
#      tagged 0000_baseline — anything else means 03 didn't run cleanly. ---
WHEN=$(node -e '
  const j = require(process.argv[1]);
  if (!Array.isArray(j.entries) || j.entries.length !== 1 || j.entries[0].tag !== "0000_baseline") {
    console.error("journal does not contain exactly one 0000_baseline entry — re-run 03-regenerate-baseline.sh");
    process.exit(1);
  }
  console.log(j.entries[0].when);
' "$JOURNAL")

TEMPLATE="scripts/migration-reconciliation/05-mark-applied.sql"

cat <<EOF
=============================================================================
 JOURNAL INSERT — printed only. NOTHING has been executed or connected to.
=============================================================================

 Baseline file : migrations/0000_baseline.sql
 sha256 (hash) : $HASH
 when (millis) : $WHEN  ($(date -r $((WHEN / 1000)) 2>/dev/null || date -d "@$((WHEN / 1000))" 2>/dev/null || echo "epoch-ms $WHEN"))

 ⚠️ Valid ONLY for the exact bytes of 0000_baseline.sql as of right now.
    If that file changes (even whitespace) before it is committed and
    deployed, RE-RUN this script.

## A. The SQL this will run (via the reviewed template $TEMPLATE):

  CREATE SCHEMA IF NOT EXISTS "drizzle";
  CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
  );
  INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
  SELECT '$HASH', $WHEN
  WHERE NOT EXISTS (
    SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = '$HASH'
  );

## B. FIRST — run against the RESTORED COPY and prove migrate is a no-op:

  psql "\$RESTORED_URL" -v ON_ERROR_STOP=1 \\
    -v hash='$HASH' \\
    -v created_at='$WHEN' \\
    -f $TEMPLATE

  DATABASE_URL="\$RESTORED_URL" npx drizzle-kit migrate
    # EXPECTED: completes without executing any DDL (no CREATE/ALTER in
    # output, exit 0, and the row count in drizzle.__drizzle_migrations is
    # unchanged afterwards). If it tries to apply 0000_baseline, STOP —
    # the hash/created_at row did not take, or the file changed.

## C. ONLY THEN — the single production write of this procedure
##    (runbook step S6; requires the S5 go/no-go to have passed):

  psql "\$PRODUCTION_URL" -v ON_ERROR_STOP=1 \\
    -v hash='$HASH' \\
    -v created_at='$WHEN' \\
    -f $TEMPLATE

## D. Verify / revert:

  # verify (both DBs):
  psql "\$URL" -c 'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at'

  # revert (undoes everything this step did; harmless to the app, which
  # never reads the drizzle schema):
  psql "\$URL" -c "DELETE FROM drizzle.__drizzle_migrations WHERE hash = '$HASH'"

=============================================================================
 Next: runbook step S7 — merge the cutover PR (baseline + deploy.yml switch).
=============================================================================
EOF
