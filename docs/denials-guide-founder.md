# Denials & Appeals — Founder's Guide

You don't fight denials yourself. This is so you can tell whether the person doing it is doing it well, and so you can talk about the feature to customers without bluffing.

## The pattern in plain English

A **claim** is a bill we send to the insurance company. Sometimes they pay it. Sometimes they don't, and they send back a code explaining why — that's a **denial**. Sometimes they pay it but less than the contracted rate — that's an **underpayment**. Both can be argued, and the argument is called an **appeal**. Appeals are a letter (sometimes with attachments) asking the payer to reconsider.

## Why it matters financially

For a typical therapy practice:
- 5-12% of claims get denied on first submission
- ~60-70% of those are winnable on appeal *if* someone files one
- Most small practices don't appeal because it's tedious

For a practice doing $1M/year, ignoring appeals costs ~$30-60K/year of recoverable revenue. Our system is designed so a non-expert can do this work.

## How our system handles it

### Step 1 — claims get classified automatically
When the insurance company's response comes back electronically, we read it. Paid in full → closed. Denied or paid short → claim shows up on the **Appeals** page in a "needs attention" list. The user does not have to hunt for denied claims.

### Step 2 — the AI writes the appeal letter
When the user clicks **Create Appeal**, the system pulls:
- The original visit notes (SOAP note)
- The patient's insurance info
- The payer's specific denial reason
- A history of which arguments have won past appeals at this same insurer for this same denial reason

Claude drafts a letter from all of that. The user edits it. They don't write from scratch.

### Step 3 — user sends the appeal
Some payers want a fax, some a portal upload, some a mailed letter — there's no standard. The user submits via the payer's process, then clicks **Mark as Submitted** in our system to log it.

### Step 4 — wait, then record the outcome
When the insurer responds (30-90 days typical), the user records **Won**, **Lost**, or **Partial** with the recovered amount. That outcome feeds the AI — so next time someone appeals a similar denial at the same payer, the draft is sharper.

## The pieces that make this defensible

- **Auto-parsing of technical denial codes** (X12 / CARC / RARC). Most competitors require manual entry.
- **Auto-detection of underpayments** when a payment lands. The user doesn't have to spot them.
- **Payer-aware AI drafts** — knows what's worked at *this* insurer, not generic templates.
- **End-to-end appeal tracking** with deadlines, so nothing falls through the timely-filing window.

## What our system does not do (yet)

- **No auto-submission** of appeals — every payer has a different process; auto-submission would skip human review and increase the lose rate.
- **No phone calls** — see [voice-agent-proposal.md](voice-agent-proposal.md).
- **No specific win-rate promises** — outcomes depend on the denial, the payer, and the documentation strength.

## What to listen for in a demo

If a prospect's biller says any of these, lead with denials/appeals:
- "We don't have time to appeal."
- "We use a spreadsheet to track denials."
- "Our denial rate is X%" (anything >5% is salvageable money).
- "We pay [name] $X/month to handle our denials." (We replace that line item.)

## Sales one-liner

> "We turn denials from a part-time job into a 15-minute Monday morning task. The AI does the drafting, the system tracks the deadlines, and the practice keeps the money it would otherwise leave with the insurer."

## See also
- [denials-playbook-biller.md](denials-playbook-biller.md) — the detailed step-by-step for the person actually doing the work.
- [voice-agent-proposal.md](voice-agent-proposal.md) — proposal for adding programmatic payer phone calls.
