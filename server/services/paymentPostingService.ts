/**
 * Payment Posting Service
 *
 * Handles recording insurance payments (ERA/Electronic Remittance Advice)
 * against claims, including payment posting, reversal, and summary reporting.
 */

import { eq, and, sql, lte, gte } from 'drizzle-orm';
import {
  paymentPostings,
  claims,
  type PaymentPosting,
  type InsertPaymentPosting,
} from '@shared/schema';
import { db } from '../db';
import logger from './logger';

export interface PaymentSummary {
  totalPayments: number;
  totalAdjustments: number;
  totalPatientResponsibility: number;
  paymentCount: number;
}

export interface DailyPostingSummary {
  date: string;
  totalPayments: number;
  totalAdjustments: number;
  totalPatientResponsibility: number;
  postingCount: number;
  claimsAffected: number;
}

// Money must be compared in integer cents. parseFloat on a numeric string
// reintroduces binary-float error, so a claim paid to the exact penny could be
// misclassified 'partial' (or vice-versa) right at the boundary.
function toCents(amount: string | null | undefined): number {
  return Math.round(parseFloat(amount ?? '0') * 100);
}

/**
 * Thrown inside postPayment when the remittance line named by
 * data.remittanceLineItemId already has an active posting — either seen by
 * the pre-check or caught as the partial unique index refusing the insert
 * (the two-simultaneous-requests case). The transaction rolls back; nothing
 * is posted twice.
 */
export class DuplicateLinePostingError extends Error {
  constructor(public readonly remittanceLineItemId: number, public readonly existingPostingId: number | null) {
    super(`Remittance line ${remittanceLineItemId} already has an active payment posting${existingPostingId ? ` (#${existingPostingId})` : ''}`);
    this.name = 'DuplicateLinePostingError';
  }
}

const LINE_UNIQUE_INDEX = 'uq_payment_postings_line_active';

function isLineUniqueViolation(error: any): boolean {
  // drizzle wraps the driver error (DrizzleQueryError { cause: pg error }),
  // so walk the cause chain for the Postgres unique_violation.
  for (let e = error, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === '23505' && String(e.constraint ?? e.message ?? '').includes(LINE_UNIQUE_INDEX)) return true;
  }
  return false;
}

/** The active (non-reversed) posting recorded for a remittance line, if any. */
export async function findLinePosting(remittanceLineItemId: number): Promise<PaymentPosting | null> {
  const rows = await db
    .select()
    .from(paymentPostings)
    .where(and(eq(paymentPostings.remittanceLineItemId, remittanceLineItemId), eq(paymentPostings.reversed, false)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Post a payment against a claim.
 * Updates the claim status to 'paid' if fully paid, or 'partial' if underpaid.
 */
export async function postPayment(
  practiceId: number,
  data: Omit<InsertPaymentPosting, 'practiceId'>,
): Promise<PaymentPosting> {
  // The posting insert and the claim status/paidAmount update must commit
  // together — otherwise a crash between them leaves the payment recorded but
  // the claim showing the wrong balance/status (and vice-versa).
  return await db.transaction(async (tx: any) => {
    // Verify the claim exists and belongs to this practice
    const claimResults = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.id, data.claimId), eq(claims.practiceId, practiceId)));

    if (claimResults.length === 0) {
      throw new Error(`Claim ${data.claimId} not found for practice ${practiceId}`);
    }

    const claim = claimResults[0];

    // An ERA is authoritative and supersedes anything the 276/277 status cron
    // inferred for this claim. Reverse those first, inside the same
    // transaction, so the SUM below sees only one record of the money.
    // Without this, a claim marked paid by the status cron and then confirmed
    // by the ERA would be counted twice — which is worse than the bug this
    // whole change fixes, because it over-reports collections and over-bills
    // the percentage platform fee rather than under-reporting it.
    if (data.source === 'era') {
      await tx
        .update(paymentPostings)
        .set({
          reversed: true,
          reversedAt: new Date(),
          reversalReason: 'Superseded by ERA remittance for the same claim',
        })
        .where(
          and(
            eq(paymentPostings.claimId, data.claimId),
            eq(paymentPostings.practiceId, practiceId),
            eq(paymentPostings.source, 'claim_status'),
            eq(paymentPostings.reversed, false),
          ),
        );
    }

    // One posting per remittance line. The pre-check gives a clean answer
    // for the common retry; the partial unique index on
    // (remittance_line_item_id) WHERE reversed = false is what makes it hold
    // under two simultaneous requests — the second insert fails and this
    // transaction rolls back.
    const lineId = (data as any).remittanceLineItemId as number | null | undefined;
    if (lineId != null) {
      const existing = await tx
        .select({ id: paymentPostings.id })
        .from(paymentPostings)
        .where(and(eq(paymentPostings.remittanceLineItemId, lineId), eq(paymentPostings.reversed, false)))
        .limit(1);
      if (existing.length > 0) {
        throw new DuplicateLinePostingError(lineId, existing[0].id);
      }
    }

    // Insert the payment posting
    const insertData: InsertPaymentPosting = {
      ...data,
      practiceId,
    };

    let result: PaymentPosting[];
    try {
      result = await tx
        .insert(paymentPostings)
        .values(insertData)
        .returning();
    } catch (insertError) {
      if (lineId != null && isLineUniqueViolation(insertError)) {
        throw new DuplicateLinePostingError(lineId, null);
      }
      throw insertError;
    }

    if (result.length === 0) {
      throw new Error('Failed to insert payment posting');
    }

    const posting = result[0];

    // Calculate total payments for this claim (excluding reversed)
    const paymentTotals = await tx
      .select({
        totalPaid: sql<string>`COALESCE(SUM(CASE WHEN ${paymentPostings.reversed} = false THEN ${paymentPostings.paymentAmount}::numeric ELSE 0 END), 0)`,
      })
      .from(paymentPostings)
      .where(
        and(
          eq(paymentPostings.claimId, data.claimId),
          eq(paymentPostings.practiceId, practiceId),
        ),
      );

    const totalPaidCents = toCents(paymentTotals[0]?.totalPaid);
    const claimTotalCents = toCents(claim.totalAmount);

    // Update claim status and paidAmount
    let newStatus: string;
    if (totalPaidCents >= claimTotalCents) {
      newStatus = 'paid';
    } else if (totalPaidCents > 0) {
      newStatus = 'partial';
    } else {
      newStatus = claim.status ?? 'submitted';
    }

    await tx
      .update(claims)
      .set({
        paidAmount: (totalPaidCents / 100).toFixed(2),
        status: newStatus,
        paidAt: newStatus === 'paid' ? new Date() : claim.paidAt,
        updatedAt: new Date(),
      })
      .where(eq(claims.id, data.claimId));

    logger.info('Payment posted', {
      paymentId: posting.id,
      claimId: data.claimId,
      practiceId,
      amount: data.paymentAmount,
      newClaimStatus: newStatus,
    });

    return posting;
  }).then(async (posting: PaymentPosting) => {
    // Recovery Ledger v2 hooks — OUTSIDE the money transaction on purpose:
    // ledger bookkeeping must never roll back a posted payment, and the
    // writers are idempotent + non-fatal by contract.
    try {
      const { recordUnderpaymentRecovery, recordDenialRiskRemediated } = await import('./recoveryEventsService');
      const paymentCents = Math.round(Number(data.paymentAmount) * 100);
      if (!posting.reversed && paymentCents > 0) {
        // Cash landing on a claim with a detected underpayment gap counts as
        // recovered — capped at the remaining gap inside the writer.
        await recordUnderpaymentRecovery({
          practiceId,
          claimId: data.claimId,
          paymentCents,
          sourceType: 'payment_posting',
          sourceId: posting.id,
        });
        // A previously flagged high-denial-risk claim receiving payment closes
        // the flagged→fixed→paid evidence trail (count-only, never monetized).
        await recordDenialRiskRemediated({ practiceId, claimId: data.claimId });
      }
    } catch (err: any) {
      logger.error('recovery ledger hooks failed after payment post', { error: err?.message, claimId: data.claimId });
    }
    return posting;
  });
}

/**
 * Get all payments for a specific claim.
 */
export async function getPaymentsForClaim(
  claimId: number,
  practiceId: number,
): Promise<PaymentPosting[]> {
  return db
    .select()
    .from(paymentPostings)
    .where(
      and(
        eq(paymentPostings.claimId, claimId),
        eq(paymentPostings.practiceId, practiceId),
      ),
    );
}

/**
 * Get payment summary for a practice within a date range.
 */
export async function getPaymentSummary(
  practiceId: number,
  startDate: Date,
  endDate: Date,
): Promise<PaymentSummary> {
  const results = await db
    .select({
      totalPayments: sql<string>`COALESCE(SUM(CASE WHEN ${paymentPostings.reversed} = false THEN ${paymentPostings.paymentAmount}::numeric ELSE 0 END), 0)`,
      totalAdjustments: sql<string>`COALESCE(SUM(CASE WHEN ${paymentPostings.reversed} = false THEN ${paymentPostings.adjustmentAmount}::numeric ELSE 0 END), 0)`,
      totalPatientResponsibility: sql<string>`COALESCE(SUM(CASE WHEN ${paymentPostings.reversed} = false THEN ${paymentPostings.patientResponsibility}::numeric ELSE 0 END), 0)`,
      paymentCount: sql<string>`COUNT(CASE WHEN ${paymentPostings.reversed} = false THEN 1 END)`,
    })
    .from(paymentPostings)
    .where(
      and(
        eq(paymentPostings.practiceId, practiceId),
        gte(paymentPostings.paymentDate, startDate.toISOString().split('T')[0]),
        lte(paymentPostings.paymentDate, endDate.toISOString().split('T')[0]),
      ),
    );

  const row = results[0];
  return {
    totalPayments: parseFloat(row?.totalPayments ?? '0'),
    totalAdjustments: parseFloat(row?.totalAdjustments ?? '0'),
    totalPatientResponsibility: parseFloat(row?.totalPatientResponsibility ?? '0'),
    paymentCount: parseInt(row?.paymentCount ?? '0', 10),
  };
}

/**
 * Get claims in 'submitted' status that are older than 14 days (unposted).
 */
export async function getUnpostedClaims(practiceId: number) {
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  return db
    .select()
    .from(claims)
    .where(
      and(
        eq(claims.practiceId, practiceId),
        eq(claims.status, 'submitted'),
        lte(claims.submittedAt, fourteenDaysAgo),
      ),
    );
}

/**
 * Reverse a posted payment. Marks the payment as reversed and recalculates the claim totals.
 */
export async function reversePayment(
  paymentId: number,
  practiceId: number,
  reason: string,
): Promise<PaymentPosting> {
  // The reversal flag and the claim recalculation must commit atomically —
  // otherwise a crash between them leaves a reversed payment against a claim
  // that still reads as fully paid.
  return await db.transaction(async (tx: any) => {
    // Find the payment
    const paymentResults = await tx
      .select()
      .from(paymentPostings)
      .where(
        and(
          eq(paymentPostings.id, paymentId),
          eq(paymentPostings.practiceId, practiceId),
        ),
      );

    if (paymentResults.length === 0) {
      throw new Error(`Payment ${paymentId} not found for practice ${practiceId}`);
    }

    const payment = paymentResults[0];

    if (payment.reversed) {
      throw new Error(`Payment ${paymentId} has already been reversed`);
    }

    // Mark the payment as reversed
    const updatedResults = await tx
      .update(paymentPostings)
      .set({
        reversed: true,
        reversedAt: new Date(),
        reversalReason: reason,
      })
      .where(eq(paymentPostings.id, paymentId))
      .returning();

    if (updatedResults.length === 0) {
      throw new Error('Failed to reverse payment');
    }

    // Recalculate total payments for this claim
    const paymentTotals = await tx
      .select({
        totalPaid: sql<string>`COALESCE(SUM(CASE WHEN ${paymentPostings.reversed} = false THEN ${paymentPostings.paymentAmount}::numeric ELSE 0 END), 0)`,
      })
      .from(paymentPostings)
      .where(
        and(
          eq(paymentPostings.claimId, payment.claimId),
          eq(paymentPostings.practiceId, practiceId),
        ),
      );

    const totalPaidCents = toCents(paymentTotals[0]?.totalPaid);

    // Fetch the claim to get its total
    const claimResults = await tx
      .select()
      .from(claims)
      .where(eq(claims.id, payment.claimId));

    const claim = claimResults[0];
    const claimTotalCents = toCents(claim.totalAmount);

    let newStatus: string;
    if (totalPaidCents >= claimTotalCents) {
      newStatus = 'paid';
    } else if (totalPaidCents > 0) {
      newStatus = 'partial';
    } else {
      newStatus = 'submitted';
    }

    await tx
      .update(claims)
      .set({
        paidAmount: (totalPaidCents / 100).toFixed(2),
        status: newStatus,
        // A claim that is no longer fully paid must not keep a paidAt stamp.
        paidAt: newStatus === 'paid' ? claim.paidAt : null,
        updatedAt: new Date(),
      })
      .where(eq(claims.id, payment.claimId));

    logger.info('Payment reversed', {
      paymentId,
      claimId: payment.claimId,
      practiceId,
      reason,
      newClaimStatus: newStatus,
    });

    return updatedResults[0];
  });
}

/**
 * Get a posting summary for a specific day.
 */
export async function getDailyPostingSummary(
  practiceId: number,
  date: Date,
): Promise<DailyPostingSummary> {
  const dateStr = date.toISOString().split('T')[0];

  const results = await db
    .select({
      totalPayments: sql<string>`COALESCE(SUM(CASE WHEN ${paymentPostings.reversed} = false THEN ${paymentPostings.paymentAmount}::numeric ELSE 0 END), 0)`,
      totalAdjustments: sql<string>`COALESCE(SUM(CASE WHEN ${paymentPostings.reversed} = false THEN ${paymentPostings.adjustmentAmount}::numeric ELSE 0 END), 0)`,
      totalPatientResponsibility: sql<string>`COALESCE(SUM(CASE WHEN ${paymentPostings.reversed} = false THEN ${paymentPostings.patientResponsibility}::numeric ELSE 0 END), 0)`,
      postingCount: sql<string>`COUNT(CASE WHEN ${paymentPostings.reversed} = false THEN 1 END)`,
      claimsAffected: sql<string>`COUNT(DISTINCT CASE WHEN ${paymentPostings.reversed} = false THEN ${paymentPostings.claimId} END)`,
    })
    .from(paymentPostings)
    .where(
      and(
        eq(paymentPostings.practiceId, practiceId),
        eq(paymentPostings.paymentDate, dateStr),
      ),
    );

  const row = results[0];
  return {
    date: dateStr,
    totalPayments: parseFloat(row?.totalPayments ?? '0'),
    totalAdjustments: parseFloat(row?.totalAdjustments ?? '0'),
    totalPatientResponsibility: parseFloat(row?.totalPatientResponsibility ?? '0'),
    postingCount: parseInt(row?.postingCount ?? '0', 10),
    claimsAffected: parseInt(row?.claimsAffected ?? '0', 10),
  };
}

/**
 * Post a remittance line's payment with the line as the posting identity.
 * Idempotent across the auto and manual paths and across retries: if the
 * line already has an active posting (pre-check or unique index), nothing
 * is inserted and the committed posting is returned with alreadyPosted.
 * Any other failure propagates — and then nothing was posted.
 */
export async function postRemittanceLinePayment(
  practiceId: number,
  data: Omit<InsertPaymentPosting, 'practiceId'> & { remittanceLineItemId: number },
): Promise<{ posting: PaymentPosting | null; alreadyPosted: boolean }> {
  try {
    const posting = await postPayment(practiceId, data);
    return { posting, alreadyPosted: false };
  } catch (error) {
    if (error instanceof DuplicateLinePostingError) {
      const posting = await findLinePosting(data.remittanceLineItemId);
      logger.info('Remittance line already posted; not posting again', {
        practiceId,
        remittanceLineItemId: data.remittanceLineItemId,
        existingPostingId: posting?.id ?? error.existingPostingId,
      });
      return { posting, alreadyPosted: true };
    }
    throw error;
  }
}
