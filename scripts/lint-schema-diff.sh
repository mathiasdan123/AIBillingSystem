#!/usr/bin/env bash
#
# Schema diff safety linter
#
# Companion to scripts/lint-migrations.sh, which scans migrations/*.sql.
#
# WHY THIS EXISTS: production schema changes are applied by
# `drizzle-kit push --force` (see .github/workflows/deploy.yml), which diffs
# shared/schema.ts against the live DB and applies the DDL directly. It never
# reads migrations/*.sql. So lint-migrations.sh — which only ever sees that
# directory — has never inspected a single production schema change.
#
# This script closes that gap by linting the thing that actually runs: the
# DDL implied by the change to shared/schema.ts.
#
# HOW: drizzle-kit's own differ is used, so this stays correct as the schema
# grows and there is no hand-rolled TypeScript parsing to drift.
#
#   1. materialise shared/schema.ts as of the base commit
#   2. `drizzle-kit generate` on it   -> snapshot of the OLD schema
#   3. `drizzle-kit generate` on HEAD -> SQL diff, old -> new
#   4. hand that SQL to lint-migrations.sh
#
# `generate` is entirely offline — no database connection is made, so this is
# safe to run in CI and never touches production.
#
# Usage:
#   scripts/lint-schema-diff.sh              # auto-detect base ref
#   BASE_REF=abc123 scripts/lint-schema-diff.sh
#
# Override: same mechanism as lint-migrations.sh — put
#   -- migration-lint: ignore (reason: ...)
# in a committed migrations/*.sql file, or set SCHEMA_LINT_SKIP=1 for a
# genuine emergency (it is recorded in the CI log either way).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SCHEMA_PATH="shared/schema.ts"
TMPDIR_REL=".schema-lint-tmp"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED=$'\033[0;31m'; YELLOW=$'\033[0;33m'; GREEN=$'\033[0;32m'
  RESET=$'\033[0m'; BOLD=$'\033[1m'
else
  RED=''; YELLOW=''; GREEN=''; RESET=''; BOLD=''
fi

cleanup() { rm -rf "$REPO_ROOT/$TMPDIR_REL"; }
trap cleanup EXIT

if [ "${SCHEMA_LINT_SKIP:-0}" = "1" ]; then
  echo "${YELLOW}⊘${RESET} schema diff lint SKIPPED via SCHEMA_LINT_SKIP=1"
  exit 0
fi

# ---------------------------------------------------------------- base ref --
# PR builds diff against the target branch; push builds against the previous
# commit. BASE_REF wins if the caller sets it.
if [ -n "${BASE_REF:-}" ]; then
  base="$BASE_REF"
elif [ -n "${GITHUB_BASE_REF:-}" ]; then
  base="origin/$GITHUB_BASE_REF"
else
  base="HEAD~1"
fi

if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  echo "${YELLOW}⊘${RESET} base ref '$base' not resolvable — cannot diff."
  echo "  If this is CI, ensure actions/checkout uses fetch-depth: 0."
  echo "  Treating as a hard failure so the gap is never silently skipped."
  exit 1
fi

# Merge-base keeps us honest on a branch that trails main.
if merge_base=$(git merge-base "$base" HEAD 2>/dev/null); then
  base="$merge_base"
fi

if ! git cat-file -e "$base:$SCHEMA_PATH" 2>/dev/null; then
  echo "${YELLOW}⊘${RESET} $SCHEMA_PATH does not exist at $base — nothing to diff."
  exit 0
fi

# ------------------------------------------------------------- fast path ----
if git diff --quiet "$base" HEAD -- "$SCHEMA_PATH"; then
  echo "${GREEN}✓${RESET} $SCHEMA_PATH unchanged since ${base:0:12} — nothing to lint."
  exit 0
fi

echo "Linting $SCHEMA_PATH diff against ${base:0:12}…"

# --------------------------------------------------------------- generate ---
rm -rf "$TMPDIR_REL"
mkdir -p "$TMPDIR_REL/out"

# The base copy must live inside the repo so drizzle-kit resolves
# drizzle-orm / drizzle-zod / zod from ./node_modules.
git show "$base:$SCHEMA_PATH" > "$TMPDIR_REL/schema-base.ts"

write_config() {
  cat > "$TMPDIR_REL/cfg.ts" <<EOF
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  out: "./$TMPDIR_REL/out",
  schema: "$1",
  dialect: "postgresql",
});
EOF
}

# Step 1 — snapshot the OLD schema. Its SQL is a full CREATE dump we discard;
# only the meta/ snapshot it leaves behind matters.
write_config "./$TMPDIR_REL/schema-base.ts"
if ! npx drizzle-kit generate --config="$TMPDIR_REL/cfg.ts" </dev/null >"$TMPDIR_REL/gen-base.log" 2>&1; then
  echo "${RED}✗${RESET} could not generate baseline snapshot from $base"
  cat "$TMPDIR_REL/gen-base.log"
  exit 1
fi
rm -f "$TMPDIR_REL"/out/*.sql

# Step 2 — diff HEAD against that snapshot.
write_config "./$SCHEMA_PATH"
if ! npx drizzle-kit generate --config="$TMPDIR_REL/cfg.ts" </dev/null >"$TMPDIR_REL/gen-head.log" 2>&1; then
  echo "${RED}✗${RESET} could not generate diff for HEAD $SCHEMA_PATH"
  cat "$TMPDIR_REL/gen-head.log"
  exit 1
fi

shopt -s nullglob
sqls=("$TMPDIR_REL"/out/*.sql)
shopt -u nullglob

# FAIL CLOSED when no SQL was produced.
#
# "No .sql file" is ambiguous, and the ambiguity is dangerous. It means either
# (a) the change genuinely implies no DDL, or (b) drizzle-kit stopped at an
# interactive prompt. A column or table rename is ambiguous to the differ, so
# it asks:
#
#     Is tax_id_v2 column in practices table created or renamed from another column?
#
# With stdin closed — as in CI — it takes no answer, writes nothing, and still
# exits 0. Reading that as "safe" would wave through exactly the rename that
# CLAUDE.md lists as a rolling-deploy breaker. (Same exit-0-on-abort behaviour
# as `push`; see docs/migration-safety-gap.md.)
#
# So a clean bill of health requires drizzle-kit to say so affirmatively.
if [ ${#sqls[@]} -eq 0 ]; then
  if grep -qi 'created or renamed from' "$TMPDIR_REL/gen-head.log"; then
    echo "${RED}✗${RESET} ${BOLD}Ambiguous rename detected in $SCHEMA_PATH.${RESET}"
    echo
    grep -i -A 3 'created or renamed from' "$TMPDIR_REL/gen-head.log" \
      | sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g' | sed 's/^/    /'
    cat <<EOF

A rename cannot be applied safely during a rolling deploy: old tasks still
reading the previous name will error until they are replaced.

Use expand → migrate → contract (CLAUDE.md): add the new column, deploy code
that writes both and reads either, backfill, deploy code reading only the new
name, then drop the old one.
EOF
    exit 1
  fi

  if grep -q 'No schema changes, nothing to migrate' "$TMPDIR_REL/gen-head.log"; then
    echo "${GREEN}✓${RESET} $SCHEMA_PATH changed but implies no DDL (types, Zod schemas, comments)."
    exit 0
  fi

  echo "${RED}✗${RESET} drizzle-kit produced no SQL and did not report a clean no-op."
  echo "  Refusing to assume this is safe. Raw output:"
  sed 's/^/    /' "$TMPDIR_REL/gen-head.log" | tail -20
  exit 1
fi

echo
echo "${BOLD}DDL this change will apply to production:${RESET}"
sed 's/^/    /' "${sqls[@]}"
echo

# ------------------------------------------------------------------- lint ---
# Reuse the existing pattern set so there is one definition of "breaking".
if bash scripts/lint-migrations.sh "${sqls[@]}"; then
  echo "${GREEN}✓${RESET} schema diff is safe for a rolling deploy."
  exit 0
fi

cat <<EOF

${RED}${BOLD}This change alters production schema destructively.${RESET}

It reached this check because ${BOLD}drizzle-kit push --force${RESET} in the deploy
workflow applies whatever shared/schema.ts implies — including data loss.
Adding a file under migrations/ will NOT prevent it; that directory is not
what production reads.

Use expand → migrate → contract (CLAUDE.md), or see
docs/migration-safety-gap.md for the full picture.
EOF
exit 1
