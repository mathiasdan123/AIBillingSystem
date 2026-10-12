# Caregiver Agent Surface — Design Proposal

**Status:** PROPOSAL — not approved for build. Daniel to review; open questions at the end.
**Author:** drafted 2026-10-12 at Daniel's request.
**Companion:** the therapist/admin agent surface already exists (the MCP server, `server/mcp/`); this proposes the patient/caregiver counterpart.

## Why

Every therapist, caregiver, and admin will soon have their own AI assistant, and
the platforms that win are the ones those assistants can operate. TherapyBill
already has the staff side: an OAuth 2.1 MCP server with ~50 tools, parity-tested
against Blanche, role-gated, practice-scoped, with confirmation gating and its own
audit trail. The missing side is the family: a parent telling their assistant
"reschedule Maya's Tuesday session" or "pay the Wonder Kids invoice" and having it
work. Competitors ship chatbots; an open, standards-based agent surface on both
sides of the practice is a real moat.

## Non-negotiable principle (Daniel, 2026-10-12)

**Every agent-initiated write surfaces as a prompt needing approval by the
accountable human. Nothing executes silently.** Concretely, two approval layers:

1. **Caregiver approval** — the caregiver's own agent client confirms the action
   with them (MCP elicitation/confirmation on our server, so it holds even for
   clients with poor UX).
2. **Practice approval where the practice is accountable** — actions that commit
   practice resources (a booking, a reschedule into a new slot) land as
   *requests* in a practice-side approval queue, exactly like the waitlist
   confirm-first flow (#350): the slot is held `pending_confirmation`, staff
   confirm or decline, nothing auto-books. Reads and self-service actions that
   commit nothing (viewing a balance, paying an existing invoice) need layer 1
   only.

## What exists to build on

| Piece | Reuse |
|---|---|
| Patient portal identity (magic-link auth, portal sessions) | The caregiver identity anchor |
| MCP server framework (`server/mcp/`): OAuth, tool registry, confirmation, audit | Fork the framework, NOT the tool registry — this is a separate, narrower server |
| Waitlist confirm-first flow | The practice-approval pattern for bookings |
| Stripe payment links, intake forms, appointment reminders | The underlying actions already exist as practice-initiated flows |
| Support ticket + reply system | `message_practice` lands here |

## Identity and proxy consent (the hard part)

Patients here are mostly minors; the acting party is a caregiver. The model:

- **Caregiver accounts** are first-class: a caregiver record linked to one or
  more patients, each link carrying an explicit, practice-visible grant
  (`caregiver_patient_grants`: caregiver, patient, scope, granted-by, revoked-at).
  Grants are created by the practice (or by portal invite flows the practice
  initiates), never self-asserted by an agent.
- **Agent linking**: the caregiver connects their assistant via the standard
  MCP OAuth flow against their *portal* identity — a separate OAuth client and
  token audience from the staff server. Tokens scope to the caregiver's grants
  at issue time; revoking a grant invalidates the capability immediately
  (checked per request, not baked into the token).
- **Multiple caregivers** per patient are normal (two parents, grandparent);
  each has their own account, grants, and audit trail. Divorce/custody changes
  are handled by the practice editing grants — the system never adjudicates.
- **Right of access**: HIPAA supports patients/personal representatives
  accessing their own records. State rules on minors' records (especially
  adolescent sensitive services) vary; v1 sidesteps this by excluding clinical
  documentation entirely (below).

## Tool surface v1 (deliberately six verbs)

| Tool | Writes? | Approval layers |
|---|---|---|
| `get_upcoming_appointments` | no | — |
| `request_appointment_change` (book/reschedule/cancel request) | yes | caregiver confirm → practice approval queue (confirm-first) |
| `get_balance` | no | — |
| `get_payment_link` (existing invoice) | no (link only; payment happens on Stripe's surface) | caregiver confirm to issue the link |
| `complete_intake` (submit intake answers) | yes | caregiver confirm; practice reviews as today |
| `message_practice` | yes | caregiver confirm; lands in the existing support/message queue |

**Explicitly excluded from v1:** SOAP notes, evaluations, progress notes, any
clinical narrative (even the caregiver's own child's — deferred until the
minors/right-of-access review); other patients' existence in any response;
changing demographics/insurance (practice-mediated only); anything financial
beyond viewing balance and paying existing invoices.

## Abuse posture

Agent-mediated requests are **untrusted input squared** — the caregiver may be
legitimate while their agent is confused or prompt-injected by content it read
elsewhere. Therefore: per-caregiver rate limits (Redis, same pattern as Blanche
usage); every response built from practice-scoped queries that 404 out-of-grant
ids (no existence oracles); no free-text from the agent is ever executed or
shown to staff unlabeled (messages render as "via &lt;caregiver&gt;'s assistant");
the confirmation prompts restate the action in our words, not the agent's; full
audit trail per caregiver per tool call (reuse `server/mcp/audit.ts` pattern).

## Rollout sketch

1. Build behind `CAREGIVER_MCP_ENABLED` (default off) + per-practice opt-in.
2. Pilot: Wonder Kids, a handful of volunteer parents, reads + `message_practice`
   only (zero write risk), watch the audit trail for a couple of weeks.
3. Add `request_appointment_change` + intake + payment link after the pilot
   reads cleanly.
4. Marketing after, not before.

## Open questions for Daniel

1. Per-practice pricing/packaging — included, or a plan feature?
2. Does the practice approval queue live in the existing Front Desk page or the
   support queue? (Front Desk feels right: it's scheduling.)
3. Minimum age/consent policy for patients who are not minors (self-managing
   teens) — practice-decided or platform default?
4. Is Wonder Kids the pilot given the Prompt-migration hold, or do we wait for
   a practice that's fully live on scheduling?

## Out of scope here, related

- Listing the existing staff MCP server in public connector directories
  (separate, near-term task — mostly marketing).
- Agent-to-agent flows (a caregiver's agent talking to our support triage
  agent) — v2 conversation once both ends exist.
