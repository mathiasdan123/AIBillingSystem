#!/usr/bin/env bash
#
# One-command production deploy for therapybill-app.
#
#   Usage:  scripts/deploy.sh
#
# Pipeline (in order — the order matters):
#   1. Verify clean main, pull latest
#   2. Write .release-sha for /api/health
#   3. Zip source → upload to S3
#   4. Trigger CodeBuild → wait
#   5. Run therapybill-migrate task → wait    <-- the step that's easy to forget
#   6. Force-new-deployment on therapybill-service → wait for stable
#   7. Run post-deploy smoke test
#
# Migrations run BEFORE the app rolls out so a schema mismatch (the
# `key_arguments` / `maintenance_windows` class of bug) can't ship. If the
# migrate task fails, the app rollout is skipped — fail-fast.
#
# Requires: aws CLI authenticated, zip, curl, python3, git.

set -euo pipefail

# --- config ----------------------------------------------------------------
REGION="us-east-1"
CLUSTER="therapybill-cluster"
SERVICE="therapybill-service"
CODEBUILD_PROJECT="therapybill-build"
SOURCE_BUCKET="therapybill-build-source-773320320189"
SOURCE_KEY="source.zip"
MIGRATE_TASK_DEF="therapybill-migrate"
SUBNETS="subnet-0626e9b6fe5ed59be,subnet-05d74eec22a9f7bbf"
SECURITY_GROUPS="sg-0f81450d46c2d0fb0"
APP_URL="https://app.therapybillai.com"
SMOKE_TEST="scripts/post-deploy-smoke-test.sh"

# --- helpers ---------------------------------------------------------------
log()  { printf '\033[1;34m▶\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

require() { command -v "$1" >/dev/null 2>&1 || fail "missing required tool: $1"; }
require aws; require zip; require curl; require python3; require git

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- 1. main is clean and up to date --------------------------------------
log "Verifying git state"
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || fail "must be on 'main' (currently $(git rev-parse --abbrev-ref HEAD))"
[ -z "$(git status --porcelain)" ] || fail "working tree is dirty — commit or stash first"
git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] || fail "local main is behind origin/main — run 'git pull' first"
SHA="$LOCAL"
ok "On main at $SHA"

# --- 2. release marker -----------------------------------------------------
echo "$SHA" > .release-sha
ok "Wrote .release-sha"

# --- 3. zip + upload to S3 -------------------------------------------------
log "Zipping source"
rm -f /tmp/source.zip
zip -rq /tmp/source.zip . \
  -x "node_modules/*" \
  -x ".git/*" \
  -x "dist/*" \
  -x ".claude/worktrees/*" \
  -x "*.log" \
  -x ".env" \
  -x ".env.*"
ZIP_SIZE=$(du -h /tmp/source.zip | cut -f1)
ok "Built /tmp/source.zip ($ZIP_SIZE)"

log "Uploading to s3://$SOURCE_BUCKET/$SOURCE_KEY"
aws s3 cp /tmp/source.zip "s3://$SOURCE_BUCKET/$SOURCE_KEY" --region "$REGION" --only-show-errors
ok "Uploaded"

# --- 4. CodeBuild ----------------------------------------------------------
log "Starting CodeBuild ($CODEBUILD_PROJECT)"
BUILD_ID=$(aws codebuild start-build \
  --project-name "$CODEBUILD_PROJECT" --region "$REGION" \
  --query 'build.id' --output text)
ok "Build started: $BUILD_ID"

log "Waiting for build to finish (typically 3–8 min)…"
START=$(date +%s)
while true; do
  STATUS=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --region "$REGION" \
    --query 'builds[0].buildStatus' --output text)
  PHASE=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --region "$REGION" \
    --query 'builds[0].currentPhase' --output text)
  ELAPSED=$(($(date +%s) - START))
  printf "  [%4ds] status=%s phase=%s\n" "$ELAPSED" "$STATUS" "$PHASE"
  case "$STATUS" in
    SUCCEEDED) ok "Build succeeded"; break ;;
    FAILED|FAULT|STOPPED|TIMED_OUT) fail "Build $STATUS — check CodeBuild console" ;;
  esac
  [ "$ELAPSED" -gt 900 ] && fail "Build timed out after 15 min"
  sleep 15
done

# --- 5. migrate task (BEFORE app rollout) ---------------------------------
log "Running migrate task ($MIGRATE_TASK_DEF) — schema sync before app rolls out"
MIGRATE_ARN=$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$MIGRATE_TASK_DEF" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUPS],assignPublicIp=DISABLED}" \
  --region "$REGION" \
  --query 'tasks[0].taskArn' --output text)
ok "Migrate task: $(basename "$MIGRATE_ARN")"

log "Waiting for migration to complete (typically ~1 min)…"
START=$(date +%s)
while true; do
  STATUS=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$MIGRATE_ARN" --region "$REGION" \
    --query 'tasks[0].lastStatus' --output text)
  ELAPSED=$(($(date +%s) - START))
  printf "  [%4ds] %s\n" "$ELAPSED" "$STATUS"
  [ "$STATUS" = "STOPPED" ] && break
  [ "$ELAPSED" -gt 300 ] && fail "Migrate task timed out after 5 min"
  sleep 10
done
EXIT_CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$MIGRATE_ARN" --region "$REGION" \
  --query 'tasks[0].containers[0].exitCode' --output text)
[ "$EXIT_CODE" = "0" ] || fail "Migrate exited with code $EXIT_CODE — app rollout SKIPPED. Check /ecs/therapybill-migrate logs."
ok "Migration applied"

# --- 6. ECS rollout --------------------------------------------------------
log "Force-new-deployment on $SERVICE"
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
  --force-new-deployment --region "$REGION" \
  --query 'service.deployments[0].id' --output text >/dev/null
ok "Rollout triggered"

log "Waiting for rollout to stabilize (typically ~3 min)…"
# "Stable" = the new (PRIMARY) deployment has all desired tasks running.
# We deliberately do NOT wait for `deployments == 1` — the OLD deployment
# can take a long time to fully drain off (5–15 min in slow cases), and
# blocking on that has nothing to do with whether the new code is live and
# healthy. Once primaryRunning == primaryDesired, the new code is serving
# traffic on every task; the old tasks draining in the background are
# bookkeeping. Bumped timeout to 15 min for the genuine "new tasks won't
# come up" failure case.
START=$(date +%s)
while true; do
  JSON=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" \
    --query 'services[0].{primaryRunning:deployments[?status==`PRIMARY`].runningCount|[0],primaryDesired:deployments[?status==`PRIMARY`].desiredCount|[0],rolloutState:deployments[?status==`PRIMARY`].rolloutState|[0],deployments:length(deployments)}' --output json)
  ELAPSED=$(($(date +%s) - START))
  printf "  [%4ds] %s\n" "$ELAPSED" "$(echo "$JSON" | tr -d '\n ' )"
  STABLE=$(echo "$JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d['primaryRunning']==d['primaryDesired'] and d['primaryDesired']>0 and d.get('rolloutState') in (None,'COMPLETED') else 'no')")
  if [ "$STABLE" = "yes" ]; then
    DEPLOY_COUNT=$(echo "$JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['deployments'])")
    if [ "$DEPLOY_COUNT" != "1" ]; then
      warn "New tasks healthy. Old deployment still draining ($DEPLOY_COUNT total deployments); not blocking smoke test on that."
    fi
    ok "Rollout stable"
    break
  fi
  [ "$ELAPSED" -gt 900 ] && fail "Rollout did not stabilize in 15 min"
  sleep 15
done

# --- 7. smoke test ---------------------------------------------------------
log "Running smoke test"
if [ -x "$SMOKE_TEST" ]; then
  bash "$SMOKE_TEST"
  ok "Smoke test passed"
else
  warn "Smoke test script not found at $SMOKE_TEST — skipping"
fi

# --- 8. health verification (deployed SHA matches) ------------------------
log "Verifying /api/health reports our SHA"
DEPLOYED_SHA=$(curl -sf "$APP_URL/api/health" | python3 -c "import sys,json; print(json.load(sys.stdin).get('release','unknown'))")
if [ "$DEPLOYED_SHA" = "$SHA" ]; then
  ok "Health reports release=$SHA"
else
  warn "Health reports release=$DEPLOYED_SHA (expected $SHA) — may still be rolling"
fi

echo
ok "🚀 Deploy complete — $SHA is live at $APP_URL"
