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

/**
 * Resolve a payer id against Stedi's live directory before enrolling.
 *
 * The enrollment grid is seeded from a hardcoded list that carries INVENTED
 * identifiers for several payers — 'HORIZON_NJ', 'BCBS_FED', 'MEDICAID',
 * 'ANTHEM', 'TRICARE'. Stedi has never heard of any of them; Horizon BCBS NJ
 * is 22099. Submitting one files an enrollment against a payer that does not
 * exist, and the practice then waits weeks for an approval that cannot arrive.
 *
 * So the id the caller supplies is treated as a HINT, never as truth. If it
 * matches a real payer (directly or as an alias) it is used; otherwise we look
 * the payer up by name. If neither resolves, refuse — an enrollment aimed at
 * nothing is worse than no enrollment, because it looks like progress.
 */
async function resolveRealPayerId(
  practiceId: number,
  payerName: string,
  suppliedId: string,
): Promise<string> {
  const { searchPayers } = await import('./stediService');

  const looksResolved = async (query: string) => {
    const results = await searchPayers(query, { practiceId });
    return (
      results.find(
        (r: any) => r.payerId === suppliedId || (r.aliases ?? []).includes(suppliedId),
      ) ?? null
    );
  };

  try {
    const byId = await looksResolved(suppliedId);
    if (byId) return byId.payerId;

    const byName = await searchPayers(payerName, { practiceId });
    if (byName.length > 0) return byName[0].payerId;
  } catch (err: any) {
    logger.warn('Payer lookup failed while resolving an enrollment', {
      practiceId,
      payerName,
      error: err?.message,
    });
    throw precondition(
      `Could not reach the clearinghouse to confirm the payer id for ${payerName}. Try again shortly.`,
    );
  }

  throw precondition(
    `"${payerName}" could not be matched to a payer in the clearinghouse directory (the id on file, "${suppliedId}", is not one it recognises). Search for the payer to get its real id before enrolling.`,
  );
}

export async function submitEnrollmentForPractice(
  practiceId: number,
  input: {
    payerName: string;
    payerId: string;
    transactionType: LocalTransactionType;
  },
): Promise<{ row: any; stediStatus: unknown }> {
  const { payerName, transactionType } = input;
  // Never enroll against a caller-supplied id — see resolveRealPayerId.
  const payerId = await resolveRealPayerId(practiceId, payerName, input.payerId);

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
    // Stedi refusing a DUPLICATE is not a failure — it means the enrollment
    // already exists on their side and this table simply never recorded it
    // (created during setup, from Stedi's console, or by an earlier submission
    // whose result never landed). Surfaced as a raw 502 it reads as "broken",
    // and the natural response is to try again, which cannot ever work.
    const rawError = typeof result.error === 'string' ? result.error : JSON.stringify(result.error ?? '');
    if (/already exists/i.test(rawError)) {
      const existingId = rawError.match(/enrollment ID is ([0-9a-f-]{8,})/i)?.[1];
      throw precondition(
        `${payerName} is already enrolled for this transaction with the clearinghouse` +
          (existingId ? ` (enrollment ${existingId})` : '') +
          '. Nothing further to submit — press "Sync from clearinghouse" to pull the real status into this page.',
      );
    }

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
