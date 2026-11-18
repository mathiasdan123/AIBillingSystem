#!/usr/bin/env bash
#
# Push a canary script from this directory to CloudWatch Synthetics.
#
#   infra/canaries/deploy.sh therapybill-demo-path            # deploy
#   infra/canaries/deploy.sh therapybill-demo-path --dry-run  # build the zip only
#
# Needs: aws CLI v2 with credentials for the TherapyBill account, zip, base64.
# Works from AWS CloudShell (us-east-1) after cloning the repo.
#
# The canary's code is uploaded inline (ZipFile), so this does not need the
# artifacts bucket. The Synthetics Node.js runtime expects the zip to contain
# nodejs/node_modules/<handler file>; the source is kept flat in the repo
# (any node_modules/ path is gitignored) and staged into that layout here.
# The runtime version is left as-is on purpose: bump it deliberately, in the
# console or with --runtime-version, not as a side effect of a script change.
set -euo pipefail

REGION=us-east-1
NAME="${1:?usage: deploy.sh <canary-name> [--dry-run]}"
DRY_RUN="${2:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$HERE/$NAME"
[[ -d "$SRC_DIR" ]] || { echo "no $SRC_DIR" >&2; exit 1; }

HANDLER=$(aws synthetics get-canary --region "$REGION" --name "$NAME" --query 'Canary.Code.Handler' --output text)
HANDLER_FILE="${HANDLER%%.*}.js"
[[ -f "$SRC_DIR/$HANDLER_FILE" ]] || { echo "handler $HANDLER expects $HANDLER_FILE in $SRC_DIR" >&2; exit 1; }

STAGE="$(mktemp -d -t "$NAME".XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/nodejs/node_modules"
cp "$SRC_DIR"/*.js "$STAGE/nodejs/node_modules/"
ZIP="$STAGE/$NAME.zip"
( cd "$STAGE" && zip -qr "$ZIP" nodejs )
echo "built $ZIP ($(wc -c < "$ZIP") bytes) for handler $HANDLER"
[[ "$DRY_RUN" == "--dry-run" ]] && { echo "dry run; not deploying"; exit 0; }

# ZipFile is a blob: pass it base64-encoded inside the JSON (the CLI v2
# default binary format), not as fileb://, which shorthand does not accept
# for nested members.
CODE_JSON=$(printf '{"Handler":"%s","ZipFile":"%s"}' "$HANDLER" "$(base64 < "$ZIP" | tr -d '\n')")
aws synthetics update-canary --region "$REGION" --name "$NAME" --code "$CODE_JSON"
echo "update submitted; the new script is used from the next scheduled run"
aws synthetics get-canary --region "$REGION" --name "$NAME" \
  --query 'Canary.{state:Status.State,reason:Status.StateReason,lastModified:Timeline.LastModified}' --output table
