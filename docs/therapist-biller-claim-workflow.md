# Therapist → Biller Claim Workflow (Design)

**Status:** Design for review — not yet built. Requested by Daniel 2026-08-26.
**Goal:** Appointment → therapist writes SOAP note → therapist signs it with CPT
codes attached **without ever seeing a price** → a draft claim materializes for
the biller with codes and the practice's pricing applied → biller reviews,
Test-Runs, submits.

## Why this shape

- **Role separation is already policy.** `requireFinancialRole` blocks
  therapists from `/api/claims` and every fee-schedule route (PR #242, the
  Kelli requirement). That's correct — and it also means a therapist cannot
  *trigger* claim creation today. The flow dead-ends at the signed note until
  a biller re-keys everything.
- **The trigger must be server-side.** A therapist-clicked "create claim"
  button would need claims-route access. Instead: **signing the SOAP note is
  the trigger.** The server drafts the claim in the background under system
  authority, not the therapist's.

## Flow

1. **Appointment → note.** Calendar (Kelli's request, 2026-08-24): each
   appointment carries a "Write note" action opening the SOAP editor
   pre-linked to patient + session + date of service.
2. **Therapist attaches codes, price-blind.** The SOAP editor gains a CPT
   picker fed by a **price-stripped** endpoint (below). Diagnosis via the
   `Icd10Combobox` (search + write-in, shipped #314), prefilled from the
   patient's last diagnosis (#314).
3. **Sign → draft claim.** On sign (and co-sign completion where required),
   `claimDraftFromNoteService` runs server-side:
   - line items from the note's CPTs; rate resolved from `practice_cpt_rates`
     (**no fallback** — the standing rule); dateOfService = session date;
     diagnosis from the note's ICD-10s.
   - unpriced CPT → the claim drafts anyway with the line held, and a
     **biller task** is created naming the unpriced code. Never block the
     therapist on a billing-config problem; never silently price.
   - idempotent per note (`claims.sourceNoteId`, unique): re-signing after a
     co-sign cycle updates the same draft, never duplicates.
4. **Biller queue.** Drafts land with `status='draft'`, badge "from note".
   Billing Tasks page (route mount fixed in #311) shows "N notes awaiting
   claim review". Biller adjusts → Test Run → Submit.

## Price blindness — the load-bearing details

- **New endpoint or role-stripped response:** `GET /api/cpt-codes` currently
  returns `baseRate`. For `role === 'therapist'` the route strips every money
  field (`baseRate`, `suggestedRate`) server-side. Client hiding is not
  enough — the number must not leave the server.
- The SOAP editor never renders totals, rates, or the claim itself. The
  therapist's receipt is: "Note signed. Billing has been notified."
- Audit: drafted claims record `createdBy: 'system:note-sign'` plus the
  signing user id, so the coding decision trail (compliance requirement:
  therapist makes the final coding call) is preserved without exposing money.

## Non-goals (this slice)

- No auto-submission. A human biller always reviews and submits.
- No changes to co-sign policy; a claim drafts only when the note reaches its
  practice's sign-complete state.
- No retro-drafting for already-signed notes (one-time backfill decision for
  Daniel: offer a "draft claims for N signed unbilled notes" button, billers
  only).

## Build plan (rough)

| Slice | Content | Size |
|---|---|---|
| 1 | Price-stripped CPT endpoint by role + SOAP editor CPT/ICD pickers | S |
| 2 | `claimDraftFromNoteService` + `sourceNoteId` (additive column) + sign hook | M |
| 3 | Biller queue badge + "from note" surfacing on Claims | S |
| 4 | Calendar "Write note" entry point (Kelli item) | S |

Open questions for Daniel:
1. Should therapists pick **units** too (15-min codes ⇒ units matter), or default 1 and let the biller set?
2. When a note is amended *after* its claim was submitted — draft a corrected claim (frequency code 7) automatically, or biller-initiated only?
3. Backfill for existing signed-unbilled notes: yes/no?
