/**
 * Recovery Ledger — storage aggregation.
 *
 * "Sheer for practices," the payer-advocate wedge, quantified. One surface
 * that answers "how much money did the system save / recover for me?"
 *
 * HONESTY CONTRACT (this is a money-claims surface — numbers must be defensible):
 *   - appealsRecovered    → HARD DOLLARS. Persisted in appeal_outcomes.
 *   - underpaymentsCaught → HARD DOLLARS. Contract-vs-paid gap on claims
 *     flagged with an 'underpayment' follow-up; we sum the measured gap.
 *   - denialsFlagged      → COUNT ONLY, never monetized. A high-risk
 *     prediction is not proof a denial was prevented (the claim might have
 *     paid anyway), so v1 deliberately does not assign it a dollar value.
 *
 * Headline `valueDelivered` = appealsRecovered + underpaymentsCaught ONLY.
 * It is never inflated with prevented-denial estimates.
 *
 * v1 is read-only over already-persisted data — NO schema change. v2 (after
 * real claims flow) will add a persisted underpaymentAmount column and a
 * denial-remediation audit trail so the denials pillar can become honest
 * hard dollars instead of a flagged count.
 */

import { claims, appealOutcomes, claimFollowUps } from "@shared/schema";
import { db } from "../db";
import { and, eq, gte, lte, sql } from "drizzle-orm";

export interface RecoveryLedgerStats {
  appealsRecovered: {
    count: number;
    totalAppealed: number;
    totalRecovered: number;
    successRate: number;
  };
  underpaymentsCaught: { count: number; amount: number };
  denialsFlagged: { count: number; note: string };
  valueDelivered: number;
  windowStart: string | null;
  windowEnd: string | null;
}

export async function getRecoveryLedgerStats(
  practiceId: number,
  startDate?: Date,
  endDate?: Date,
): Promise<RecoveryLedgerStats> {
  // ── Pillar 1: Appeals recovered (HARD DOLLARS) ──────────────────────
  // appeal_outcomes is the immutable analytics record; outcome ∈ won|partial
  // carries recoveredAmount → realized recovery.
  const appealWhere = [eq(appealOutcomes.practiceId, practiceId)];
  if (startDate) appealWhere.push(gte(appealOutcomes.createdAt, startDate));
  if (endDate) appealWhere.push(lte(appealOutcomes.createdAt, endDate));

  const [appealRow] = await db
    .select({
      resolved: sql<number>`COUNT(*)::int`,
      won: sql<number>`COUNT(*) FILTER (WHERE ${appealOutcomes.outcome} IN ('won','partial'))::int`,
      totalAppealed: sql<string>`COALESCE(SUM(${appealOutcomes.appealedAmount}), 0)`,
      totalRecovered: sql<string>`COALESCE(SUM(${appealOutcomes.recoveredAmount}) FILTER (WHERE ${appealOutcomes.outcome} IN ('won','partial')), 0)`,
    })
    .from(appealOutcomes)
    .where(and(...appealWhere));

  const resolved = Number(appealRow?.resolved) || 0;
  const wonCount = Number(appealRow?.won) || 0;
  const totalRecovered = Number(appealRow?.totalRecovered) || 0;
  const totalAppealed = Number(appealRow?.totalAppealed) || 0;

  // ── Pillar 2: Underpayments caught (HARD DOLLARS) ───────────────────
  // claim_follow_ups rows of type 'underpayment' flag a measured gap. The
  // contract-vs-paid gap is a property of the CLAIM, but a single claim can
  // have multiple 'underpayment' follow-ups (e.g. an earlier one was
  // completed/dismissed and a later sweep re-flagged it). We must therefore
  // dedupe to DISTINCT claims before summing — otherwise the same gap is
  // counted once per follow-up row, inflating this money-claims surface.
  const underWhere = [
    eq(claimFollowUps.practiceId, practiceId),
    eq(claimFollowUps.followUpType, "underpayment"),
    eq(claims.isDemo, false),
  ];
  if (startDate) underWhere.push(gte(claimFollowUps.createdAt, startDate));
  if (endDate) underWhere.push(lte(claimFollowUps.createdAt, endDate));

  // One row per distinct claim that has at least one matching underpayment
  // follow-up, carrying that claim's measured gap exactly once.
  const distinctUnderpaidClaims = db
    .selectDistinct({
      claimId: claims.id,
      gap: sql<string>`GREATEST(COALESCE(${claims.expectedAmount}, 0) - COALESCE(${claims.paidAmount}, 0), 0)`.as("gap"),
    })
    .from(claimFollowUps)
    .innerJoin(claims, eq(claimFollowUps.claimId, claims.id))
    .where(and(...underWhere))
    .as("distinct_underpaid_claims");

  const [underRow] = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
      amount: sql<string>`COALESCE(SUM(${distinctUnderpaidClaims.gap}), 0)`,
    })
    .from(distinctUnderpaidClaims);

  const underpaymentCount = Number(underRow?.count) || 0;
  const underpaymentAmount = Number(underRow?.amount) || 0;

  // ── Pillar 3: Denials flagged pre-submission (COUNT ONLY) ───────────
  // High-risk predictions caught before submission. NOT monetized.
  const flagWhere = [
    eq(claims.practiceId, practiceId),
    eq(claims.isDemo, false),
    sql`${claims.denialPrediction} IS NOT NULL`,
    sql`${claims.denialPrediction}->>'riskLevel' = 'high'`,
  ];
  if (startDate) flagWhere.push(gte(claims.createdAt, startDate));
  if (endDate) flagWhere.push(lte(claims.createdAt, endDate));

  const [flagRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(claims)
    .where(and(...flagWhere));

  const denialsFlaggedCount = Number(flagRow?.count) || 0;

  // Headline: hard dollars only.
  const valueDelivered = totalRecovered + underpaymentAmount;

  return {
    appealsRecovered: {
      count: wonCount,
      totalAppealed,
      totalRecovered,
      successRate: resolved > 0 ? (wonCount / resolved) * 100 : 0,
    },
    underpaymentsCaught: { count: underpaymentCount, amount: underpaymentAmount },
    denialsFlagged: {
      count: denialsFlaggedCount,
      note: "At-risk claims caught before submission. Not monetized — a flagged claim is not proof a denial was prevented.",
    },
    valueDelivered,
    windowStart: startDate ? startDate.toISOString() : null,
    windowEnd: endDate ? endDate.toISOString() : null,
  };
}
