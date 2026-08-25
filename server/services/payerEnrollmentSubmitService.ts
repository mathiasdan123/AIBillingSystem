/**
 * Submitting a payer enrollment to Stedi.
 *
 * Extracted from the POST /api/payer-enrollments/submit handler so that the
 * one-click approval of an autopilot plan and the single-payer button run the
 * SAME submission — preconditions, contact assembly, upsert and all. A second
 * implementation would drift, and enrollment is not a place to discover drift:
 * the failure shows up weeks later as a payer that never sends remittances.
 *
 * Preconditions throw with code 'precondition' (the practice's own profile is
 * incomplete) and clearinghouse refusals with code 'upstream'. The route maps
 * those to 412 and 502. Collapsing both into a 500 would tell a user with a
 * missing phone number that the system is broken.
 */
import { and, eq } from 'drizzle-orm';
import { payerEnrollments } from '@shared/schema';
import { db } from '../db';
import { storage } from '../storage';
import logger from './logger';
import { getStediApiKeyForPractice } from './stediService';
import {
  createStediEnrollment,
  mapTransactionTypeToStedi,
  type LocalTransactionType,
} from './stediEnrollmentService';
import { sanitizeExternalError } from './errorSanitizer';

interface CodedError extends Error {
  code: 'precondition' | 'upstream';
  detail?: unknown;
}

function precondition(message: string): CodedError {
  const err = new Error(message) as CodedError;
  err.code = 'precondition';
  return err;
}

function upstream(detail: unknown): CodedError {
  const err = new Error('Stedi enrollment submission failed') as CodedError;
  err.code = 'upstream';
  err.detail = detail;
  return err;
}

export async function submitEnrollmentForPractice(
  practiceId: number,
  input: {
    payerName: string;
    payerId: string;
    transactionType: LocalTransactionType;
  },
): Promise<{ row: any; stediStatus: unknown }> {
  const { payerName, payerId, transactionType } = input;

  const stediTransaction = mapTransactionTypeToStedi(transactionType);
  if (!stediTransaction) {
    throw precondition('Unsupported transaction type for enrollment');
  }

  const practice = await storage.getPractice(practiceId);
  if (!practice) throw precondition('Practice not found');
  if (!practice.stediProviderId) {
    throw precondition('No Stedi provider record yet — create the provider record first (provider profile).');
  }
  if (!practice.enrollmentAuthorizedAt) {
    throw precondition('Enrollment not authorized — record authorization before submitting.');
  }

  const userEmail =
    practice.enrollmentNotificationEmail ||
    practice.billingContactEmail ||
    practice.email ||
    undefined;
  if (!userEmail) {
    throw precondition('No notification email on file — set a billing/enrollment contact email first.');
  }

  // Stedi requires a primary contact with email, phone, and full address.
  if (
    !practice.billingContactEmail ||
    !practice.billingContactPhone ||
    !practice.addressStreet ||
    !practice.addressCity ||
    !practice.addressState ||
    !practice.addressZip
  ) {
    throw precondition('Enrollment needs a billing contact email + phone and a structured practice address — complete the provider profile first.');
  }
  const contactName = practice.billingContactName || practice.ownerName || '';
  const [contactFirst, ...contactRest] = contactName.trim().split(/\s+/);

  const { apiKey } = await getStediApiKeyForPractice(practiceId);
  const result = await createStediEnrollment(apiKey, {
    providerId: practice.stediProviderId,
    payerId,
    transaction: stediTransaction,
    userEmail,
    primaryContact: {
      firstName: contactFirst || undefined,
      lastName: contactRest.join(' ') || undefined,
      organizationName: practice.name || undefined,
      email: practice.billingContactEmail,
      phone: practice.billingContactPhone,
      streetAddress1: practice.addressStreet,
      city: practice.addressCity,
      state: practice.addressState,
      zipCode: practice.addressZip,
    },
    // Deliberately no aggregationPreference: it's ERA-only AND payer-gated —
    // Stedi 400s (empty body) when the payer doesn't accept a preference
    // (verified against Horizon BCBS NJ 2026-07-02, which auto-derives
    // TIN aggregation). Payers that support it apply their default.
    submit: true,
  });

  if (!result.ok) {
    logger.warn('Stedi enrollment submission failed', {
      practiceId,
      payerName,
      transactionType,
      error: result.error,
      raw: result.raw,
    });
    throw upstream(sanitizeExternalError(result.error));
  }

  const now = new Date();
  const localStatus = result.localStatus ?? 'pending';

  // Upsert the local row to reflect the submitted request.
  const [existing] = await db
    .select()
    .from(payerEnrollments)
    .where(
      and(
        eq(payerEnrollments.practiceId, practiceId),
        eq(payerEnrollments.payerName, payerName),
        eq(payerEnrollments.transactionType, transactionType),
      ),
    )
    .limit(1);

  let row;
  if (existing) {
    const [updated] = await db
      .update(payerEnrollments)
      .set({
        status: localStatus,
        payerId,
        stediEnrollmentId: result.enrollmentId ?? existing.stediEnrollmentId,
        requestedAt: now,
        updatedAt: now,
      })
      .where(eq(payerEnrollments.id, existing.id))
      .returning();
    row = updated;
  } else {
    const [inserted] = await db
      .insert(payerEnrollments)
      .values({
        practiceId,
        payerName,
        payerId,
        transactionType,
        status: localStatus,
        stediEnrollmentId: result.enrollmentId ?? null,
        requestedAt: now,
      })
      .returning();
    row = inserted;
  }

  logger.info('Stedi enrollment submitted', {
    practiceId,
    payerName,
    transactionType,
    enrollmentId: result.enrollmentId,
    stediStatus: result.status,
    localStatus,
  });


  return { row, stediStatus: result.status };
}
