#!/usr/bin/env bash
# =============================================================================
# 02-capture-schema.sh — capture the TRUE current schema from the RESTORED
# COPY of the production snapshot. (Step 2 of docs/migration-safety-gap.md.)
#
# Runs:  pg_dump --schema-only  against the URL you pass — and ONLY that URL.
#
# ⚠️  PRODUCTION SAFETY
#   * The URL must be passed explicitly on the command line. There is no
#     environment fallback and no default — an empty URL is refused.
#   * The URL is checked against the production host conventions
#     (therapybill-db, therapybillai.com, any *.rds.amazonaws.com endpoint
#     not containing "baseline-restore") and hard-refused on match.
#     See _lib.sh for the exact rules. There is no override flag.
#   * pg_dump --schema-only reads catalogs only; it never reads table data,
#     so no PHI leaves the database. The output is still kept out of git
#     (work/ directory) as a matter of hygiene.
#
# Idempotent: re-running rotates the previous capture to a timestamped
# file and writes a fresh work/prod-schema-captured.sql.
#
# Usage:
#   scripts/migration-reconciliation/02-capture-schema.sh \
#     --i-am-on-a-restored-copy \
#     'postgres://user:pass@therapybill-baseline-restore-YYYYMMDD.xxxx.us-east-1.rds.amazonaws.com:5432/therapybill?sslmode=require'
# =============================================================================
set -euo pipefail

# shellcheck source=_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
require_restored_copy_flag "$@"

# ---- collect the URL argument (any arg that is not the flag) ----------------
DB_URL=""
for arg in "$@"; do
  [ "$arg" = "--i-am-on-a-restored-copy" ] && continue
  if [ -n "$DB_URL" ]; then
    die "unexpected extra argument. Usage:
   02-capture-schema.sh --i-am-on-a-restored-copy '<restored-copy-DATABASE_URL>'"
  fi
  DB_URL="$arg"
done

# HARD GATE — refuses empty URLs and production host patterns. See _lib.sh.
assert_not_prod_url "$DB_URL"

command -v pg_dump >/dev/null 2>&1 || die "pg_dump not found on PATH.
   Install PostgreSQL client tools with a major version >= the server's
   (check with: psql '<url>' -c 'show server_version')."

mkdir -p "$WORK_DIR"
OUT="$WORK_DIR/prod-schema-captured.sql"

# ---- idempotency: rotate any previous capture -------------------------------
if [ -f "$OUT" ]; then
  ROTATED="$WORK_DIR/prod-schema-captured.$(date +%Y%m%d-%H%M%S).sql"
  mv "$OUT" "$ROTATED"
  echo "• previous capture rotated to: $ROTATED"
fi

echo "• capturing schema (pg_dump --schema-only) from the restored copy…"
echo "  (server version: $(psql "$DB_URL" -At -c 'show server_version' 2>/dev/null || echo 'unknown — psql missing?'))"

# --no-owner / --no-privileges: role ownership and GRANTs are RDS-specific
# noise that drizzle never manages; excluding them keeps the later diff
# (04-verify-noop.sh) focused on real schema objects.
pg_dump "$DB_URL" \
  --schema-only \
  --no-owner \
  --no-privileges \
  --file "$OUT"

LINES=$(wc -l < "$OUT" | tr -d ' ')
TABLES=$(grep -c '^CREATE TABLE' "$OUT" || true)

cat <<EOF

✓ Captured: $OUT
    lines:  $LINES
    tables: $TABLES   (shared/schema.ts defines ~134 as of 2026-09 — a large
                       mismatch here means you dumped the wrong database)

This file is the ground truth for step 4 (04-verify-noop.sh) and the
human-readable record of what production's schema actually was on
$(date +%Y-%m-%d). Do NOT commit it — work/ stays local.

Next: 03-regenerate-baseline.sh
EOF
