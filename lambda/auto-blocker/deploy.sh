#!/usr/bin/env bash
#
# Package + deploy the therapybill-auto-blocker Lambda from
# lambda/auto-blocker/lambda_function.py.
#
# Idempotent. Pure boto3 (no extra deps), so the zip is just the
# single source file. Run after any change to lambda_function.py.
#
# Usage:
#   lambda/auto-blocker/deploy.sh

set -euo pipefail

FN_NAME="therapybill-auto-blocker"
REGION="${AWS_REGION:-us-east-1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$SCRIPT_DIR/lambda_function.py"

if [[ ! -f "$SRC" ]]; then
  echo "Source not found: $SRC" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp "$SRC" "$TMP/lambda_function.py"
(cd "$TMP" && zip -q lambda.zip lambda_function.py)

echo "Uploading $(wc -c < "$TMP/lambda.zip" | tr -d ' ') bytes to $FN_NAME (region $REGION)..."
aws --region "$REGION" lambda update-function-code \
  --function-name "$FN_NAME" \
  --zip-file "fileb://$TMP/lambda.zip" \
  --query '{LastModified:LastModified, CodeSize:CodeSize, Version:Version}' \
  --output table

# Wait for the update to finish before any caller tries to invoke
aws --region "$REGION" lambda wait function-updated --function-name "$FN_NAME"

echo "Deployed."
