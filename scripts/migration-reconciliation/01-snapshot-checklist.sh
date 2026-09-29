#!/usr/bin/env bash
# =============================================================================
# 01-snapshot-checklist.sh — PRINT the AWS CLI commands for snapshotting
# production RDS and restoring it to a temporary instance.
#
# ⚠️  THIS SCRIPT EXECUTES NOTHING. It only echoes commands for Daniel to
#     review and paste, one at a time, during the maintenance window.
#     It never calls `aws`, never opens a network connection, and is safe
#     to run anywhere, any time. (Step 1 of docs/migration-safety-gap.md;
#     step S1–S2 of docs/migration-baseline-runbook.md.)
#
# Idempotent: printing is naturally idempotent. Run as often as you like.
#
# Usage:
#   scripts/migration-reconciliation/01-snapshot-checklist.sh --i-am-on-a-restored-copy
#
# (The flag is required on every script in this kit for uniformity, even
#  though this one touches nothing.)
# =============================================================================
set -euo pipefail

# shellcheck source=_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
require_restored_copy_flag "$@"

# Date-stamped identifiers. The restored instance name MUST contain
# "baseline-restore" — the guards in scripts 02–05 refuse any
# *.rds.amazonaws.com endpoint that does not contain that string.
TODAY="$(date +%Y%m%d)"
SNAP_ID="therapybill-baseline-${TODAY}"
RESTORE_ID="therapybill-baseline-restore-${TODAY}"

cat <<EOF
=============================================================================
 SNAPSHOT + RESTORE CHECKLIST — review each command, then paste it yourself.
 Nothing below has been executed. Region: us-east-1, account 773320320189.
=============================================================================

## 0. Preflight — identify the production instance and confirm identity.
#    (Read-only. Note the DBInstanceIdentifier — referred to as PROD_DB_ID
#     below. Convention in this account is therapybill-*.)

  aws rds describe-db-instances \\
    --region us-east-1 \\
    --query 'DBInstances[].{id:DBInstanceIdentifier,engine:Engine,ver:EngineVersion,class:DBInstanceClass,endpoint:Endpoint.Address}' \\
    --output table

#    Record EngineVersion — your local pg_dump/psql client major version
#    must be >= the server major version (go/no-go check G1 in the runbook).

## 1. Snapshot production. (Read-only from the app's point of view; a
#     manual snapshot on a single-AZ db.t4g.micro briefly pauses I/O —
#     seconds. Do this inside the maintenance window anyway.)

  aws rds create-db-snapshot \\
    --region us-east-1 \\
    --db-instance-identifier <PROD_DB_ID> \\
    --db-snapshot-identifier ${SNAP_ID}

  aws rds wait db-snapshot-available \\
    --region us-east-1 \\
    --db-snapshot-identifier ${SNAP_ID}
#    Typical wait: 5–15 min for a db.t4g.micro-sized database.

## 2. Restore the snapshot to a TEMPORARY instance.
#     * The identifier ${RESTORE_ID} contains "baseline-restore" —
#       required, or scripts 02–05 will refuse the endpoint.
#     * Same VPC/subnet group + a security group that your working host
#       can reach (run the remaining scripts from a host inside the VPC,
#       e.g. via SSM/bastion — do NOT make the instance public).
#     * --no-multi-az and the smallest class keep cost negligible for the
#       ~1–2 hours it lives.

  aws rds restore-db-instance-from-db-snapshot \\
    --region us-east-1 \\
    --db-instance-identifier ${RESTORE_ID} \\
    --db-snapshot-identifier ${SNAP_ID} \\
    --db-instance-class db.t4g.micro \\
    --no-multi-az \\
    --no-publicly-accessible \\
    --db-subnet-group-name <SAME_SUBNET_GROUP_AS_PROD> \\
    --vpc-security-group-ids <SG_REACHABLE_FROM_YOUR_HOST> \\
    --tag-specifications 'ResourceType=db-instance,Tags=[{Key=purpose,Value=baseline-reconciliation},{Key=delete-after,Value=${TODAY}}]' 2>/dev/null || true
#    (If your CLI version rejects --tag-specifications on this command,
#     drop it and tag afterwards with: aws rds add-tags-to-resource)

  aws rds wait db-instance-available \\
    --region us-east-1 \\
    --db-instance-identifier ${RESTORE_ID}
#    Typical wait: 10–20 min.

## 3. Get the restored endpoint. This hostname + the SAME database name,
#     username and password as production form the DATABASE_URL you will
#     pass to 02-capture-schema.sh onward:

  aws rds describe-db-instances \\
    --region us-east-1 \\
    --db-instance-identifier ${RESTORE_ID} \\
    --query 'DBInstances[0].Endpoint.Address' \\
    --output text

#     DATABASE_URL shape (note: contains "baseline-restore" -> accepted):
#       postgres://<user>:<pass>@${RESTORE_ID}.<hash>.us-east-1.rds.amazonaws.com:5432/<dbname>?sslmode=require

## 4. TEARDOWN — after the runbook completes (or on abort). Deleting the
#     restored instance is safe at any time; it holds no state anyone
#     needs. KEEP the snapshot for 14 days as the rollback anchor.

  aws rds delete-db-instance \\
    --region us-east-1 \\
    --db-instance-identifier ${RESTORE_ID} \\
    --skip-final-snapshot

#     After 14 quiet days, optionally delete the snapshot:
#   aws rds delete-db-snapshot \\
#     --region us-east-1 \\
#     --db-snapshot-identifier ${SNAP_ID}

=============================================================================
 Next: run 02-capture-schema.sh with the restored copy's DATABASE_URL.
=============================================================================
EOF
