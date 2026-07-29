/**
 * Recovery Events — writers for the Recovery Ledger v2 append-only ledger.
 *
 * Called from the money paths (underpayment pipeline, payment posting, appeal
 * outcomes, denial prediction). Every writer is:
 *   - IDEMPOTENT: re-running a sweep or re-posting doesn't duplicate events.
 *   - NON-FATAL: ledger bookkeeping must never break a payment/appeal path,
 *     so all writers swallow + log their own errors.
 *
 * HONESTY CONTRACT (mirrors shared/schema.ts recoveryEvents):
 *   - underpayment_detected   → measured gap snapshot (evidence dollars).
 *   - underpayment_recovered  → actual cash received against a detected gap.
 *   - appeal_recovered        → actual cash from a won/partial appeal.
 *   - denial_risk_flagged     → count-only. amountCents always null.
 *   - denial_risk_remediated  → count-only. Flagged claim later paid.
 */

import { db } from '../db';
import { recoveryEvents } from '@shared/schema';
import { and, eq, sql } from 'drizzle-orm';
import logger from './logger';

export type RecoveryEventType =
  | 'underpayment_detected'
  | 'underpayment_recovered'
  | 'appeal_recovered'
  | 'denial_risk_flagged'
  | 'denial_risk_remediated';

async function hasEvent(claimId: number, eventType: RecoveryEventType): Promise<boolean> {
  const [row] = await db
    .select({ id: recoveryEvents.id })
    .from(recoveryEvents)
    .where(and(eq(recoveryEvents.claimId, claimId), eq(recoveryEvents.eventType, eventType)))
    .limit(1);
  return !!row;
}

/** Sum of cash already recorded as recovered against a claim's detected gap. */
async function recoveredSoFarCents(claimId: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${recoveryEvents.amountCents}), 0)` })
    .from(recoveryEvents)
    .where(and(
      eq(recoveryEvents.claimId, claimId),
      eq(recoveryEvents.eventType, 'underpayment_recovered'),
    ));
  return Number(row?.total) || 0;
}

/** Latest detected-gap snapshot for a claim (cents), or null if none. */
async function detectedGapCents(claimId: number): Promise<number | null> {
  const [row] = await db
    .select({ amountCents: recoveryEvents.amountCents })
    .from(recoveryEvents)
    .where(and(
      eq(recoveryEvents.claimId, claimId),
      eq(recoveryEvents.eventType, 'underpayment_detected'),
    ))
    .orderBy(sql`${recoveryEvents.occurredAt} DESC`)
    .limit(1);
  return row?.amountCents ?? null;
}

/**
 * Snapshot a newly detected underpayment gap. One detected event per claim —
 * re-detection (daily sweep) is a no-op.
 */
export async function recordUnderpaymentDetected(params: {
  practiceId: number;
  claimId: number;
  expectedCents: number;
  paidCents: number;
  sourceType: string; // 'era_pipeline' | 'daily_sweep'
  sourceId?: number | null;
}): Promise<void> {
  try {
    if (await hasEvent(params.claimId, 'underpayment_detected')) return;
    const gapCents = Math.max(params.expectedCents - params.paidCents, 0);
    if (gapCents <= 0) return;
    await db.insert(recoveryEvents).values({
      practiceId: params.practiceId,
      claimId: params.claimId,
      eventType: 'underpayment_detected',
      amountCents: gapCents,
      evidence: {
        expectedCents: params.expectedCents,
        paidCents: params.paidCents,
        sourceType: params.sourceType,
        sourceId: params.sourceId ?? null,
      },
    });
    logger.info('Recovery event: underpayment_detected', { claimId: params.claimId, gapCents });
  } catch (err: any) {
    logger.error('recovery event write failed (underpayment_detected)', { error: err?.message, claimId: params.claimId });
  }
}

/**
 * Record cash arriving on a claim with a detected underpayment gap. Credits
 * up to the remaining gap (never more), so recovered ≤ detected always holds.
 */
export async function recordUnderpaymentRecovery(params: {
  practiceId: number;
  claimId: number;
  paymentCents: number;
  sourceType: string; // 'payment_posting'
  sourceId?: number | null;
}): Promise<void> {
  try {
    if (params.paymentCents <= 0) return;
    const gap = await detectedGapCents(params.claimId);
    if (gap == null) return; // no detected underpayment episode on this claim
    const already = await recoveredSoFarCents(params.claimId);
    const remaining = gap - already;
    if (remaining <= 0) return;
    const credited = Math.min(params.paymentCents, remaining);
    await db.insert(recoveryEvents).values({
      practiceId: params.practiceId,
      claimId: params.claimId,
      eventType: 'underpayment_recovered',
      amountCents: credited,
      evidence: {
        paymentCents: params.paymentCents,
        detectedGapCents: gap,
        previouslyRecoveredCents: already,
        sourceType: params.sourceType,
        sourceId: params.sourceId ?? null,
      },
    });
    logger.info('Recovery event: underpayment_recovered', { claimId: params.claimId, credited });
  } catch (err: any) {
    logger.error('recovery event write failed (underpayment_recovered)', { error: err?.message, claimId: params.claimId });
  }
}

/** Mirror a won/partial appeal outcome's recovered cash into the ledger. */
export async function recordAppealRecovery(params: {
  practiceId: number;
  claimId: number;
  recoveredCents: number;
  appealOutcomeId?: number | null;
  appealId?: number | null;
}): Promise<void> {
  try {
    if (params.recoveredCents <= 0) return;
    if (await hasEvent(params.claimId, 'appeal_recovered')) return;
    await db.insert(recoveryEvents).values({
      practiceId: params.practiceId,
      claimId: params.claimId,
      eventType: 'appeal_recovered',
      amountCents: params.recoveredCents,
      evidence: {
        sourceType: 'appeal_outcome',
        sourceId: params.appealOutcomeId ?? null,
        appealId: params.appealId ?? null,
      },
    });
    logger.info('Recovery event: appeal_recovered', { claimId: params.claimId, recoveredCents: params.recoveredCents });
  } catch (err: any) {
    logger.error('recovery event write failed (appeal_recovered)', { error: err?.message, claimId: params.claimId });
  }
}

/** Count-only: a high-risk denial prediction was surfaced pre-submission. */
export async function recordDenialRiskFlagged(params: {
  practiceId: number;
  claimId: number;
  riskLevel: string;
  riskScore?: number | null;
}): Promise<void> {
  try {
    if (params.riskLevel !== 'high') return;
    if (await hasEvent(params.claimId, 'denial_risk_flagged')) return;
    await db.insert(recoveryEvents).values({
      practiceId: params.practiceId,
      claimId: params.claimId,
      eventType: 'denial_risk_flagged',
      amountCents: null, // count-only, never monetized
      evidence: { riskLevel: params.riskLevel, riskScore: params.riskScore ?? null },
    });
  } catch (err: any) {
    logger.error('recovery event write failed (denial_risk_flagged)', { error: err?.message, claimId: params.claimId });
  }
}

/**
 * Count-only: a claim that had been flagged high-risk ended up PAID — the
 * evidence trail for "flagged, fixed, paid". Never monetized.
 */
export async function recordDenialRiskRemediated(params: {
  practiceId: number;
  claimId: number;
}): Promise<void> {
  try {
    if (!(await hasEvent(params.claimId, 'denial_risk_flagged'))) return;
    if (await hasEvent(params.claimId, 'denial_risk_remediated')) return;
    await db.insert(recoveryEvents).values({
      practiceId: params.practiceId,
      claimId: params.claimId,
      eventType: 'denial_risk_remediated',
      amountCents: null, // count-only, never monetized
      evidence: { sourceType: 'claim_paid' },
    });
  } catch (err: any) {
    logger.error('recovery event write failed (denial_risk_remediated)', { error: err?.message, claimId: params.claimId });
  }
}
