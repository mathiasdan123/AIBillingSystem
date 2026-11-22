#!/usr/bin/env bash
#
# Restore demo-user-001's MFA enrollment against prod as a one-off ECS
# Fargate task (RDS is in a private subnet; nothing reaches it from a
# laptop). Feeds scripts/restore-demo-mfa-payload.cjs to the app container
# as `node -e` — the same mechanism the deploy workflow's migration step
# uses.
#
# WHY: run-force-mfa-reenrollment.sh reset mfa_enabled=false for every
# currently-enrolled user, demo-user-001 included. That broke the public
# "Try Free Demo" flow — see scripts/restore-demo-mfa-payload.cjs for the
# full mechanism. Run this once to put the demo account back the way it was
# before that reset.
#
# Usage:
#   scripts/restore-demo-mfa.sh --dry-run   # transaction rolled back
#   scripts/restore-demo-mfa.sh
#
# Needs: aws CLI with prod credentials, jq.
set -euo pipefail

REGION=us-east-1
CLUSTER=therapybill-cluster
SERVICE=therapybill-service
PAYLOAD="$(dirname "$0")/restore-demo-mfa-payload.cjs"

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
  --started-by "restore-demo-mfa" \
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
