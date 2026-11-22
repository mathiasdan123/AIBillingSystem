#!/usr/bin/env bash
#
# Wipe the isolated demo practice's data against prod as a one-off ECS
# Fargate task (RDS is in a private subnet; nothing reaches it from a
# laptop). Feeds scripts/reconcile-demo-practice-payload.cjs to the app
# container as `node -e` — the same mechanism the deploy workflow's
# migration step uses.
#
# WHY: responds to the "therapybill-demo-path-broken" CloudWatch alarm
# (synthetic canary: health -> demo-login -> patients==6). Root cause:
# server/services/demoPractice.ts's ensureDemoPractice() seeds exactly 6
# canonical patients, but only reseeds when the practice has ZERO patients
# -- it never reconciles a non-zero count back to canonical. Live demos to
# prospects mutate this shared sandbox (adding/deleting patients mid-pitch),
# so once the count drifts away from 6 it stays drifted and the canary
# alarms on every subsequent run until someone intervenes.
#
# WHAT THIS DOES: deletes patients/appointments/claims/etc. for the demo
# practice only (scoped by practices.is_demo=true) -- never a real practice.
# Reuses the same FK-safe deletion order server/routes/admin.ts's existing
# reset-demo-data route already uses (that route is scoped to a caller's
# own practiceId and reseeds via a different, older path -- not reused
# directly here). Does NOT reseed: ensureDemoPractice()'s existing "seed if
# empty" logic does that automatically on the next demo-login.
#
# The payload .cjs is kept deliberately terse (short labels, no inline
# comments) because AWS ECS caps a RunTask container override at 8192
# bytes serialized -- this script's first version (12KB with full
# documentation inline) hit "Container Overrides length must be at most
# 8192" and had to be slimmed down. Put any new explanation here instead.
#
# Usage:
#   scripts/run-reconcile-demo-practice.sh --dry-run   # transaction rolled back
#   scripts/run-reconcile-demo-practice.sh
#
# Needs: aws CLI with prod credentials, jq.
set -euo pipefail

REGION=us-east-1
CLUSTER=therapybill-cluster
SERVICE=therapybill-service
PAYLOAD="$(dirname "$0")/reconcile-demo-practice-payload.cjs"

DRY_RUN_ENV='[]'
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN_ENV='[{"name":"DRY_RUN","value":"1"}]'
fi

# Network config + task def from the live service (avoids hardcoding subnets).
NET=$(aws ecs describe-services --region "$REGION" \
  --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].networkConfiguration' --output json)
TASK_DEF=$(aws ecs describe-services --region "$REGION" \
  --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].taskDefinition' --output text)
CONTAINER=$(aws ecs describe-task-definition --region "$REGION" \
  --task-definition "$TASK_DEF" \
  --query 'taskDefinition.containerDefinitions[0].name' --output text)
echo "Using task def $TASK_DEF, container $CONTAINER"

OVERRIDES=$(jq -Rs --arg name "$CONTAINER" --argjson env "$DRY_RUN_ENV" \
  '{containerOverrides:[{name:$name,command:["node","-e",.],environment:$env}]}' \
  "$PAYLOAD")

TASK_ARN=$(aws ecs run-task --region "$REGION" \
  --cluster "$CLUSTER" \
  --launch-type FARGATE \
  --task-definition "$TASK_DEF" \
  --network-configuration "$NET" \
  --overrides "$OVERRIDES" \
  --started-by "reconcile-demo-practice" \
  --query 'tasks[0].taskArn' --output text)
echo "Task: $TASK_ARN"

aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN"

EXIT_CODE=$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)
echo "Exit code: $EXIT_CODE"

# Print the task's output from CloudWatch.
LOG_GROUP=$(aws ecs describe-task-definition --region "$REGION" --task-definition "$TASK_DEF" \
  --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-group"' --output text)
LOG_PREFIX=$(aws ecs describe-task-definition --region "$REGION" --task-definition "$TASK_DEF" \
  --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-stream-prefix"' --output text)
TASK_ID="${TASK_ARN##*/}"
aws logs get-log-events --region "$REGION" \
  --log-group-name "$LOG_GROUP" \
  --log-stream-name "$LOG_PREFIX/$CONTAINER/$TASK_ID" \
  --query 'events[].message' --output text || echo "(could not fetch logs — check $LOG_GROUP in CloudWatch)"

[[ "$EXIT_CODE" == "0" ]]
