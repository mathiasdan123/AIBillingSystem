#!/usr/bin/env bash
#
# Post-deploy smoke test for app.therapybillai.com
#
# Hits critical public endpoints after an ECS rollout. Exits non-zero
# on failure so the deploy pipeline can trigger a rollback.
#
# Usage:
#   scripts/post-deploy-smoke-test.sh                 # hits production
#   BASE_URL=https://staging.example scripts/post-deploy-smoke-test.sh
#
# Note: We can't smoke-test authenticated endpoints without a session
# token, so this is a conservative "is the app responding at all" check.
# Catches the most common bad-deploy modes:
#   - container fails to start
#   - app boots but throws on the first request
#   - static assets missing / unreachable
#   - DB connection broken (health endpoint pings the DB)

set -e

BASE_URL="${BASE_URL:-https://app.therapybillai.com}"
TIMEOUT=10
MAX_RETRIES=3
RETRY_DELAY=5

PASS=0
FAIL=0

# ANSI colors (skip if NO_COLOR set or stdout isn't a terminal)
if [ -t 1 ] && [ -z "$NO_COLOR" ]; then
  RED=$'\033[0;31m'
  GREEN=$'\033[0;32m'
  YELLOW=$'\033[0;33m'
  RESET=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; RESET=''
fi

# check_endpoint <name> <url> <expected_status> [<grep_pattern>]
# grep_pattern is optional — if provided, response body must contain it.
check_endpoint() {
  local name="$1"
  local url="$2"
  local expected="$3"
  local grep_pattern="${4:-}"

  for attempt in $(seq 1 $MAX_RETRIES); do
    local body_file
    body_file=$(mktemp)
    local status
    status=$(curl -sS -o "$body_file" -w "%{http_code}" --max-time "$TIMEOUT" "$url" 2>/dev/null || echo "000")

    if [ "$status" = "$expected" ]; then
      if [ -z "$grep_pattern" ] || grep -q -- "$grep_pattern" "$body_file"; then
        echo "${GREEN}✓${RESET} $name ($status)"
        rm -f "$body_file"
        PASS=$((PASS + 1))
        return 0
      else
        echo "${YELLOW}…${RESET} $name attempt $attempt/$MAX_RETRIES — got $status but body missing pattern '$grep_pattern'"
      fi
    else
      echo "${YELLOW}…${RESET} $name attempt $attempt/$MAX_RETRIES — expected $expected, got $status"
    fi

    rm -f "$body_file"
    [ $attempt -lt $MAX_RETRIES ] && sleep $RETRY_DELAY
  done

  echo "${RED}✗${RESET} $name — FAILED after $MAX_RETRIES attempts"
  FAIL=$((FAIL + 1))
  return 1
}

echo "=== Post-deploy smoke test: $BASE_URL ==="
echo

# 1. Health endpoint — pings DB. Most important check.
check_endpoint "Health endpoint"          "$BASE_URL/api/health"          "200" "healthy" || true

# 2. Static index — confirms client bundle is being served.
check_endpoint "Index HTML"               "$BASE_URL/"                    "200" "<div" || true

# 3. Login page renders — auth flow basic check.
check_endpoint "Login page"               "$BASE_URL/login"               "200" "<div" || true

# 4. API surface returns expected unauthenticated response (401, not 500).
#    A 500 here means the app is up but routing is broken.
check_endpoint "API auth check (expect 401)" "$BASE_URL/api/auth/user"    "401" || true

# 5. Static asset served — confirms CDN / asset pipeline.
#    This hits whatever index.html references; if it 404s, the build is broken.
INDEX_HTML=$(curl -sS --max-time $TIMEOUT "$BASE_URL/" 2>/dev/null || echo "")
ASSET_PATH=$(echo "$INDEX_HTML" | grep -oE '/assets/[^"]+\.js' | head -1 || true)
if [ -n "$ASSET_PATH" ]; then
  check_endpoint "Main JS bundle"         "$BASE_URL$ASSET_PATH"          "200" || true
else
  echo "${YELLOW}…${RESET} Main JS bundle — could not extract from index.html, skipping"
fi

echo
echo "=== Result: $PASS passed, $FAIL failed ==="

if [ $FAIL -gt 0 ]; then
  echo "${RED}SMOKE TEST FAILED${RESET} — deploy should be rolled back"
  exit 1
fi

echo "${GREEN}SMOKE TEST PASSED${RESET}"
exit 0
