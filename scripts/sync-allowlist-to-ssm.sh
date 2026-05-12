#!/usr/bin/env bash
#
# Sync scripts/known-tooling-ips.txt → SSM Parameter Store
# (/therapybill/security/known-tooling-ips).
#
# The Lambda auto-blocker reads the SSM parameter at invocation time
# (faster than fetching from GitHub, no external network egress). Git
# remains the source of truth — edit known-tooling-ips.txt, run this
# script, and the Lambda picks up the new value on next alarm fire.
#
# SSM StringList values can't contain comments — they're stripped here.
# Keep human-readable docs in the .txt file.
#
# Usage:
#   scripts/sync-allowlist-to-ssm.sh
#   scripts/sync-allowlist-to-ssm.sh --dry-run

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ALLOWLIST_FILE="$SCRIPT_DIR/known-tooling-ips.txt"
PARAM_NAME="/therapybill/security/known-tooling-ips"
REGION="${AWS_REGION:-us-east-1}"
DRY_RUN=0

[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

if [[ ! -f "$ALLOWLIST_FILE" ]]; then
  echo "Allowlist file not found: $ALLOWLIST_FILE" >&2
  exit 1
fi

# Strip comments + blank lines, keep just the CIDR/IP per line
CIDRS=$(sed 's/#.*//' "$ALLOWLIST_FILE" | awk 'NF' | tr -d ' ')

if [[ -z "$CIDRS" ]]; then
  echo "Allowlist is empty (only comments in $ALLOWLIST_FILE)."
  echo "Setting SSM parameter to an empty marker so the Lambda finds it."
  VALUE="0.0.0.0/32"  # SSM StringList must have at least one entry; this never matches a real IP that would matter
else
  # Join with commas for SSM StringList
  VALUE=$(echo "$CIDRS" | tr '\n' ',' | sed 's/,$//')
fi

echo "About to set SSM parameter:"
echo "  Name:   $PARAM_NAME"
echo "  Region: $REGION"
echo "  Value:  $VALUE"

if [[ "$DRY_RUN" == "1" ]]; then
  echo
  echo "(dry run — re-run without --dry-run to apply)"
  exit 0
fi

aws --region "$REGION" ssm put-parameter \
  --name "$PARAM_NAME" \
  --value "$VALUE" \
  --type StringList \
  --overwrite \
  --description "Allowlist for therapybill-auto-blocker Lambda. Source: scripts/known-tooling-ips.txt — edit there and re-run scripts/sync-allowlist-to-ssm.sh." \
  --query 'Tier' --output text

echo "Done."
