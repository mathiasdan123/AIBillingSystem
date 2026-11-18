# CloudWatch Synthetics canaries

Source of truth for the canary scripts that run against production from
`us-east-1`. Each canary has a directory named after it holding its handler
file; `deploy.sh` stages it into the `nodejs/node_modules/` layout the
Synthetics Node.js runtime expects (kept flat here because any
`node_modules/` path is gitignored).

| Canary | Schedule | Alarm | What it asserts |
|---|---|---|---|
| `therapybill-demo-path` | every hour (at :35) | `therapybill-demo-path-broken` (SNS email) | `/api/health` healthy with DB healthy → `/api/demo-login` returns a session → `/api/patients` returns **at least 6** patients |

## Why "at least 6", not "exactly 6"

The demo practice seeds 6 canonical patients (`DEMO_PATIENTS` in
`server/services/demoPractice.ts`) plus QA fixture patients
(`DEMO_FIXTURE_PATIENTS`, e.g. Riley Nodob), and live demos and QA sweeps add
patients by hand. On 2026-11-17 the canary's original `=== 6` assertion fired
the alarm the moment the count moved; the demo path itself was healthy. The
canary guards that the path works and the list is populated, not an exact
census, so the check is a floor. `.github/workflows/health-check.yml` applies
the same `>= 6` rule every 6 hours from GitHub.

Do **not** run `scripts/run-reconcile-demo-practice.sh` to "fix" a count
mismatch: it wipes the demo practice, and the reseed restores the fixtures
anyway.

## Deploying a script change

From a machine or AWS CloudShell session with the account's credentials:

```bash
infra/canaries/deploy.sh therapybill-demo-path --dry-run   # builds the zip, deploys nothing
infra/canaries/deploy.sh therapybill-demo-path             # uploads; takes effect next run
```

Console alternative: CloudWatch → Application Signals → Synthetics Canaries →
the canary → **Edit canary** → replace the script editor's contents with the
file from this directory → **Save**. Then copy the same text here in a PR so
the repo and the console do not drift apart again.

Changing the canary's name, schedule, timeout, role or runtime is done in the
console or with `aws synthetics update-canary`; `deploy.sh` only replaces the
code and deliberately leaves the runtime version alone.

## Reading a failure

CloudWatch → Synthetics Canaries → the canary → **Availability** → click the
failed run. The failure message is the `throw` text from the script and names
the step; the `patients` step reports the count it saw. Run artifacts are kept
31 days in `therapybill-canary-artifacts-<account>/canary`.
