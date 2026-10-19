# Security Incident Memo — Access Control Findings (Oct 2026)

**Prepared for:** legal counsel review
**Date:** 2026-10-19
**Prepared by:** engineering (security audit + remediation on branch `claude/therapybill-security-audit-vcx9ji`, merged to `main` in PR #389)
**Status:** Remediated and deployed to production. Prepared for a risk-assessment / documentation decision, not as a notification.

## What happened

A security audit of the TherapyBill AI platform (2026-10-16) found 6 broken-access-control (IDOR) defects across the REST API, present in production code since **March–June 2026**:

| Finding | Routes affected | What was missing | Introduced | Fixed |
|---|---|---|---|---|
| F1 | `GET /api/patients/:id/cost-estimate` | No tenant-ownership check at all | 2026-03-09 | 2026-10-17 |
| F2 | `GET /api/patients/:id/documents` | No tenant-ownership check, no role check | 2026-03-09 | 2026-10-17 |
| F3 | 5 routes under `/patients/:patientId/plan-documents` and `/plan-benefits` | Checked admin role only, not practice ownership | 2026-03-13 | 2026-10-17 |
| F4 | `GET /api/claims/:id/preview-payload` | No tenant-ownership check | 2026-04-20 | 2026-10-17 |
| F5 | `POST /api/claims/:id/check-status` | No tenant-ownership check | 2026-03-09 | 2026-10-17 |
| F4a | 9 routes/middleware across `claims.ts`, `appointments.ts`, `practices.ts` | Used `role === 'admin'` instead of a platform-admin flag, so any practice's own admin bypassed the tenant check | 2026-06-11 (itself introduced by an earlier security-fix commit) | 2026-10-17 |

Each defect, if exploited, could have let an authenticated user of one practice read or modify data belonging to a **different** practice by guessing or enumerating a numeric ID (patient, claim, insurance plan document).

## Why this did not expose real patient PHI

Cross-tenant exposure requires a second tenant whose real PHI could be reached. **We verified directly against the production database that no second real tenant has ever existed:**

```
practices table: 2 rows total
  id=1  "Wonder Kids Therapy Center LLC"           created 2026-03-25   is_demo = false  (the only real practice)
  id=2  "Bright Steps Pediatric Therapy (Demo)"     created 2026-07-06   is_demo = true

patients.practice_id  — distinct values in production: [1, 2]
claims.practice_id    — distinct values in production: [1, 2]
```

No orphaned, hidden, or deleted-practice IDs exist in either table. The only "other" practice a cross-tenant request could ever have reached is the demo practice, which contains synthetic data — the application's own code (`rejectIfDemoDataMessage` and related guards) is already designed to refuse real actions against it.

**Conclusion:** the access-control defects were real and have been fixed, but the precondition for an actual HIPAA-relevant exposure (a second real tenant's PHI) never existed during the window these defects were present. This is not an inference from absence of evidence — it is a direct, verified fact about the production data.

## What was done

- All 6 findings fixed in 5 commits, each with a regression test (25 new tests total), on PR #389.
- `npx tsc --noEmit` clean; full server test suite (2,345 tests) passing.
- Deployed to production 2026-10-17, 00:17 UTC; confirmed via the Deploy to Production workflow and subsequent Production Health Check runs.
- Full technical findings, methodology, and false-positive analysis: `security-audit/REPORT.md` in this repository.

## Open question for counsel

Whether this should be formally logged via the application's existing `breach_incidents` table/workflow (built against 45 CFR §§ 164.400-414) as an assessed, non-reportable incident — for the audit trail — or whether no further documentation is needed given the verified absence of a second real tenant.
