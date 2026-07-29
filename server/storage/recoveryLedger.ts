/**
 * Recovery Ledger — storage aggregation (v2, event-sourced).
 *
 * "Sheer for practices," the payer-advocate wedge, quantified. One surface
 * that answers "how much money did the system save / recover for me?"
 *
 * HONESTY CONTRACT (this is a money-claims surface — numbers must be defensible):
 *   - appealsRecovered      → HARD DOLLARS. Persisted in appeal_outcomes.
 *   - underpaymentsRecovered→ HARD DOLLARS. Cash actually received against a
 *     detected gap (recovery_events, capped at the detected gap).
 *   - underpaymentsCaught   → MEASURED DOLLARS (identified, not yet cash).
 *     v2 reads immutable detection-time snapshots from recovery_events;
 *     falls back to the v1 live computation only when no events exist yet
 *     (pre-v2 history, demo practice).
 *   - denialsFlagged / denialsRemediated → COUNT ONLY, never monetized.
 *
 * Headline `valueDelivered` (v2, TIGHTENED) = appeals recovered +
 * underpayments RECOVERED — realized cash only. The measured-but-uncollected
 * gap is reported separately as `valueIdentified`, never blended in.
 */

import { claims, appealOutcomes, claimFollowUps, recoveryEvents } from "@shared/schema";
import { db } from "../db";
import { and, eq, gte, lte, sql } from "drizzle-orm";

export interface RecoveryLedgerStats {
  appealsRecovered: {
    count: number;
    totalAppealed: number;
    totalRecovered: number;
    successRate: number;
  };
  underpaymentsCaught: { count: number; amount: number; source: "ledger" | "legacy" };
  underpaymentsRecovered: { count: number; amount: number };
  denialsFlagged: { count: number; note: string };
  denialsRemediated: { count: number; note: string };
  /** Realized cash only: appeals recovered + underpayments recovered. */
  valueDelivered: number;
  /** Measured-but-not-yet-collected underpayment gap. Reported separately. */
  valueIdentified: number;
  windowStart: string | null;
  windowEnd: string | null;
}

/**
 * Pure composition of the ledger stats from pre-aggregated pillar rows.
 * Exported for unit tests — all money semantics live here.
 */
export function composeRecoveryLedgerStats(input: {
  appeals: { resolved: number; won: number; totalAppealed: number; totalRecovered: number };
  caughtLedger: { count: number; amountCents: number };
  caughtLegacy: { count: number; amount: number };
  recovered: { count: number; amountCents: number };
  denialsFlaggedLedger: number;
  denialsFlaggedLegacy: number;
  denialsRemediated: number;
  windowStart?: Date;
  windowEnd?: Date;
}): RecoveryLedgerStats {
  const { appeals } = input;

  // Event snapshots are authoritative once any exist; legacy live computation
  // covers pre-v2 history (and the seeded demo practice).
  const useLedgerCaught = input.caughtLedger.count > 0;
  const caught = useLedgerCaught
    ? { count: input.caughtLedger.count, amount: input.caughtLedger.amountCents / 100, source: "ledger" as const }
    : { count: input.caughtLegacy.count, amount: input.caughtLegacy.amount, source: "legacy" as const };

  const recoveredAmount = input.recovered.amountCents / 100;
  const denialsFlaggedCount = Math.max(input.denialsFlaggedLedger, input.denialsFlaggedLegacy);

  return {
    appealsRecovered: {
      count: appeals.won,
      totalAppealed: appeals.totalAppealed,
      totalRecovered: appeals.totalRecovered,
      successRate: appeals.resolved > 0 ? (appeals.won / appeals.resolved) * 100 : 0,
    },
    underpaymentsCaught: caught,
    underpaymentsRecovered: { count: input.recovered.count, amount: recoveredAmount },
    denialsFlagged: {
      count: denialsFlaggedCount,
      note: "At-risk claims caught before submission. Not monetized — a flagged claim is not proof a denial was prevented.",
    },
    denialsRemediated: {
      count: input.denialsRemediated,
      note: "Flagged claims that were subsequently paid. Evidence trail only — never monetized.",
    },
    valueDelivered: appeals.totalRecovered + recoveredAmount,
    valueIdentified: caught.amount,
    windowStart: input.windowStart ? input.windowStart.toISOString() : null,
    windowEnd: input.windowEnd ? input.windowEnd.toISOString() : null,
  };
}

async function eventPillar(
  practiceId: number,
  eventType: string,
  startDate?: Date,
  endDate?: Date,
): Promise<{ count: number; amountCents: number }> {
  const where = [
    eq(recoveryEvents.practiceId, practiceId),
    eq(recoveryEvents.eventType, eventType),
  ];
  if (startDate) where.push(gte(recoveryEvents.occurredAt, startDate));
  if (endDate) where.push(lte(recoveryEvents.occurredAt, endDate));
  const [row] = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
      amountCents: sql<string>`COALESCE(SUM(${recoveryEvents.amountCents}), 0)`,
    })
    .from(recoveryEvents)
    .where(and(...where));
  return { count: Number(row?.count) || 0, amountCents: Number(row?.amountCents) || 0 };
}

export async function getRecoveryLedgerStats(
  practiceId: number,
  startDate?: Date,
  endDate?: Date,
): Promise<RecoveryLedgerStats> {
  // ── Pillar 1: Appeals recovered (HARD DOLLARS, appeal_outcomes) ──────
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

  // ── Pillars 2–5: event-sourced (recovery_events) ─────────────────────
  const [caughtLedger, recovered, flaggedLedger, remediated] = await Promise.all([
    eventPillar(practiceId, "underpayment_detected", startDate, endDate),
    eventPillar(practiceId, "underpayment_recovered", startDate, endDate),
    eventPillar(practiceId, "denial_risk_flagged", startDate, endDate),
    eventPillar(practiceId, "denial_risk_remediated", startDate, endDate),
  ]);

  // ── Legacy fallbacks (pre-v2 history / demo practice) ────────────────
  const underWhere = [
    eq(claimFollowUps.practiceId, practiceId),
    eq(claimFollowUps.followUpType, "underpayment"),
    eq(claims.isDemo, false),
  ];
  if (startDate) underWhere.push(gte(claimFollowUps.createdAt, startDate));
  if (endDate) underWhere.push(lte(claimFollowUps.createdAt, endDate));

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

  return composeRecoveryLedgerStats({
    appeals: {
      resolved: Number(appealRow?.resolved) || 0,
      won: Number(appealRow?.won) || 0,
      totalAppealed: Number(appealRow?.totalAppealed) || 0,
      totalRecovered: Number(appealRow?.totalRecovered) || 0,
    },
    caughtLedger,
    caughtLegacy: {
      count: Number(underRow?.count) || 0,
      amount: Number(underRow?.amount) || 0,
    },
    recovered,
    denialsFlaggedLedger: flaggedLedger.count,
    denialsFlaggedLegacy: Number(flagRow?.count) || 0,
    denialsRemediated: remediated.count,
    windowStart: startDate,
    windowEnd: endDate,
  });
}
