/**
 * Recording a payment that was inferred from a 276/277 claim-status response.
 *
 * Lives in its own module rather than inside paymentPostingService so that the
 * dependency on postPayment is an explicit module boundary — both status jobs
 * import this, and it can be mocked without stubbing the posting engine.
 */
import { eq, and } from 'drizzle-orm';
import { paymentPostings } from '@shared/schema';
import { db } from '../db';
import logger from './logger';
import { postPayment } from './paymentPostingService';

// Money must be compared in integer cents; parseFloat on a numeric string
// reintroduces binary-float error at the penny boundary.
function toCents(amount: string | null | undefined): number {
  return Math.round(parseFloat(amount ?? '0') * 100);
}

/**
 * Record a payment inferred from a 276/277 claim-status response.
 *
 * Why this exists: writing `claims.paidAmount` is not the same as recording
 * the money. A/R, patient statements, the collections rate and the
 * 6%-of-collections basis all read `payment_postings`. Both status paths — the
 * 4-hourly poller and the daily reaper — set the claim column and nothing
 * else, so a claim confirmed paid contributed $0 to every one of those.
 *
 * Normally the ERA repairs it (postPayment recomputes paidAmount from the sum
 * of postings). But ERA delivery is enrollment-gated per payer, so a practice
 * that is not yet ERA-enrolled never receives one and the 277 is the only
 * signal that will ever exist. For them the gap is permanent, not transient.
 *
 * LIMITATION, deliberately not papered over: a 277 reports a paid amount and
 * nothing else. There is no CAS breakdown, so adjustment, deductible,
 * coinsurance and patient responsibility are unknown and are left at zero
 * rather than guessed. `patientResponsibility: '0'` here means "not yet
 * known", NOT "the patient owes nothing" — inferring a patient balance from a
 * 277 would repeat the balance-billing error of charging a percentage of the
 * billed charge. Only the 835 settles that, which is why an ERA posting
 * supersedes this row when it lands.
 */
export async function recordStatusDerivedPayment(params: {
  claimId: number;
  practiceId: number;
  payerName?: string | null;
  paidAmount: number | string | null | undefined;
  paidDate?: string | Date | null;
}): Promise<void> {
  const { claimId, practiceId, payerName, paidAmount, paidDate } = params;

  const amountCents = toCents(paidAmount == null ? null : String(paidAmount));
  if (amountCents <= 0) return;

  try {
    // Idempotency. A claim can legitimately move paid -> denied -> paid across
    // polls, and these jobs run every 4 hours / daily. Never stack a second
    // inferred posting on a claim that already has money recorded against it.
    const existing = await db
      .select({ id: paymentPostings.id })
      .from(paymentPostings)
      .where(
        and(
          eq(paymentPostings.claimId, claimId),
          eq(paymentPostings.practiceId, practiceId),
          eq(paymentPostings.reversed, false),
        ),
      );

    if (existing.length > 0) {
      logger.info('Claim already has a payment posting; skipping 277-derived posting', {
        claimId,
      });
      return;
    }

    const date = paidDate ? new Date(paidDate) : new Date();
    const paymentDate = (Number.isNaN(date.getTime()) ? new Date() : date)
      .toISOString()
      .split('T')[0];

    await postPayment(practiceId, {
      source: 'claim_status',
      claimId,
      payerName: payerName || 'Unknown payer',
      checkNumber: null,
      paymentDate,
      paymentAmount: (amountCents / 100).toFixed(2),
      adjustmentAmount: '0',
      patientResponsibility: '0',
    } as any);

    logger.info('Recorded 277-derived payment posting', { claimId, amountCents });
  } catch (err: any) {
    // Never abort the status sweep. The claim transition already committed and
    // is still correct; surface this loudly instead, because a silent miss
    // here is money missing from collections.
    logger.error('Failed to record 277-derived payment posting', {
      claimId,
      error: err?.message,
    });
  }
}
