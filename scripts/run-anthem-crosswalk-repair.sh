#!/usr/bin/env bash
#
# Run the Anthem payer_crosswalk repair against prod as a one-off ECS Fargate
# task (RDS is in a private subnet; nothing reaches it from a laptop). Feeds
# scripts/anthem-crosswalk-repair-payload.cjs to the app container as
# `node -e` — the same mechanism the deploy workflow's migration step uses.
# See scripts/repair-anthem-crosswalk-payer-id.ts for the full background.
#
# Usage:
#   scripts/run-anthem-crosswalk-repair.sh --dry-run   # transaction rolled back
#   scripts/run-anthem-crosswalk-repair.sh
#
# Needs: aws CLI with prod credentials, jq.
set -euo pipefail

REGION=us-east-1
CLUSTER=therapybill-cluster
SERVICE=therapybill-service
PAYLOAD="$(dirname "$0")/anthem-crosswalk-repair-payload.cjs"

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
  --started-by "anthem-crosswalk-repair" \
  --query 'tasks[0].taskArn' --output text)
echo "Repair task: $TASK_ARN"

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
