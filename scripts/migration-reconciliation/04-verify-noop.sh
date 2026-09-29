#!/usr/bin/env bash
# =============================================================================
# 04-verify-noop.sh — verify that the regenerated baseline is a NO-OP
# against real production state. (Step 4 of docs/migration-safety-gap.md —
# "the step that needs human eyes". This script automates the mechanical
# comparison as far as drizzle-kit allows, then prints exactly what remains
# for a human to eyeball.)
#
# Why it works this way: drizzle-kit has no dry-run/plan mode against a
# live database (push applies, generate is offline), so "would the baseline
# reproduce prod?" is answered empirically:
#
#   1. Create a SCRATCH database (baseline_noop_verify) on the SAME
#      restored instance — same server version, same defaults, zero
#      false diffs from version skew.
#   2. Apply migrations/0000_baseline.sql to the scratch database.
#   3. Compare scratch vs the restored copy, category by category,
#      straight from the catalogs (order-independent, unlike diffing raw
#      pg_dump output):
#        MUST MATCH  — tables, columns, enums. Any diff here = genuine
#                      drift between shared/schema.ts and prod, or a
#                      generation artifact. HARD FAIL until understood.
#        REVIEW      — indexes, constraints, sequences, views. Prod has
#                      hand-written performance indexes etc. that
#                      schema.ts may not model; each diff line needs a
#                      human verdict (keep-unmanaged / add-to-schema.ts).
#        EXPECTED    — functions, triggers, RLS policies. These came from
#                      the old hand-written migrations and are not
#                      modelled in schema.ts at all. drizzle will neither
#                      create nor drop them; listed for the record.
#
# ⚠️  PRODUCTION SAFETY
#   * URL passed explicitly; same hard anti-production guard as all
#     scripts (see _lib.sh). The only writes are DROP/CREATE of the
#     scratch database on the restored instance.
#   * The captured prod schema (02) is not consumed programmatically here
#     — the restored copy itself is the ground truth — but its presence is
#     asserted so the human artifact exists before anyone signs off.
#
# Idempotent: the scratch database is dropped and recreated on every run;
# all outputs under work/verify/ are rewritten.
#
# Usage:
#   scripts/migration-reconciliation/04-verify-noop.sh \
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
   04-verify-noop.sh --i-am-on-a-restored-copy '<restored-copy-DATABASE_URL>'"
  fi
  DB_URL="$arg"
done
assert_not_prod_url "$DB_URL"

command -v psql >/dev/null 2>&1 || die "psql not found on PATH."
command -v pg_dump >/dev/null 2>&1 || die "pg_dump not found on PATH."

BASELINE_SQL="$REPO_ROOT/migrations/0000_baseline.sql"
CAPTURED="$WORK_DIR/prod-schema-captured.sql"
[ -f "$BASELINE_SQL" ] || die "migrations/0000_baseline.sql missing — run 03-regenerate-baseline.sh first."
[ -f "$CAPTURED" ] || die "work/prod-schema-captured.sql missing — run 02-capture-schema.sh first."

SCRATCH_DB="baseline_noop_verify"
ADMIN_URL="$(url_with_db "$DB_URL" postgres)"
SCRATCH_URL="$(url_with_db "$DB_URL" "$SCRATCH_DB")"

VERIFY_DIR="$WORK_DIR/verify"
rm -rf "$VERIFY_DIR"
mkdir -p "$VERIFY_DIR"

# ---- 1. recreate scratch DB on the restored instance ------------------------
echo "• (re)creating scratch database '$SCRATCH_DB' on the restored instance…"
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $SCRATCH_DB;"
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE $SCRATCH_DB;"

# ---- 2. apply the baseline to scratch ---------------------------------------
# The '--> statement-breakpoint' markers are SQL comments; psql ignores them.
echo "• applying migrations/0000_baseline.sql to '$SCRATCH_DB'…"
if ! psql "$SCRATCH_URL" -q -v ON_ERROR_STOP=1 -f "$BASELINE_SQL" >"$VERIFY_DIR/apply-baseline.log" 2>&1; then
  echo
  echo "✗ The baseline SQL FAILED to apply cleanly to an empty database."
  echo "  That is a generation problem, not a drift problem. Log tail:"
  tail -20 "$VERIFY_DIR/apply-baseline.log" | sed 's/^/    /'
  exit 1
fi

# Human-readable artifact of what the baseline builds:
pg_dump "$SCRATCH_URL" --schema-only --no-owner --no-privileges \
  --file "$WORK_DIR/baseline-schema.sql"
echo "• baseline-built schema dumped to work/baseline-schema.sql"
echo "  (eyeball companion to work/prod-schema-captured.sql)"

# ---- 3. category-by-category catalog comparison -----------------------------
# snap <url> <outfile> <sql> — run a catalog query, sorted, machine-diffable.
snap() { psql "$1" -At -F '|' -v ON_ERROR_STOP=1 -c "$3" | LC_ALL=C sort > "$2"; }

Q_TABLES="SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND table_type='BASE TABLE'"
Q_COLUMNS="SELECT table_name, column_name, data_type,
                  coalesce(character_maximum_length::text,''),
                  coalesce(numeric_precision::text,''), is_nullable,
                  coalesce(column_default,'')
           FROM information_schema.columns WHERE table_schema='public'"
Q_ENUMS="SELECT t.typname, e.enumsortorder, e.enumlabel
         FROM pg_type t
         JOIN pg_enum e ON e.enumtypid=t.oid
         JOIN pg_namespace n ON n.oid=t.typnamespace
         WHERE n.nspname='public'"
Q_INDEXES="SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'"
Q_CONSTRAINTS="SELECT conrelid::regclass::text, conname, pg_get_constraintdef(c.oid)
               FROM pg_constraint c
               JOIN pg_namespace n ON n.oid=c.connamespace
               WHERE n.nspname='public'"
Q_SEQUENCES="SELECT sequence_name FROM information_schema.sequences
             WHERE sequence_schema='public'"
Q_VIEWS="SELECT table_name FROM information_schema.views WHERE table_schema='public'"
Q_FUNCTIONS="SELECT p.proname, pg_get_function_identity_arguments(p.oid)
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public'"
Q_TRIGGERS="SELECT DISTINCT event_object_table, trigger_name
            FROM information_schema.triggers WHERE trigger_schema='public'"
Q_POLICIES="SELECT tablename, policyname, coalesce(cmd,''), coalesce(roles::text,'')
            FROM pg_policies WHERE schemaname='public'"

# (No associative arrays — macOS ships bash 3.2. Plain case dispatch.)
CATEGORIES="tables columns enums indexes constraints sequences views functions triggers policies"

query_for() {
  case "$1" in
    tables)      printf '%s' "$Q_TABLES" ;;
    columns)     printf '%s' "$Q_COLUMNS" ;;
    enums)       printf '%s' "$Q_ENUMS" ;;
    indexes)     printf '%s' "$Q_INDEXES" ;;
    constraints) printf '%s' "$Q_CONSTRAINTS" ;;
    sequences)   printf '%s' "$Q_SEQUENCES" ;;
    views)       printf '%s' "$Q_VIEWS" ;;
    functions)   printf '%s' "$Q_FUNCTIONS" ;;
    triggers)    printf '%s' "$Q_TRIGGERS" ;;
    policies)    printf '%s' "$Q_POLICIES" ;;
    *) die "unknown category $1" ;;
  esac
}

severity_for() {
  case "$1" in
    tables|columns|enums)                 printf 'MUST-MATCH' ;;
    indexes|constraints|sequences|views)  printf 'REVIEW' ;;
    functions|triggers|policies)          printf 'EXPECTED' ;;
    *) die "unknown category $1" ;;
  esac
}

hard_fail=0
review_needed=0
expected_diffs=0

echo
echo "• comparing restored copy (= prod truth) vs scratch (= what the baseline builds)…"
echo
for cat in $CATEGORIES; do
  sev="$(severity_for "$cat")"
  snap "$DB_URL"      "$VERIFY_DIR/$cat.prod.txt"     "$(query_for "$cat")"
  snap "$SCRATCH_URL" "$VERIFY_DIR/$cat.baseline.txt" "$(query_for "$cat")"
  if diff -u \
      --label "prod/$cat (restored copy)" "$VERIFY_DIR/$cat.prod.txt" \
      --label "baseline/$cat (scratch)"   "$VERIFY_DIR/$cat.baseline.txt" \
      > "$VERIFY_DIR/$cat.diff" 2>&1; then
    printf '  %-12s %-12s clean — identical\n' "$cat" "[$sev]"
    rm -f "$VERIFY_DIR/$cat.diff"
  else
    n=$(grep -c '^[+-][^+-]' "$VERIFY_DIR/$cat.diff" || true)
    printf '  %-12s %-12s %s differing line(s) -> work/verify/%s.diff\n' \
      "$cat" "[$sev]" "$n" "$cat"
    case "$sev" in
      MUST-MATCH) hard_fail=1 ;;
      REVIEW)     review_needed=1 ;;
      EXPECTED)   expected_diffs=1 ;;
    esac
  fi
done

# ---- 4. verdict + the eyeball list ------------------------------------------
cat <<'EOF'

=============================================================================
 WHAT A HUMAN MUST NOW EYEBALL (this part cannot be automated)
=============================================================================
 1. Every work/verify/*.diff file, in this order of severity:
      MUST-MATCH (tables/columns/enums): a '-' line is an object prod has
        that the baseline would not create (real drift: schema.ts is
        behind prod, or someone hand-altered prod). A '+' line is an
        object the baseline creates that prod lacks (schema.ts is ahead —
        the next deploy would have pushed it anyway; decide: apply it
        during the window, or accept it rides the first post-cutover
        migration). NEITHER may be waved through without a written verdict.
      REVIEW (indexes/constraints/sequences/views): prod's hand-written
        performance indexes, audit-immutability constraints, etc. Verdict
        per line: "keep, unmanaged" (drizzle-kit migrate will never touch
        it) or "model it in schema.ts later".
      EXPECTED (functions/triggers/policies): RLS policies, updated_at
        triggers and helper functions from the old hand-written
        migrations. Confirm every line is one you recognize from
        migrations-archive-original/ — anything unrecognized is a finding.
 2. Spot-check work/prod-schema-captured.sql vs work/baseline-schema.sql
    for a handful of critical tables (patients, claims, audit_logs):
    column types, NOT NULL, defaults.
 3. Confirm the drizzle journal table situation on the restored copy:
      psql '<url>' -c "SELECT * FROM drizzle.__drizzle_migrations"
    (It may not exist — push never creates it. 05 handles both cases.)
=============================================================================
EOF

if [ "$hard_fail" -eq 1 ]; then
  echo "✗ NO-GO: MUST-MATCH categories differ. The baseline is NOT a no-op"
  echo "  against production. Resolve every tables/columns/enums diff"
  echo "  (fix shared/schema.ts and re-run 03, or document the manual prod"
  echo "  change) before proceeding to 05."
  exit 1
fi
if [ "$review_needed" -eq 1 ]; then
  echo "⚠ CONDITIONAL GO: core schema matches, but REVIEW diffs exist."
  echo "  Proceed to 05 only after writing a verdict for each line"
  echo "  (paste them into the maintenance-window notes)."
else
  echo "✓ Core schema and managed objects match exactly."
fi
[ "$expected_diffs" -eq 1 ] && echo "  (EXPECTED diffs listed above are informational — drizzle does not manage them.)"
echo
echo "Next: 05-print-mark-applied.sh"
