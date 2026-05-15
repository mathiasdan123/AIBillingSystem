---
description: Turn a product goal into a competitive gap analysis and roadmap
---

The user has stated a product goal: **$ARGUMENTS**

Treat this as a structured product-strategy exercise for the AIBillingSystem codebase. Work through these steps:

1. **Parse the goal.** Identify the named competitors (if any) and which dimension each is the benchmark for (e.g. practice management vs. billing/claims). If no competitor is named, treat the goal as an absolute capability target.

2. **Inventory current state.** Use the Explore agent to thoroughly inventory what AIBillingSystem already does in the relevant area(s) — page components in `client/src/pages/`, route files in `server/routes/`, services in `server/services/`, schema in `shared/schema.ts`. Note which features are fully built vs. scaffolded.

3. **Profile the competitors.** From general knowledge, lay out what each named competitor is known for — their core strengths, signature features, and target users. Be honest about the limits of your knowledge and flag where it may be dated.

4. **Gap analysis.** Produce a table: capability | AIBillingSystem today | competitor benchmark | gap severity (none / minor / major / missing). Group by area.

5. **Roadmap.** Recommend a prioritized, phased set of changes to close the gaps that matter most for the stated goal. For each item: what to build, rough effort (S/M/L), which files/areas it touches, and why it moves the needle on the goal. Lead with the highest-leverage work.

6. **Honest assessment.** End with a candid take: is the goal realistic, what's the single biggest risk, and what would you cut from scope.

Keep compliance constraints from CLAUDE.md in mind (accuracy framing, not "optimization/maximization" in customer-facing language). Do not write code in this command — it produces a plan. Offer to start implementation afterward.
