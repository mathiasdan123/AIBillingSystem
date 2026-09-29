# shellcheck shell=bash
# =============================================================================
# _lib.sh — shared guards for the baseline-reconciliation scripts.
#
# Sourced (never executed) by every numbered script in this directory.
# See docs/migration-baseline-runbook.md for the full procedure and
# docs/migration-safety-gap.md for why this work exists.
#
# ⚠️  THE ONE RULE THESE GUARDS ENFORCE ⚠️
#
#   Nothing in scripts/migration-reconciliation/ may ever touch the
#   production database. Every step that needs a database runs against a
#   RESTORED COPY of a prod snapshot (created via the commands printed by
#   01-snapshot-checklist.sh). The only production write in the whole
#   procedure is the single journal-row INSERT, which is printed — never
#   executed — by 05-print-mark-applied.sh and pasted by a human.
#
# Two mechanisms enforce it:
#
#   1. require_restored_copy_flag — every script refuses to run unless the
#      operator passes --i-am-on-a-restored-copy. This is a deliberate
#      speed bump: typing it is your attestation that the DATABASE_URL you
#      are about to supply points at the restored copy.
#
#   2. assert_not_prod_url — fail-closed pattern check on the URL itself:
#        * empty URL                                  -> refused
#        * contains "therapybill-db"                  -> refused (prod RDS
#          instance identifier convention — every AWS resource in this
#          account is named therapybill-*; see .github/workflows/deploy.yml)
#        * contains "therapybillai.com"               -> refused (prod domain)
#        * host is *.rds.amazonaws.com AND does not contain
#          "baseline-restore"                         -> refused. RDS hosts
#          are only acceptable when they belong to the restored instance,
#          which 01-snapshot-checklist.sh instructs you to name
#          therapybill-baseline-restore-YYYYMMDD. Any other RDS endpoint is
#          assumed to be production or an unknown environment. There is no
#          override. If your restored instance is named differently, rename
#          it — do not edit this guard.
#
# Localhost / *.test / Docker URLs pass the pattern check (you may verify
# the procedure against a local restore first), but the flag is still
# required.
# =============================================================================

# --- die <msg...> : print to stderr and exit 1 ------------------------------
die() {
  printf '\n\033[0;31m✗ REFUSED:\033[0m %s\n\n' "$*" >&2
  exit 1
}

# --- require_restored_copy_flag "$@" ----------------------------------------
# Every numbered script must be invoked with --i-am-on-a-restored-copy.
# Even 01 (which only echoes AWS commands) requires it, so that the whole
# kit has one uniform invocation shape and nobody builds the habit of
# running these scripts bare.
require_restored_copy_flag() {
  local arg
  for arg in "$@"; do
    if [ "$arg" = "--i-am-on-a-restored-copy" ]; then
      return 0
    fi
  done
  die "missing required flag --i-am-on-a-restored-copy.
   These scripts operate only on a RESTORED COPY of the production
   snapshot (see scripts/migration-reconciliation/01-snapshot-checklist.sh
   and docs/migration-baseline-runbook.md). Passing the flag is your
   attestation that any DATABASE_URL you supply points at that copy,
   NOT at production."
}

# --- assert_not_prod_url <url> ----------------------------------------------
# Fail-closed check that <url> cannot plausibly be production.
assert_not_prod_url() {
  local url="${1:-}"
  local lc

  if [ -z "$url" ]; then
    die "DATABASE_URL is empty. Pass the restored copy's connection string
   explicitly as an argument. These scripts never fall back to the
   environment or to any default URL, so they can never 'accidentally'
   inherit the production DATABASE_URL from a shell or task definition."
  fi

  lc=$(printf '%s' "$url" | tr '[:upper:]' '[:lower:]')

  case "$lc" in
    *therapybill-db*)
      die "URL contains 'therapybill-db' — that is the production RDS
   instance naming convention. This kit never connects to production.
   Restore the snapshot to an instance named
   therapybill-baseline-restore-YYYYMMDD (see 01-snapshot-checklist.sh)
   and pass that endpoint instead." ;;
    *therapybillai.com*)
      die "URL contains 'therapybillai.com' — that is the production
   domain. This kit never connects to production." ;;
  esac

  if [[ "$lc" == *.rds.amazonaws.com* && "$lc" != *baseline-restore* ]]; then
    die "URL points at an RDS endpoint that is not a baseline-restore
   instance. Only endpoints containing 'baseline-restore' are accepted
   (01-snapshot-checklist.sh names the restored instance
   therapybill-baseline-restore-YYYYMMDD). Anything else on
   *.rds.amazonaws.com is treated as production. There is no override —
   if your restored instance is named differently, rename it."
  fi

  # Belt and braces: the URL must be a postgres URL with an explicit
  # database path, so later db-name surgery (04) is unambiguous.
  case "$lc" in
    postgres://*/*|postgresql://*/*) : ;;
    *)
      die "URL must be a postgres:// or postgresql:// URL including an
   explicit /dbname path, e.g.
   postgres://user:pass@therapybill-baseline-restore-20260929.xxxx.us-east-1.rds.amazonaws.com:5432/therapybill" ;;
  esac
}

# --- url_with_db <url> <newdb> ----------------------------------------------
# Return <url> with its database path replaced by <newdb>, preserving any
# query string (?sslmode=... etc). Used by 04 to reach the maintenance DB
# ("postgres") and the scratch verify DB on the SAME restored instance.
url_with_db() {
  local url="$1" newdb="$2"
  local qs="" base="$url"
  if [[ "$url" == *\?* ]]; then
    qs="?${url#*\?}"
    base="${url%%\?*}"
  fi
  printf '%s/%s%s' "${base%/*}" "$newdb" "$qs"
}

# --- repo root + work dir ----------------------------------------------------
# All generated artifacts live under scripts/migration-reconciliation/work/,
# which must NOT be committed (it can contain schema dumps of PHI-bearing
# table structures; structures only — never data — but keep it local anyway).
RECON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$RECON_DIR/../.." && pwd)"
WORK_DIR="$RECON_DIR/work"
