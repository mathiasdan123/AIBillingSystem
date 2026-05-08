#!/usr/bin/env bash
#
# triage-401-spike.sh — investigate a CloudWatch alarm spike for therapybill-high-401-rate.
#
# Pulls WAF logs over a time window, aggregates by source IP / URI / user-agent,
# and prints a verdict (scanner / credential-stuffing / distributed). Read-only —
# does NOT block any IPs. Prints copy-pasteable AWS CLI commands at the end if
# you decide to add the top offenders to the WAF blocklist.
#
# Usage:
#   scripts/triage-401-spike.sh                    # last 6 hours
#   scripts/triage-401-spike.sh --hours 24         # last 24 hours
#   scripts/triage-401-spike.sh --start "2026-05-07 14:00" --end "2026-05-07 14:30"
#
# Requires: aws CLI v2, jq.

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
WAF_LOG_GROUP="aws-waf-logs-therapybill-production"
APP_LOG_GROUP="/ecs/therapybill-app"
BLOCKLIST_NAME="therapybill-scanner-blocklist"
BLOCKLIST_ID="e1eefff7-61fc-4019-9b98-0a20b3427e78"
HOURS=6
START_INPUT=""
END_INPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hours) HOURS="$2"; shift 2 ;;
    --start) START_INPUT="$2"; shift 2 ;;
    --end) END_INPUT="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Resolve time window. Accept either --hours, or both --start and --end.
to_epoch() {
  if date -u -j -f "%Y-%m-%d %H:%M" "$1" +%s 2>/dev/null; then return; fi
  if date -u -j -f "%Y-%m-%d %H:%M:%S" "$1" +%s 2>/dev/null; then return; fi
  echo "Could not parse timestamp: $1 (expected 'YYYY-MM-DD HH:MM' UTC)" >&2
  exit 1
}

if [[ -n "$START_INPUT" && -n "$END_INPUT" ]]; then
  START_EPOCH=$(to_epoch "$START_INPUT")
  END_EPOCH=$(to_epoch "$END_INPUT")
elif [[ -n "$START_INPUT" || -n "$END_INPUT" ]]; then
  echo "Provide both --start and --end, or neither (then --hours applies)." >&2
  exit 1
else
  END_EPOCH=$(date -u +%s)
  START_EPOCH=$(( END_EPOCH - HOURS*3600 ))
fi

START_ISO=$(date -u -r "$START_EPOCH" +"%Y-%m-%d %H:%M:%S UTC")
END_ISO=$(date -u -r "$END_EPOCH" +"%Y-%m-%d %H:%M:%S UTC")

echo "=== 401 spike triage ==="
echo "Window: $START_ISO  →  $END_ISO  ($(( (END_EPOCH - START_EPOCH) / 60 )) min)"
echo "Region: $REGION"
echo

# Step 1: top URIs that returned 401, from app logs. Confirms scanner-vs-real
# (scanners hit /vendor/phpunit, /.env, /admin; real users hit /api/auth/login).
echo "--- Top URIs returning 401 (from app access log) ---"
APP_HITS=$(aws --region "$REGION" logs filter-log-events \
  --log-group-name "$APP_LOG_GROUP" \
  --start-time "${START_EPOCH}000" \
  --end-time "${END_EPOCH}000" \
  --filter-pattern '" 401 "' \
  --query 'events[].message' --output text 2>/dev/null || true)

if [[ -z "$APP_HITS" ]]; then
  echo "  (no 401 events in app log for this window)"
  TOTAL_401=0
else
  TOTAL_401=$(echo "$APP_HITS" | wc -l | tr -d ' ')
  echo "$APP_HITS" \
    | sed -nE 's/.*\[express\] [A-Z]+ ([^ ]+) 401 .*/\1/p' \
    | sort | uniq -c | sort -rn | head -10 \
    | awk '{printf "  %5d  %s\n", $1, $2}'
  echo "  total 401s in window: $TOTAL_401"
fi
echo

# Step 2: top client IPs hitting the ALB/WAF in this window. WAF logs have
# clientIp, app logs don't, so we use this as our IP source. We then look at
# how concentrated the traffic is.
echo "--- Top source IPs (from WAF log) ---"

WAF_QUERY_ID=$(aws --region "$REGION" logs start-query \
  --log-group-name "$WAF_LOG_GROUP" \
  --start-time "$START_EPOCH" --end-time "$END_EPOCH" \
  --query-string 'fields httpRequest.clientIp as ip, httpRequest.country as country, httpRequest.headers.0.value as ua_or_first_header | stats count() as hits by ip, country | sort hits desc | limit 20' \
  --query 'queryId' --output text)

# Poll until query completes (max ~60s).
for _ in $(seq 1 30); do
  STATUS=$(aws --region "$REGION" logs get-query-results --query-id "$WAF_QUERY_ID" --query 'status' --output text)
  [[ "$STATUS" == "Complete" ]] && break
  [[ "$STATUS" == "Failed" || "$STATUS" == "Cancelled" || "$STATUS" == "Timeout" ]] && {
    echo "  WAF query $STATUS"; break; }
  sleep 2
done

WAF_RESULTS=$(aws --region "$REGION" logs get-query-results --query-id "$WAF_QUERY_ID" --output json)
TOP_IPS=$(echo "$WAF_RESULTS" | jq -r '.results[] | [(.[] | select(.field=="hits").value), (.[] | select(.field=="ip").value), (.[] | select(.field=="country").value // "??")] | @tsv')

if [[ -z "$TOP_IPS" ]]; then
  echo "  (no requests in WAF log for this window)"
else
  echo "$TOP_IPS" | awk -F'\t' '{printf "  %5d  %-18s  %s\n", $1, $2, $3}'
fi
echo

# Step 3: cross-reference against the existing scanner blocklist (the
# auto-blocker Lambda may have already handled the obvious offenders).
echo "--- Currently-blocked IPs in $BLOCKLIST_NAME ---"
BLOCKED=$(aws --region "$REGION" wafv2 get-ip-set --scope REGIONAL \
  --name "$BLOCKLIST_NAME" --id "$BLOCKLIST_ID" \
  --query 'IPSet.Addresses[]' --output text 2>/dev/null | tr '\t' '\n' | sed 's|/32$||')
if [[ -z "$BLOCKED" ]]; then
  echo "  (blocklist is empty)"
else
  echo "$BLOCKED" | sed 's/^/  /'
fi
echo

# Step 4: verdict + which top IPs aren't yet blocked.
TOP_IP_COUNT=$(echo "$TOP_IPS" | head -1 | awk -F'\t' '{print $1}')
DISTINCT_TOP_IPS=$(echo "$TOP_IPS" | grep -c . || true)

# Pull the unblocked offenders (ranked, count > 10, not already in blocklist).
UNBLOCKED=""
while IFS=$'\t' read -r hits ip _country; do
  [[ -z "$ip" || "${hits:-0}" -le 10 ]] && continue
  if ! echo "$BLOCKED" | grep -qx "$ip"; then
    UNBLOCKED+="$hits	$ip"$'\n'
  fi
done <<< "$TOP_IPS"

echo "--- Verdict ---"
if [[ "${TOP_IP_COUNT:-0}" -gt 50 && "$DISTINCT_TOP_IPS" -le 5 ]]; then
  echo "  ⚠️  Concentrated source — single-IP scanner / attacker."
elif [[ "$DISTINCT_TOP_IPS" -ge 10 && "${TOP_IP_COUNT:-0}" -lt 20 ]]; then
  echo "  ⚠️  Distributed — many IPs, few hits each. Likely credential-stuffing botnet;"
  echo "      per-IP blocking helps less than the WAF rate-limit rule."
elif [[ "$TOTAL_401" -lt 10 && "${TOP_IP_COUNT:-0}" -lt 30 ]]; then
  echo "  Quiet window — no obvious spike. Either you missed it (try a wider window),"
  echo "  or the auto-blocker already dropped the offenders before they accumulated."
else
  echo "  Mixed pattern. Inspect URIs above — /vendor, /.env, /wp-* = scanners;"
  echo "  /api/auth/* with non-trivial volume = brute-force."
fi

if [[ -n "$UNBLOCKED" ]]; then
  echo
  echo "  Top IPs NOT yet in the blocklist (candidates for manual block):"
  echo "$UNBLOCKED" | head -10 | awk -F'\t' '{printf "    %5d  %s\n", $1, $2}'
fi
echo

echo "--- Note: auto-blocker ---"
echo "  Lambda 'therapybill-auto-blocker' adds offending IPs to the scanner"
echo "  blocklist automatically when this alarm fires. If the verdict above"
echo "  says \"quiet window\" but the alarm did fire, the auto-blocker probably"
echo "  handled it; check 'Currently-blocked IPs' against the spike timing."
echo

# Step 5: ready-to-paste block commands for unblocked offenders only.
TOP5=$(echo "$UNBLOCKED" | head -5 | awk -F'\t' '{print $2}')
if [[ -n "$TOP5" ]]; then
  echo "--- To manually block the unblocked offenders (review before running) ---"
  echo "  # 1) Get current addresses + lock token:"
  echo "  aws wafv2 get-ip-set --scope REGIONAL --region $REGION \\"
  echo "    --name $BLOCKLIST_NAME --id $BLOCKLIST_ID \\"
  echo "    --query '{LockToken:LockToken, Addresses:IPSet.Addresses}' --output json"
  echo
  echo "  # 2) Update with existing + new addresses (replace <LOCK_TOKEN> and <existing/32 ...>):"
  echo "  aws wafv2 update-ip-set --scope REGIONAL --region $REGION \\"
  echo "    --name $BLOCKLIST_NAME --id $BLOCKLIST_ID \\"
  echo "    --lock-token <LOCK_TOKEN> \\"
  echo "    --addresses <existing/32 ...> $(echo "$TOP5" | sed 's|$|/32|' | tr '\n' ' ')"
fi
