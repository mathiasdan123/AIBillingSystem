#!/usr/bin/env bash
#
# Migration safety linter
#
# Scans migrations/*.sql for breaking changes that cause downtime when
# old app tasks are still running during a rolling deploy. The fix for
# each pattern is the expand → migrate → contract approach (documented
# in CLAUDE.md under "Database migrations").
#
# Patterns flagged:
#   - DROP COLUMN          → old tasks still reading the column will crash
#   - ALTER COLUMN … NOT NULL  → old tasks not setting the column will crash
#   - RENAME COLUMN        → old tasks reading the old name will crash
#   - RENAME TO            → table rename, same problem
#   - DROP TABLE           → old tasks still reading the table will crash
#
# Exits non-zero if any breaking changes are found in changed migration
# files. Run as a pre-commit hook or in CI before merge.
#
# Usage:
#   scripts/lint-migrations.sh              # lint all migrations/
#   scripts/lint-migrations.sh path/to.sql  # lint specific files
#   scripts/lint-migrations.sh --staged     # lint only staged migrations
#
# Override (rare — for legitimate breaking changes deployed during a
# maintenance window): add a comment matching this regex anywhere in
# the file:  -- migration-lint: ignore (reason: ...)

set -e

# ANSI colors (skip if not a TTY)
if [ -t 1 ] && [ -z "$NO_COLOR" ]; then
  RED=$'\033[0;31m'
  YELLOW=$'\033[0;33m'
  GREEN=$'\033[0;32m'
  RESET=$'\033[0m'
  BOLD=$'\033[1m'
else
  RED=''; YELLOW=''; GREEN=''; RESET=''; BOLD=''
fi

# Resolve which files to lint.
declare -a files=()
if [ "$1" = "--staged" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] && files+=("$f")
  done < <(git diff --cached --name-only --diff-filter=ACM | grep '^migrations/.*\.sql$' || true)
elif [ $# -gt 0 ]; then
  files=("$@")
else
  while IFS= read -r f; do
    files+=("$f")
  done < <(find migrations -name '*.sql' -type f | sort)
fi

if [ ${#files[@]} -eq 0 ]; then
  echo "${GREEN}✓${RESET} No migration files to lint."
  exit 0
fi

# Patterns — each is a regex + label + recommendation.
declare -a patterns=(
  'DROP[[:space:]]+COLUMN|drop[[:space:]]+column'
  'SET[[:space:]]+NOT[[:space:]]+NULL|set[[:space:]]+not[[:space:]]+null'
  'RENAME[[:space:]]+COLUMN|rename[[:space:]]+column'
  'RENAME[[:space:]]+TO|rename[[:space:]]+to'
  'DROP[[:space:]]+TABLE|drop[[:space:]]+table'
)
declare -a labels=(
  'DROP COLUMN'
  'SET NOT NULL'
  'RENAME COLUMN'
  'RENAME TABLE'
  'DROP TABLE'
)
declare -a recs=(
  'Drop in two deploys: deploy code that no longer reads the column → then drop it in a follow-up migration.'
  'Three steps: add nullable → backfill data → set NOT NULL after every old task is gone.'
  'Add the new column → backfill → deploy code reading new name → drop the old column.'
  'Create a view at the old name pointing to the new table, ship for one release, then drop.'
  'Deploy code that no longer touches the table → drop it in a follow-up migration.'
)

problems=0
checked=0

for file in "${files[@]}"; do
  [ ! -f "$file" ] && continue
  checked=$((checked + 1))

  # Honor the override comment.
  if grep -qE '^[[:space:]]*--[[:space:]]*migration-lint:[[:space:]]*ignore' "$file"; then
    echo "${YELLOW}⊘${RESET} ${BOLD}$file${RESET} — lint disabled (override comment present)"
    continue
  fi

  file_problems=0
  for i in "${!patterns[@]}"; do
    pattern="${patterns[$i]}"
    label="${labels[$i]}"
    rec="${recs[$i]}"

    # Skip lines that are SQL comments. grep --invert-match ^[[:space:]]*--
    matches=$(grep -nE "$pattern" "$file" | grep -vE '^[0-9]+:[[:space:]]*--' || true)

    if [ -n "$matches" ]; then
      if [ $file_problems -eq 0 ]; then
        echo "${RED}✗${RESET} ${BOLD}$file${RESET}"
      fi
      file_problems=$((file_problems + 1))

      while IFS= read -r match; do
        line=$(echo "$match" | cut -d: -f1)
        echo "    ${RED}line $line${RESET}: $label"
      done <<< "$matches"
      echo "    ${YELLOW}fix:${RESET} $rec"
    fi
  done

  problems=$((problems + file_problems))
done

echo
if [ $problems -eq 0 ]; then
  echo "${GREEN}✓ ${checked} migration file(s) clean.${RESET}"
  exit 0
fi

echo "${RED}${BOLD}Found $problems breaking-change pattern(s) across $checked file(s).${RESET}"
echo
echo "All of these break old app tasks during a rolling deploy. Use the"
echo "expand → migrate → contract pattern (see CLAUDE.md). If you genuinely"
echo "need to ship the breaking change with a maintenance window, add this"
echo "comment to the migration file:"
echo
echo "    ${BOLD}-- migration-lint: ignore (reason: <why>)${RESET}"
echo
exit 1
