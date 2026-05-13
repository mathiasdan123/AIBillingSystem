# Prompt EMR Report Parity — Gap Analysis

**Date:** 2026-05-13
**Source:** Prompt EMR /reports page (Operations + Claims + Revenue tabs visible in screenshot)
**Purpose:** Map every Prompt report to TherapyBill AI state, estimate effort, flag demo-critical reports so we can prioritize.

## TL;DR

| Category | Prompt count | Have today | Partial | Missing | Demo-critical |
|---|---|---|---|---|---|
| Operations | 24 | 4 | 7 | 13 | 6 |
| Claims | 12 | 5 | 3 | 4 | 5 |
| Revenue | 14 | 4 | 4 | 6 | 5 |
| **Total (3 tabs shown)** | **50** | **13** | **14** | **23** | **16** |

**Other tabs/modules user mentioned but not shown:** Download, Closed Period, Dashboard, Address Book, Company, Patients Data, Waitlist. Likely adds ~20-40 more reports. Full parity scope: 70-90 reports.

**Recommended first batch (the 16 demo-critical reports):** build these in 2-3 weeks, ship the rest in follow-on batches as customer demand pulls them.

## Legend

- **State:** ✅ have it / 🟡 data exists, no UI / 🟥 missing data
- **Effort:** S (≤1 day) / M (2-3 days) / L (1+ week) / XL (new schema + feature)
- **Demo:** ⭐ = often makes-or-breaks a sales demo

## Operations (24 reports)

| # | Report | Definition | State | Our equivalent | Effort | Demo |
|---|---|---|---|---|---|---|
| 1 | Operations Report | Practice-wide ops summary (visits, cancellations, no-shows, etc.) | 🟡 | `/analytics` has parts, no single rollup | M | ⭐ |
| 2 | Outbound Communications Log | List of all emails/SMS sent to patients | 🟡 | `messageNotifications` table exists, no UI | M | |
| 3 | Patient Credits | Patients with credit balances | 🟡 | `payments` table tracks overpayments, no report | M | ⭐ |
| 4 | Created Cases | New clinical cases opened in period | 🟥 | We don't have a "case" entity, only claims. Maps loosely to "new patients" | L | |
| 5 | Unverified Benefits | Patients without recent eligibility check | 🟡 | `eligibilityChecks` exists, easy query | S | ⭐ |
| 6 | Referrals by Month | Referral volume + source breakdown | 🟡 | `referrals` + `referralSources` tables exist | S | ⭐ |
| 7 | Expired Plans of Care | POCs past expiration | 🟥 | No POC table; `treatmentPlans` exists | L | |
| 8 | Online Scheduling | Public booking funnel + conversion | 🟡 | `onlineBookings` table exists | M | |
| 9 | Outcomes | Outcome measure summaries | ✅ | `/outcome-measures` page | — | |
| 10 | Cancellations Report | Cancellations by reason, therapist, period | 🟡 | `appointments` has status; easy aggregation | S | ⭐ |
| 11 | Net Case Flow | Cases opened minus closed | 🟥 | No case entity | L | |
| 12 | Capacity Utilization | Booked vs available slots per therapist | 🟡 | `therapistAvailability` + `appointments` give this | M | ⭐ |
| 13 | Deleted Visits | Audit log of removed appointments | 🟡 | `auditLog` table exists | S | |
| 14 | Tasking Report | Internal tasks (assigned, pending, overdue) | 🟡 | `/billing-tasks` exists; no rollup view | S | |
| 15 | Patient Alerts | Open patient-level alerts | 🟥 | No alerts table | M | |
| 16 | Cross-facility Access | Logged access across multiple locations | 🟡 | `auditLog` + `locations` could power this | M | |
| 17 | Check Ins | Patient check-in status per appointment | 🟥 | `appointments.status` lacks "checked_in" granularity | M | |
| 18 | Intake Completion | Intake form completion rates | 🟡 | `patients.intakeCompletedAt` exists | S | ⭐ |
| 19 | Pending Co-Signatures | Notes needing supervisor sign-off | 🟥 | No co-sign workflow in `soapNotes` yet | L | |
| 20 | Intakes by Case | Intake forms per case | 🟥 | No case entity | L | |
| 21 | Expected Collections | Forecasted A/R | ✅ | `/reimbursement` page has this | — | ⭐ |
| 22 | Deleted Inventory | Audit log of inventory deletions | 🟥 | No inventory table | XL | |
| 23 | Days to Note Completion | Time from visit to SOAP signed | 🟡 | `appointments` + `soapNotes` joined on dates | S | ⭐ |
| 24 | Pending Files | Documents awaiting review | 🟡 | `documents` table; simple filter | S | |

## Claims (12 reports)

| # | Report | Definition | State | Our equivalent | Effort | Demo |
|---|---|---|---|---|---|---|
| 1 | Claims Report | All claims filterable by status/date/payer | ✅ | `/claims` + Reports builder claims type | — | ⭐ |
| 2 | Detailed Charges | Per-line-item charge breakdown | ✅ | `claimLineItems` powers this; needs UI polish | S | ⭐ |
| 3 | Individual Charges | Charges per patient/visit | 🟡 | Same data as #2, different cut | S | |
| 4 | RTM Charges | Remote Therapeutic Monitoring CPTs (98975-98981) | 🟡 | `claimLineItems` has CPT; just filter | S | |
| 5 | Failed Edits & Rejections | Claims rejected by clearinghouse | ✅ | Claims have `rejected` status + reason | — | ⭐ |
| 6 | Comments Report | Comments left on claims | 🟥 | No claim-comments table | M | |
| 7 | Deleted Remittances | Audit log of removed payments | 🟡 | `auditLog` table | S | |
| 8 | Productivity | Visits + revenue per therapist | ✅ | `/therapist-productivity` page | — | ⭐ |
| 9 | Timely Filing | Claims approaching filing deadline | 🟡 | `claims.dateOfService` + payer rules | S | ⭐ |
| 10 | Deleted Payments | Audit log of removed payments | 🟡 | `auditLog` table | S | |
| 11 | Claim Success | Paid-on-first-submission rate | 🟡 | `claims.status` aggregation | S | ⭐ |
| 12 | Claim Submission Log | Submitted timestamps + clearinghouse refs | ✅ | Already shown in claim detail | — | |

## Revenue (14 reports)

| # | Report | Definition | State | Our equivalent | Effort | Demo |
|---|---|---|---|---|---|---|
| 1 | Collections Report | Money received by period/source | ✅ | `/analytics` + `payments` table | — | ⭐ |
| 2 | Visits Revenue Report | Revenue per visit/CPT | 🟡 | `claims` + `payments` joined on visit | M | ⭐ |
| 3 | A/R Report | Accounts receivable aging buckets | ✅ | `/reimbursement` page (`get_ar_aging` MCP tool too) | — | ⭐ |
| 4 | Posting Log | Sequential payment-posting history | 🟡 | `payments` table has timestamps | S | |
| 5 | Detailed ERA Report | ERA breakdown by claim/CPT | ✅ | `/remittance` page | — | ⭐ |
| 6 | Revenue by CPT Code | Revenue grouped by CPT | ✅ | Reports builder "revenue" type | — | ⭐ |
| 7 | Inventory | Inventory-related revenue (supplies, devices) | 🟥 | No inventory module | XL | |
| 8 | Remit Allocation Report | How payments split across claim lines | 🟡 | `claimLineItems` has paid amounts | M | |
| 9 | Adjustments Report | Contractual + bad-debt adjustments | 🟡 | `claims.adjustments` + `primaryAdjustmentAmount` exist | S | ⭐ |
| 10 | Financial Agreements Report | Active payment plans | 🟥 | No payment plans table | L | |
| 11 | Reversals Report | Reversed payments | 🟥 | No reversal flag on payments | M | |
| 12 | Old A/R Report | A/R > 120 days | 🟡 | Same data as #3, filtered | S | |
| 13 | Patient Write Offs | Patient-responsibility writeoffs | 🟥 | No writeoff category on adjustments | M | |
| 14 | Cash Allocation | Cash receipts split by claim/patient | 🟡 | `payments` table | S | |

## Demo-critical 16 — recommended first batch

These are the ones most likely to come up in a Prompt-vs-TherapyBill sales conversation, ordered by likely impact:

1. **A/R Report** ✅ — already have at `/reimbursement`
2. **Days to Note Completion** 🟡 (S) — simple SQL on appointments+soapNotes
3. **Capacity Utilization** 🟡 (M) — therapist availability vs bookings
4. **Productivity** ✅ — already have at `/therapist-productivity`
5. **Failed Edits & Rejections** ✅ — already have via claims status
6. **Timely Filing** 🟡 (S) — date math on claims
7. **Cancellations Report** 🟡 (S) — appointments status aggregation
8. **Net Collections / Collections Report** ✅ — already at `/analytics`
9. **Revenue by CPT Code** ✅ — already in Reports builder
10. **Adjustments Report** 🟡 (S) — already have the data
11. **Detailed ERA Report** ✅ — already at `/remittance`
12. **Intake Completion** 🟡 (S) — patients.intakeCompletedAt
13. **Patient Credits** 🟡 (M) — overpayment balances
14. **Operations Report** 🟡 (M) — composite rollup
15. **Referrals by Month** 🟡 (S) — referrals table aggregation
16. **Unverified Benefits** 🟡 (S) — patients without recent eligibility

**Effort breakdown:**
- 7 reports already exist (just need to be surfaced under matching tab names) → 1 day
- 7 are size S (data exists, just need queries + UI) → 7 days
- 2 are size M (slightly more involved) → 4 days
- **Total: ~2 weeks for the demo-critical 16**

## What I'd skip for now

The 14 size-L/XL "missing data" reports (Cases, Plans of Care, Inventory, Co-Signatures, Payment Plans, etc.) require new schema or new features. These are 3-6 week projects each. **Don't build them unless a specific customer asks** — they're long-tail features that exist in Prompt because Prompt accumulated them, not because every practice uses them.

## Phasing proposal

| Phase | Reports | Duration | Goal |
|---|---|---|---|
| **Phase 1 — Surface what we have** | 7 already-have reports get renamed/grouped to match Prompt's tabs | 1 day | Defensible demo answer: "yes we have those" |
| **Phase 2 — Quick wins** | 9 demo-critical S-effort reports | 1 week | Visible feature parity on the most-asked-about reports |
| **Phase 3 — Medium effort fills** | 4-6 M-effort reports | 1 week | Round out the demo-critical 16 |
| **Phase 4 — On demand** | Anything customer-requested from the L/XL list | as needed | Drive scope by real customer asks |

End of Phase 3 (~2-3 weeks), we should look comprehensive in any Prompt-vs-us conversation without having built 35 long-tail reports nobody uses.
