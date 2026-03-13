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

/**
 * Post a payment against a claim.
 * Updates the claim status to 'paid' if fully paid, or 'partial' if underpaid.
 */
export async function postPayment(
  practiceId: number,
  data: Omit<InsertPaymentPosting, 'practiceId'>,
): Promise<PaymentPosting> {
  // Verify the claim exists and belongs to this practice
  const claimResults = await db
    .select()
    .from(claims)
    .where(and(eq(claims.id, data.claimId), eq(claims.practiceId, practiceId)));

  if (claimResults.length === 0) {
    throw new Error(`Claim ${data.claimId} not found for practice ${practiceId}`);
  }

  const claim = claimResults[0];

  // Insert the payment posting
  const insertData: InsertPaymentPosting = {
    ...data,
    practiceId,
  };

  const result = await db
    .insert(paymentPostings)
    .values(insertData)
    .returning();

  if (result.length === 0) {
    throw new Error('Failed to insert payment posting');
  }

  const posting = result[0];

  // Calculate total payments for this claim (excluding reversed)
  const paymentTotals = await db
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

  const totalPaid = parseFloat(paymentTotals[0]?.totalPaid ?? '0');
  const claimTotal = parseFloat(claim.totalAmount);

  // Update claim status and paidAmount
  let newStatus: string;
  if (totalPaid >= claimTotal) {
    newStatus = 'paid';
  } else if (totalPaid > 0) {
    newStatus = 'partial';
  } else {
    newStatus = claim.status ?? 'submitted';
  }

  await db
    .update(claims)
    .set({
      paidAmount: totalPaid.toFixed(2),
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
  // Find the payment
  const paymentResults = await db
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
  const updatedResults = await db
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
  const paymentTotals = await db
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

  const totalPaid = parseFloat(paymentTotals[0]?.totalPaid ?? '0');

  // Fetch the claim to get its total
  const claimResults = await db
    .select()
    .from(claims)
    .where(eq(claims.id, payment.claimId));

  const claim = claimResults[0];
  const claimTotal = parseFloat(claim.totalAmount);

  let newStatus: string;
  if (totalPaid >= claimTotal) {
    newStatus = 'paid';
  } else if (totalPaid > 0) {
    newStatus = 'partial';
  } else {
    newStatus = 'submitted';
  }

  await db
    .update(claims)
    .set({
      paidAmount: totalPaid.toFixed(2),
      status: newStatus,
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
