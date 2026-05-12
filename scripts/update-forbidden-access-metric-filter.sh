#!/usr/bin/env bash
#
# Update the CloudWatch ForbiddenAccess metric filter to exclude
# MFA_SETUP_REQUIRED responses.
#
# Why
# ---
# The original filter matched any " 403 " in /ecs/therapybill-app. But
# the most common 403 in this app is MFA_SETUP_REQUIRED — a benign UX
# signal that fires every time an authenticated user without MFA loads
# the dashboard (server's mfaSetupRequired middleware rejects PHI access
# until MFA is enabled, per HIPAA). Without a client-side gate, every
# such load fired ~13 forbidden responses, tripping the
# therapybill-high-forbidden alarm despite no security issue.
#
# This PR adds a client-side gate so MFA-less users never see the
# dashboard. But to also stop legacy occurrences (e.g. older sessions,
# direct API hits, scripts) from generating false-positive alarms, we
# update the metric filter to count only "real" 403s — those that
# indicate an authorization failure, not an MFA setup gap.
#
# Idempotent: re-running this script applies the same filter pattern.
# Read-only check first: prints the existing pattern so you can verify
# before applying.

set -e
LOG_GROUP="/ecs/therapybill-app"
FILTER_NAME="ForbiddenAccess"
METRIC_NAME="ForbiddenAccess"
METRIC_NS="TherapyBill/Security"
NEW_PATTERN='" 403 " -"MFA_SETUP_REQUIRED"'
REGION="${AWS_REGION:-us-east-1}"

echo "=== Current filter ==="
aws --region "$REGION" logs describe-metric-filters \
  --log-group-name "$LOG_GROUP" \
  --filter-name-prefix "$FILTER_NAME" \
  --query 'metricFilters[].{name:filterName, pattern:filterPattern, metric:metricTransformations[0].metricName}' \
  --output table

if [[ "$1" != "--apply" ]]; then
  echo
  echo "Will update filter '$FILTER_NAME' on log group '$LOG_GROUP' to:"
  echo "    pattern: $NEW_PATTERN"
  echo
  echo "Dry run. Re-run with --apply to actually update."
  exit 0
fi

echo
echo "Applying new pattern..."
aws --region "$REGION" logs put-metric-filter \
  --log-group-name "$LOG_GROUP" \
  --filter-name "$FILTER_NAME" \
  --filter-pattern "$NEW_PATTERN" \
  --metric-transformations \
    metricName="$METRIC_NAME",metricNamespace="$METRIC_NS",metricValue=1,defaultValue=0

echo
echo "=== Updated filter ==="
aws --region "$REGION" logs describe-metric-filters \
  --log-group-name "$LOG_GROUP" \
  --filter-name-prefix "$FILTER_NAME" \
  --query 'metricFilters[].{name:filterName, pattern:filterPattern}' \
  --output table

echo
echo "Done. MFA_SETUP_REQUIRED 403s will no longer count toward the"
echo "ForbiddenAccess metric, so therapybill-high-forbidden will only"
echo "fire for real authorization failures."
