# AWS IAM source of truth

This directory holds the IAM policies that gate our deploy pipeline. The
files here are the source of truth — if the live AWS policy drifts from
what's checked in, fix live to match.

## github-deploy-policy.json

Inline policy `DeployPipeline` attached to IAM role `therapybill-github-deploy`.
The role is assumed by GitHub Actions via OIDC (see `.github/workflows/deploy.yml`)
to run the deploy: upload source, trigger CodeBuild, run the migration task,
roll the ECS service.

### Update procedure

After editing the JSON in this file:

```bash
aws iam put-role-policy \
  --role-name therapybill-github-deploy \
  --policy-name DeployPipeline \
  --policy-document file://.aws/github-deploy-policy.json

# Verify
aws iam get-role-policy \
  --role-name therapybill-github-deploy \
  --policy-name DeployPipeline \
  --query 'PolicyDocument.Statement[].Sid' --output text
```

### History

- **2026-05-28**: added `RunMigrationTask` + `PassECSRolesToMigrationTask`
  statements to support the new "Run pending DB migrations" step in
  `deploy.yml`. First run of that step failed on 2026-05-27 with
  `AccessDeniedException` on `ecs:DescribeTaskDefinition` — this update
  closes the gap. See also the migration step's full context in CLAUDE.md.
