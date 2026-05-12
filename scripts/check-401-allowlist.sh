#!/usr/bin/env bash
#
# check-401-allowlist.sh — compare top 401-generating source IPs against
# the known-tooling allowlist, so when the high-401-rate alarm fires you
# can tell at a glance which IPs are "expected" (your own tools, scheduled
# probes) vs "unknown" (worth investigating or blocking).
#
# Reads scripts/known-tooling-ips.txt. Top IPs come from CloudWatch Logs
# Insights against the WAF log group. Default window is last 6 hours;
# tune with --hours or --start/--end (UTC).
#
# Output for each top IP:
#   ✓ known       — matched an entry in known-tooling-ips.txt
#   ⚠ UNKNOWN     — no match; investigate
#   🚫 BLOCKED     — already in therapybill-scanner-blocklist (no action needed)
#
# Usage:
#   scripts/check-401-allowlist.sh                  # last 6h
#   scripts/check-401-allowlist.sh --hours 24
#   scripts/check-401-allowlist.sh --start "2026-05-09 17:00" --end "2026-05-09 17:30"

set -e

REGION="${AWS_REGION:-us-east-1}"
WAF_LOG_GROUP="aws-waf-logs-therapybill-production"
BLOCKLIST_NAME="therapybill-scanner-blocklist"
BLOCKLIST_ID="e1eefff7-61fc-4019-9b98-0a20b3427e78"
ALLOWLIST_FILE="$(cd "$(dirname "$0")" && pwd)/known-tooling-ips.txt"

HOURS=6
START_INPUT=""
END_INPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hours) HOURS="$2"; shift 2 ;;
    --start) START_INPUT="$2"; shift 2 ;;
    --end)   END_INPUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

to_epoch() {
  if date -u -j -f "%Y-%m-%d %H:%M" "$1" +%s 2>/dev/null; then return; fi
  if date -u -j -f "%Y-%m-%d %H:%M:%S" "$1" +%s 2>/dev/null; then return; fi
  echo "Bad timestamp: $1 (use 'YYYY-MM-DD HH:MM' UTC)" >&2
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

START_ISO=$(date -u -r "$START_EPOCH" +"%Y-%m-%d %H:%M UTC")
END_ISO=$(date -u -r "$END_EPOCH" +"%Y-%m-%d %H:%M UTC")

echo "=== 401-source allowlist check ==="
echo "Window:    $START_ISO  →  $END_ISO"
echo "Allowlist: $ALLOWLIST_FILE"
echo

# ----- 1. Load allowlist (strip comments + blanks)
declare -a allow_entries=()
declare -a allow_labels=()
if [[ -f "$ALLOWLIST_FILE" ]]; then
  while IFS= read -r line; do
    # Strip trailing comment, then trim whitespace
    cidr=$(echo "$line" | sed 's/#.*//' | xargs)
    label=$(echo "$line" | sed -n 's/.*# *\(.*\)/\1/p')
    [[ -z "$cidr" ]] && continue
    allow_entries+=("$cidr")
    allow_labels+=("${label:-<no comment>}")
  done < "$ALLOWLIST_FILE"
fi
echo "Allowlist has ${#allow_entries[@]} entries"

# ----- 2. Load currently-blocked IPs from WAF
BLOCKED_RAW=$(aws --region "$REGION" wafv2 get-ip-set --scope REGIONAL \
  --name "$BLOCKLIST_NAME" --id "$BLOCKLIST_ID" \
  --query 'IPSet.Addresses[]' --output text 2>/dev/null | tr '\t' '\n' || true)

# ----- 3. Get top 401-source IPs from app log (the metric source)
echo
echo "Pulling top IPs by 401 count from app log..."
QID=$(aws --region "$REGION" logs start-query \
  --log-group-name aws-waf-logs-therapybill-production \
  --start-time "$START_EPOCH" --end-time "$END_EPOCH" \
  --query-string 'fields `httpRequest.clientIp` | stats count() as hits by `httpRequest.clientIp` | sort hits desc | limit 20' \
  --query 'queryId' --output text)

for _ in $(seq 1 60); do
  s=$(aws --region "$REGION" logs get-query-results --query-id "$QID" --query 'status' --output text)
  [[ "$s" == "Complete" ]] && break
  sleep 2
done

RESULTS=$(aws --region "$REGION" logs get-query-results --query-id "$QID" --output json \
  | jq -r '.results[] | [(.[] | select(.field=="hits").value), (.[] | select(.field=="httpRequest.clientIp").value)] | @tsv')

if [[ -z "$RESULTS" ]]; then
  echo "  (no WAF traffic in window)"
  exit 0
fi

# ----- 4. Classify each IP
# Simple IP-in-CIDR check using python (avoid bash CIDR math). Built-in,
# no extra deps.
in_cidr_check() {
  local ip=$1
  shift
  local cidrs=("$@")
  python3 - "$ip" "${cidrs[@]}" <<'PY'
import sys
import ipaddress
ip = ipaddress.ip_address(sys.argv[1])
for c in sys.argv[2:]:
    try:
        if ip in ipaddress.ip_network(c, strict=False):
            print(c); sys.exit(0)
    except ValueError:
        continue
sys.exit(1)
PY
}

echo
printf "%-7s  %-18s  %s\n" "HITS" "IP" "STATUS"
printf "%-7s  %-18s  %s\n" "----" "------------------" "------------------------------------------"

unknown_count=0
declare -a unknown_ips=()
while IFS=$'\t' read -r hits ip; do
  [[ -z "$ip" ]] && continue
  # Already blocked?
  if echo "$BLOCKED_RAW" | grep -qE "^${ip}/32$"; then
    printf "%-7s  %-18s  %s\n" "$hits" "$ip" "🚫 already blocked"
    continue
  fi
  # In allowlist?
  match=""
  if [[ ${#allow_entries[@]} -gt 0 ]]; then
    match=$(in_cidr_check "$ip" "${allow_entries[@]}" 2>/dev/null || true)
  fi
  if [[ -n "$match" ]]; then
    # Find the label for this match
    for i in "${!allow_entries[@]}"; do
      if [[ "${allow_entries[$i]}" == "$match" ]]; then
        printf "%-7s  %-18s  ✓ known: %s (%s)\n" "$hits" "$ip" "$match" "${allow_labels[$i]}"
        break
      fi
    done
  else
    printf "%-7s  %-18s  ⚠ UNKNOWN\n" "$hits" "$ip"
    unknown_count=$((unknown_count + 1))
    unknown_ips+=("$ip:$hits")
  fi
done <<< "$RESULTS"

echo
if [[ $unknown_count -gt 0 ]]; then
  echo "Found $unknown_count unknown IP(s). To investigate further:"
  echo "  scripts/triage-401-spike.sh --start '$START_ISO' --end '$END_ISO'"
  echo
  echo "Decision tree per unknown IP:"
  echo "  - Recognize it (smoke test, monitoring, partner)? → add to known-tooling-ips.txt"
  echo "  - Reverse-DNS shows residential / customer-looking? → leave for now, watch repeats"
  echo "  - EC2 / VPS / aggressive volume? → consider adding to scanner-blocklist"
else
  echo "All top source IPs are either already blocked or on the allowlist. ✓"
fi
