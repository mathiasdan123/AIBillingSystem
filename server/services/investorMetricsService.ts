/**
 * Investor metrics — the numbers a diligence process asks for, persisted as a
 * daily time series so growth is provable rather than reconstructed.
 *
 * All metrics are computed over REAL practices only (practices.isDemo=false →
 * claims.isDemo=false rows). Global rollup rows use practiceId NULL.
 *
 * Metric definitions (documented here, referenced by the admin page):
 *  - claims_submitted_cum   COUNT of non-demo claims with submittedAt <= asOf
 *  - claims_paid_cum        COUNT of non-demo claims paid as of asOf
 *  - first_pass_acceptance  % of resolved claims (paid|denied) that were paid
 *                           WITHOUT ever having an appeal. Conservative.
 *  - denial_rate            denied / (paid + denied) * 100
 *  - avg_days_to_payment    AVG(paidAt - submittedAt) in days, paid claims
 *  - value_recovered_cum    realized recovery dollars: appeal_outcomes
 *                           (won/partial) + underpayment_recovered events
 *  - value_identified_cum   measured underpayment gap (detected events)
 *  - active_practices       non-demo practices with a claim or appointment
 *                           in the 30 days before asOf
 *  - blanche_conversations_cum  total Blanche conversations
 */

import { db } from '../db';
import {
  claims, appeals, appealOutcomes, recoveryEvents, practices,
  appointments, blancheConversations, metricSnapshots,
} from '@shared/schema';
import { and, eq, lte, sql } from 'drizzle-orm';
import logger from './logger';

export interface MetricValues {
  [metric: string]: number;
}

/** End-of-day boundary for an as-of date (UTC). */
function endOfDay(d: Date): Date {
  const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
  return e;
}

export async function computeGlobalMetrics(asOfInput: Date): Promise<MetricValues> {
  const asOf = endOfDay(asOfInput);
  const notDemo = eq(claims.isDemo, false);

  const [claimRow] = await db
    .select({
      submitted: sql<number>`COUNT(*) FILTER (WHERE ${claims.submittedAt} IS NOT NULL AND ${claims.submittedAt} <= ${asOf})::int`,
      paid: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'paid' AND ${claims.paidAt} IS NOT NULL AND ${claims.paidAt} <= ${asOf})::int`,
      denied: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'denied' AND ${claims.createdAt} <= ${asOf})::int`,
      avgDays: sql<string>`COALESCE(AVG(EXTRACT(EPOCH FROM (${claims.paidAt} - ${claims.submittedAt})) / 86400.0) FILTER (WHERE ${claims.status} = 'paid' AND ${claims.paidAt} IS NOT NULL AND ${claims.submittedAt} IS NOT NULL AND ${claims.paidAt} <= ${asOf}), 0)`,
    })
    .from(claims)
    .where(notDemo);

  // First-pass: paid claims that never had an appeal, over resolved claims.
  const [fpRow] = await db
    .select({
      paidNoAppeal: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'paid' AND ${claims.paidAt} <= ${asOf} AND NOT EXISTS (SELECT 1 FROM ${appeals} a WHERE a.claim_id = ${claims.id}))::int`,
    })
    .from(claims)
    .where(notDemo);

  const [recoveredRow] = await db
    .select({
      appealDollars: sql<string>`COALESCE(SUM(${appealOutcomes.recoveredAmount}) FILTER (WHERE ${appealOutcomes.outcome} IN ('won','partial') AND ${appealOutcomes.createdAt} <= ${asOf}), 0)`,
    })
    .from(appealOutcomes);

  const [eventsRow] = await db
    .select({
      recoveredCents: sql<string>`COALESCE(SUM(${recoveryEvents.amountCents}) FILTER (WHERE ${recoveryEvents.eventType} = 'underpayment_recovered' AND ${recoveryEvents.occurredAt} <= ${asOf}), 0)`,
      identifiedCents: sql<string>`COALESCE(SUM(${recoveryEvents.amountCents}) FILTER (WHERE ${recoveryEvents.eventType} = 'underpayment_detected' AND ${recoveryEvents.occurredAt} <= ${asOf}), 0)`,
    })
    .from(recoveryEvents);

  const windowStart = new Date(asOf.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [activeRow] = await db
    .select({
      count: sql<number>`COUNT(DISTINCT ${practices.id}) FILTER (WHERE ${practices.isDemo} = false)::int`,
    })
    .from(practices)
    .where(sql`EXISTS (
      SELECT 1 FROM ${claims} c WHERE c.practice_id = ${practices.id} AND c.created_at BETWEEN ${windowStart} AND ${asOf}
      UNION ALL
      SELECT 1 FROM ${appointments} ap WHERE ap.practice_id = ${practices.id} AND ap.created_at BETWEEN ${windowStart} AND ${asOf}
      LIMIT 1
    )`);

  const [blancheRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(blancheConversations)
    .where(lte(blancheConversations.createdAt, asOf));

  const submitted = Number(claimRow?.submitted) || 0;
  const paid = Number(claimRow?.paid) || 0;
  const denied = Number(claimRow?.denied) || 0;
  const resolved = paid + denied;
  const paidNoAppeal = Number(fpRow?.paidNoAppeal) || 0;
  const appealDollars = Number(recoveredRow?.appealDollars) || 0;
  const upRecovered = (Number(eventsRow?.recoveredCents) || 0) / 100;
  const upIdentified = (Number(eventsRow?.identifiedCents) || 0) / 100;

  return {
    claims_submitted_cum: submitted,
    claims_paid_cum: paid,
    first_pass_acceptance: resolved > 0 ? (paidNoAppeal / resolved) * 100 : 0,
    denial_rate: resolved > 0 ? (denied / resolved) * 100 : 0,
    avg_days_to_payment: Number(claimRow?.avgDays) || 0,
    value_recovered_cum: appealDollars + upRecovered,
    value_identified_cum: upIdentified,
    active_practices: Number(activeRow?.count) || 0,
    blanche_conversations_cum: Number(blancheRow?.count) || 0,
  };
}

/** Upsert one day's global snapshot rows. Idempotent per (date, metric). */
export async function storeDailySnapshot(asOf: Date): Promise<MetricValues> {
  const values = await computeGlobalMetrics(asOf);
  const metricDate = asOf.toISOString().slice(0, 10);
  for (const [metric, value] of Object.entries(values)) {
    await db
      .insert(metricSnapshots)
      .values({ practiceId: 0, metricDate, metric, value: value.toFixed(4) })
      .onConflictDoUpdate({
        target: [metricSnapshots.practiceId, metricSnapshots.metricDate, metricSnapshots.metric],
        set: { value: value.toFixed(4) },
      });
  }
  logger.info('Investor metrics snapshot stored', { metricDate, metrics: Object.keys(values).length });
  return values;
}

/** Backfill snapshots for the past N days (inclusive of today). */
export async function backfillSnapshots(days: number): Promise<number> {
  const capped = Math.min(Math.max(days, 1), 365);
  let stored = 0;
  for (let i = capped - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    await storeDailySnapshot(d);
    stored++;
  }
  return stored;
}
