# Voice-Agent Partner Integration — Proposal

**Status:** Founder-approved 2026-05-13 to start partner conversations.

## One-line summary

Add an AI voice-agent integration (recommend Infinitus) so the system can place payer phone calls programmatically — replacing the last 15-20% of payer interactions that X12 / Stedi APIs don't cover.

## Why now

Stedi gets us most of the way: eligibility, claims, status, ERAs, COB, prior-auth indicator, discovery. Five categories still require a human on the phone:
- Accumulator data ("how many of the 30 allowed therapy visits has the patient used?")
- Prior-auth status by auth number
- Appeal status mid-flight
- Claim corrections (typos, member ID fixes)
- Exception / contract calls

Each costs a biller 15-30 minutes including hold time. Practices estimate 10-30 of these calls per week per biller. That's the next obvious lever after Stedi.

## What we'd build

A "Call payer" action in three places where the system can't currently answer the question itself:

1. **Patient page** — "Check visits used this year" (the accumulator question)
2. **Prior-auth detail page** — "Check status of auth #X"
3. **Appeal detail page** — "Check appeal status"

Flow: click the button → POST a structured call task to the partner's API (payer, member ID, question script) → agent calls overnight → webhook returns structured results → results land on the relevant page next morning. The staff member gets a notification, never picks up the phone.

## Partner shortlist

| Partner | Fit | Notes |
|---|---|---|
| **Infinitus** | ⭐ Default | Stedi Platform Partner. Behavioral health is one of their largest verticals. >5M completed calls. |
| Pylon | Backup | Similar profile, smaller volume, may price more aggressively. |
| Sully / Notable | Only if consolidating | Broader RCM platforms — voice is one feature among many. |

**Recommend Infinitus** — direct fit, Stedi-partner means contract / data-flow is familiar territory, and we don't need their other features.

## Engineering effort

~1 week for a feature-flagged MVP:

- Partner SDK wrapper in `server/services/voiceAgentService.ts`
- Webhook handler at `/api/webhooks/voice-agent`
- New `voice_agent_calls` table linking to patient / auth / appeal
- 3 new buttons + result-display components on existing pages
- Feature flag `VOICE_AGENT_ENABLED` so we can ship dark and turn on per practice

## Cost model

| Item | Per call |
|---|---|
| Partner API (Infinitus est.) | ~$5-15 |
| Biller time replaced (fully loaded) | ~$25-50 |
| Net savings per call | ~$15-40 |

- Break-even per practice at ~10 calls/month
- Most practices do 40-100 calls/month

## Risks

- **HIPAA / BAA** — Partner must be on a BAA. Infinitus has provider BAAs ready; standard checkbox but blocker if skipped.
- **Call success rate <100%** — Agents sometimes get transferred to a rep who refuses to talk to a bot. Build a "human follow-up needed" fallback state in the UI.
- **Pricing opacity pre-contract** — Negotiate volume tiers before committing.

## Next actions

- [x] Founder green light — 2026-05-13.
- [ ] Initial outreach to Infinitus (sales@infinitus.ai or via Stedi Platform Partners intro).
- [ ] Discovery call — confirm behavioral-health volume, pricing tiers, BAA terms, sandbox access.
- [ ] Decision: paid add-on (additional MRR) vs. bundled in existing plan.
- [ ] Sign BAA + partner agreement.
- [ ] Engineering: 1-week MVP, feature-flagged off.
- [ ] Pilot with 1-2 friendly practices before flipping for everyone.

## Outreach email — Infinitus

> Subject: TherapyBill AI × Infinitus — voice-agent integration for behavioral health
>
> Hi —
>
> We run TherapyBill AI, a billing platform for behavioral health and therapy practices. We're built on Stedi for X12 (eligibility, claims, status, ERAs, COB), and looking to add programmatic payer phone calls for the cases X12 can't answer — accumulator data, auth status, appeal status.
>
> Saw you on Stedi's Platform Partners list and your behavioral-health track record. Would love a 30-min intro to talk about integration shape, pricing tiers, and BAA terms.
>
> Are you taking calls next week?
>
> Thanks,
> [Founder name]
> [Title], TherapyBill AI

## See also

- Stedi blog: [Replace payer phone calls with Stedi](https://www.stedi.com/blog/replace-payer-phone-calls) — the post that inspired this. The closing section explicitly recommends voice-agent partners for the last-mile use cases.
- [denials-guide-founder.md](denials-guide-founder.md) — context on the denial workflow that voice-agents would extend.
