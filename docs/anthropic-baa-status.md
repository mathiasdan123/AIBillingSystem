# Anthropic API BAA — Status & Reference

_Last updated: July 14, 2026_

## Current status: ✅ Escalated to Anthropic's Privacy Team (awaiting email reply)

On July 14, 2026, the BAA request was escalated to a human on Anthropic's Privacy Team via the Console support messenger (Fin). They will respond by email to **daniel@therapybillai.com**.

**Conversation ID (reference):** 215475077323219

## Account / org details
- **Product surface:** first-party Anthropic API (Messages API, `ANTHROPIC_API_KEY`)
- **Organization:** daniel's Individual Org
- **Organization ID:** 75169edf-cffe-451e-8c23-223b2e70ac01
- **Account email:** daniel@therapybillai.com
- **Role:** Daniel Kramer, Founder / org Admin (authorized to sign)

## What was confirmed
- A HIPAA BAA **is available for the first-party API** — there is **no volume threshold and no enterprise-only requirement**. Anthropic's own Console support (Fin) and the buying-agent chat both confirmed this in writing.
- Process: org admin signs the BAA → Anthropic provisions a dedicated org with HIPAA-readiness controls enabled → HIPAA-ready mode enforces feature restrictions automatically (non-eligible features return a 400 error).
- The compliance table in Anthropic's Trust Center shows "Claude via Anthropic's API" is in scope for HIPAA (green check).

## Why it took so long
The BAA sits across legal/sales/compliance and is gated behind humans. The sales "buying agent" chat and general support kept deflecting ("enterprise only") because that channel can't submit an API BAA request — not because Daniel didn't qualify. The fix was escalating through the **Console → Get help → Fin**, which transitions to the Privacy Team.

## Next steps
1. Watch **daniel@therapybillai.com** for the Privacy Team reply.
2. When the BAA arrives, review and sign (Daniel is authorized as Founder/Admin).
3. After signing, Anthropic enables HIPAA-ready mode on the org.
4. Pull the **HIPAA-ready implementation guide** from the Trust Center (trust.anthropic.com — access approved, NDA required) to confirm which API features are eligible for PHI.
5. A follow-up reminder is scheduled for **Fri, July 17, 2026** if no reply arrives.

## ⚠️ Compliance note (until BAA is signed)
Do **not** send real patient PHI through the Claude API until the BAA is in place. Use de-identified or synthetic data only. TherapyBill AI is live with a Claude-powered assistant "available on every page" — confirm that feature is not passing real patient data to the API in the meantime.

## Channels used (for reference)
- Trust Center (docs + compliance team): https://trust.anthropic.com
- Support help center: https://support.claude.com/en/
- Console support messenger: platform.claude.com → click name (lower-left) → "Get help"
- Contact sales (sales/buying-agent — could NOT submit the BAA): https://www.anthropic.com/contact-sales
- BAA policy doc: https://privacy.claude.com/en/articles/8114513-business-associate-agreements-baa-for-commercial-customers
