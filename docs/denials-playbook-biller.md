# Denials & Underpayments — Biller Playbook

The day-to-day guide for the staff member responsible for fighting claim denials and underpayments. Assumes working knowledge of CARC codes, ERAs, and the standard 30-90 day appeal cycle.

## Home base: `/appeals`

Three-column Kanban:
- **Denied Claims** — payer rejected. Need an appeal created.
- **In Progress** — appeals started or submitted.
- **Resolved** — won, lost, or partial.

Header strip shows the only five numbers that matter:
- **$ Denied Awaiting Appeal**
- **Pending Submissions**
- **Past Deadline** — if non-zero, fix today.
- **Success Rate (90d)**
- **$ Recovered**

## Daily loop

### 1. Triage each denied claim
- Open the claim card. Note **denial category** and **denial reason**.
- Open `/remittance` in another tab. Find the ERA that posted this claim. Click **View**. The line-item table shows **CARC** and **RARC** codes — that's the real reason. "Adjustment Details" expands the descriptions.
- If the claim was *short-paid* (not denied), it's an underpayment — see section 5.

### 2. Re-check claim status before appealing
On the claim detail page (`/claims`), click **Check Claim Status**. This fires a real-time 276/277 to Stedi. If the payer now reports pending or already reprocessed, don't appeal — wait or note and move on.

### 3. Create the appeal
On `/appeals`, click **Create Appeal** on the denied-claim card.
1. Verify **appealed amount** is right — you can appeal a subset of lines.
2. Click **Create Appeal**. The AI drafts a letter from the denial reason + the appeal-outcome learning service's history of winning arguments for this payer + this denial reason.
3. Appeal moves to **In Progress** as `draft`.

### 4. Edit and submit
Open the new draft.
1. Read top-to-bottom. **Never submit untouched.** Add payer-specific detail: missing modifier, auth number, referring provider, medical-necessity language from the SOAP note.
2. Attach supporting docs:
   - Medical necessity → SOAP note
   - "Patient not covered" → eligibility printout
   - "No authorization" → auth letter
3. **Save Changes** → **Mark Ready for Submission**.
4. Submit via the payer's required channel (portal, fax, mail). The system does **not** auto-submit appeals.
5. Click **Mark as Submitted** and paste the confirmation number into Notes.
6. After payer acknowledges receipt, click **Mark as In Review**.

### 5. Underpayments — `/payer-contracts`
Open the **Underpayments** tab. Only populated if the practice has uploaded the payer's fee schedule.

For each underpaid claim:
1. Confirm the contract row is the right effective date for the DOS. Stale contracts cause false positives.
2. If the gap is real, **Create Appeal** the same way. The AI draft includes the contracted-rate variance.
3. These usually go to **provider relations**, not the standard appeals address.

### 6. Recording the outcome
When the payer responds (30-90 days):
1. Open the appeal.
2. **Record Outcome** → Won / Lost / Partial → recovered amount → paste payer's response.
3. Outcome feeds the appeal-outcome learning service for future drafts.

## Weekly hygiene (Mondays, 15 min)
1. `/appeals` In Progress sorted by deadline — handle anything red (<7 days).
2. `/reports/timely-filing` — submit before 90-day window closes.
3. `/payer-contracts` Underpayments — scan for patterns. A payer consistently 15% short on 90837s is a contract conversation, not per-claim appeals.

## Rules
- Don't appeal eligibility denials before re-running eligibility for the DOS.
- Don't rewrite the AI letter from scratch — edit, or **Regenerate** with a sharper prompt.
- Don't mark **Won** until payment lands on an ERA. Phone-tree promises don't count.

## Investigation map
When something looks wrong, check in this order:
- "I appealed and never heard back" → In Progress, days since submitted. >45 days = call the payer.
- "ERA says paid but claim still denied" → click **Check Claim Status** to force a sync.
- "Underpayment tab shows a claim that paid correctly" → contract row stale or wrong effective date.
- "AI letter cited wrong SOAP note" → claim linked to wrong session; fix on claim page then **Regenerate**.

## The data trail (for debugging)
For one denied-to-paid cycle:
- `claims` — status `submitted` → `denied` → `paid`
- `payment_postings` — original ERA's adjustment
- `appeals` — `draft` → `ready` → `submitted` → `in_review` → `won`
- `audit_logs` — one row per status change (HIPAA)
- `payment_postings` — post-appeal ERA when payment arrives

Three pages do 90% of the work: `/appeals`, `/remittance`, `/payer-contracts`.
