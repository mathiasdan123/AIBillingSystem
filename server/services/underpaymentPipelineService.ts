/**
 * Underpayment Pipeline Service
 *
 * Closes the loop on underpaid claims. When an ERA posts a payment below the
 * contracted fee-schedule rate, this service creates an `underpayment`
 * follow-up task so the gap surfaces in the billing work queue instead of
 * being silently logged. A daily sweep is the safety net for underpayments
 * flagged before this pipeline existed (claims that already have
 * `expectedAmount` set but no follow-up).
 *
 * Idempotent: one active underpayment follow-up per claim.
 */

import { db } from '../db';
import { claims, claimFollowUps, practices } from '../../shared/schema';
import { eq, and, inArray, isNotNull, sql } from 'drizzle-orm';
import logger from './logger';

// Mirror of the ERA route's threshold — gaps at or below this are noise.
const UNDERPAYMENT_THRESHOLD = 5;
const FOLLOW_UP_WINDOW_DAYS = 21;

function priorityForGap(gap: number): 'low' | 'medium' | 'high' | 'urgent' {
  if (gap >= 100) return 'urgent';
  if (gap >= 50) return 'high';
  if (gap >= 20) return 'medium';
  return 'low';
}

export interface EnsureUnderpaymentFollowUpParams {
  claimId: number;
  practiceId: number;
  claimNumber?: string | null;
  expectedAmount: number;
  paidAmount: number;
  cptCode?: string | null;
  payerName?: string | null;
}

/**
 * Creates an `underpayment` follow-up for a claim unless an active one already
 * exists. Returns true if a new follow-up was inserted.
 */
export async function ensureUnderpaymentFollowUp(
  params: EnsureUnderpaymentFollowUpParams,
): Promise<boolean> {
  const { claimId, practiceId, claimNumber, expectedAmount, paidAmount, cptCode, payerName } =
    params;

  const gap = expectedAmount - paidAmount;
  if (gap <= UNDERPAYMENT_THRESHOLD) return false;

  const existing = await db
    .select({ id: claimFollowUps.id })
    .from(claimFollowUps)
    .where(
      and(
        eq(claimFollowUps.claimId, claimId),
        eq(claimFollowUps.followUpType, 'underpayment'),
        inArray(claimFollowUps.status, ['pending', 'in_progress']),
      ),
    );
  if (existing.length > 0) return false;

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + FOLLOW_UP_WINDOW_DAYS);

  const detail = [
    cptCode ? `CPT ${cptCode}` : null,
    payerName ? `payer ${payerName}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  await db.insert(claimFollowUps).values({
    claimId,
    practiceId,
    followUpType: 'underpayment',
    status: 'pending',
    priority: priorityForGap(gap),
    notes: `Claim ${claimNumber || claimId} underpaid by $${gap.toFixed(2)} (expected $${expectedAmount.toFixed(2)}, paid $${paidAmount.toFixed(2)})${detail ? ` — ${detail}` : ''}. Review for dispute.`,
    dueDate,
  });

  logger.info('Underpayment follow-up created', { claimId, practiceId, gap });
  return true;
}

/**
 * Daily sweep: finds paid claims underpaid relative to their benchmarked
 * `expectedAmount` that don't yet have an active underpayment follow-up, and
 * creates one for each.
 */
export async function generateUnderpaymentFollowUps(practiceId: number): Promise<number> {
  const underpaidClaims = await db
    .select({
      id: claims.id,
      claimNumber: claims.claimNumber,
      expectedAmount: claims.expectedAmount,
      paidAmount: claims.paidAmount,
    })
    .from(claims)
    .where(
      and(
        eq(claims.practiceId, practiceId),
        eq(claims.status, 'paid'),
        isNotNull(claims.expectedAmount),
        isNotNull(claims.paidAmount),
        sql`CAST(${claims.paidAmount} AS NUMERIC) < CAST(${claims.expectedAmount} AS NUMERIC) - ${UNDERPAYMENT_THRESHOLD}`,
      ),
    );

  let created = 0;
  for (const claim of underpaidClaims) {
    const inserted = await ensureUnderpaymentFollowUp({
      claimId: claim.id,
      practiceId,
      claimNumber: claim.claimNumber,
      expectedAmount: Number(claim.expectedAmount),
      paidAmount: Number(claim.paidAmount),
    });
    if (inserted) created++;
  }

  if (created > 0) {
    logger.info('Underpayment sweep created follow-ups', { practiceId, created });
  }
  return created;
}

/**
 * Runs the underpayment sweep across every practice — scheduler safety net.
 */
export async function generateUnderpaymentFollowUpsForAllPractices(): Promise<{
  practices: number;
  followUpsCreated: number;
}> {
  const allPractices = await db.select({ id: practices.id }).from(practices);
  let followUpsCreated = 0;

  for (const practice of allPractices) {
    try {
      followUpsCreated += await generateUnderpaymentFollowUps(practice.id);
    } catch (error: any) {
      logger.error('Underpayment sweep failed for practice', {
        practiceId: practice.id,
        error: error.message,
      });
    }
  }

  return { practices: allPractices.length, followUpsCreated };
}

export default {
  ensureUnderpaymentFollowUp,
  generateUnderpaymentFollowUps,
  generateUnderpaymentFollowUpsForAllPractices,
};
