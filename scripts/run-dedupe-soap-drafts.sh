#!/usr/bin/env bash
#
# REPORT-ONLY duplicate check for soap_note_drafts on prod, ahead of the
# unique index idx_soap_draft_therapist_patient (therapybill-qa #3). Runs
# scripts/dedupe-soap-drafts-payload.cjs as a one-off ECS Fargate task
# (RDS is in a private subnet; nothing reaches it from a laptop), fed to
# the app container as `node -e` like the other one-off tasks.
#
# The payload only SELECTs: it prints whether the index exists and lists
# any duplicate (therapist_id, patient_id) groups with every row's id and
# timestamps, exiting 1 if any exist. It never deletes or updates a row.
# (The name is from the original deleting proposal; kept so references in
# QA #3 / PR #454 stay valid.)
#
# This is still a PRODUCTION OPERATION: it launches a Fargate task in the
# prod cluster, opens a connection to the prod database, and bills for the
# task. Run it only with Daniel's explicit approval. The deploy workflow
# runs the same payload automatically before db:push, so there is normally
# no reason to run this by hand.
#
# Usage:
#   scripts/run-dedupe-soap-drafts.sh
#
# Exit code is the payload's: 0 = no duplicates, 1 = duplicates found or
# the check failed. Needs: aws CLI with prod credentials, jq.
set -euo pipefail

REGION=us-east-1
CLUSTER=therapybill-cluster
SERVICE=therapybill-service
PAYLOAD="$(dirname "$0")/dedupe-soap-drafts-payload.cjs"

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

OVERRIDES=$(jq -Rs --arg name "$CONTAINER" \
  '{containerOverrides:[{name:$name,command:["node","-e",.]}]}' \
  "$PAYLOAD")

TASK_ARN=$(aws ecs run-task --region "$REGION" \
  --cluster "$CLUSTER" \
  --launch-type FARGATE \
  --task-definition "$TASK_DEF" \
  --network-configuration "$NET" \
  --overrides "$OVERRIDES" \
  --started-by "soap-draft-duplicate-check" \
  --query 'tasks[0].taskArn' --output text)
echo "Check task: $TASK_ARN"

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
