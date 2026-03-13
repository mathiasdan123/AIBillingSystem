/**
 * Batch Eligibility Verification Service
 *
 * Manages queued eligibility checks with rate limiting to avoid
 * API throttling. Stores results in the eligibilityChecks table.
 */

import { db } from '../db';
import { eligibilityChecks, patients, insurances } from '../../shared/schema';
import { eq, and, lt, desc, isNotNull } from 'drizzle-orm';
import { checkEligibility, isStediConfigured } from './stediService';
import logger from './logger';

// In-memory queue per practice
interface QueuedCheck {
  patientId: number;
  practiceId: number;
  insuranceId: number;
  queuedAt: Date;
}

const practiceQueues: Map<number, QueuedCheck[]> = new Map();
const processingPractices: Set<number> = new Set();

/**
 * Add an eligibility check to the in-memory queue for a practice.
 */
export function queueEligibilityCheck(
  patientId: number,
  practiceId: number,
  insuranceId: number
): { queued: boolean; position: number } {
  if (!practiceQueues.has(practiceId)) {
    practiceQueues.set(practiceId, []);
  }

  const queue = practiceQueues.get(practiceId)!;

  // Avoid duplicate entries in queue
  const alreadyQueued = queue.some(
    (item) =>
      item.patientId === patientId &&
      item.insuranceId === insuranceId
  );

  if (alreadyQueued) {
    const position = queue.findIndex(
      (item) =>
        item.patientId === patientId &&
        item.insuranceId === insuranceId
    );
    return { queued: false, position: position + 1 };
  }

  const entry: QueuedCheck = {
    patientId,
    practiceId,
    insuranceId,
    queuedAt: new Date(),
  };

  queue.push(entry);

  logger.info('Eligibility check queued', {
    patientId,
    practiceId,
    insuranceId,
    position: queue.length,
  });

  return { queued: true, position: queue.length };
}

/**
 * Get the current queue for a practice.
 */
export function getQueueStatus(practiceId: number): {
  queueLength: number;
  isProcessing: boolean;
  items: QueuedCheck[];
} {
  const queue = practiceQueues.get(practiceId) || [];
  return {
    queueLength: queue.length,
    isProcessing: processingPractices.has(practiceId),
    items: Array.from(queue),
  };
}

/**
 * Process all queued eligibility checks for a practice, sequentially,
 * with 1-second delay between each to avoid API throttling.
 */
export async function processBatchEligibility(
  practiceId: number
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  results: Array<{ patientId: number; insuranceId: number; status: string; eligible?: boolean; error?: string }>;
}> {
  if (processingPractices.has(practiceId)) {
    throw new Error('Batch processing is already running for this practice');
  }

  const queue = practiceQueues.get(practiceId);
  if (!queue || queue.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, results: [] };
  }

  // Take a snapshot of items to process and clear the queue
  const itemsToProcess = Array.from(queue);
  practiceQueues.set(practiceId, []);
  processingPractices.add(practiceId);

  const results: Array<{
    patientId: number;
    insuranceId: number;
    status: string;
    eligible?: boolean;
    error?: string;
  }> = [];
  let succeeded = 0;
  let failed = 0;

  try {
    for (let i = 0; i < itemsToProcess.length; i++) {
      const item = itemsToProcess[i];

      // Rate limiting: wait 1 second between checks (skip for first)
      if (i > 0) {
        await delay(1000);
      }

      try {
        const result = await processSingleCheck(item);
        results.push(result);
        if (result.status === 'completed') {
          succeeded++;
        } else {
          failed++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Error processing eligibility check', {
          patientId: item.patientId,
          insuranceId: item.insuranceId,
          error: errorMessage,
        });
        results.push({
          patientId: item.patientId,
          insuranceId: item.insuranceId,
          status: 'error',
          error: errorMessage,
        });
        failed++;
      }
    }
  } finally {
    processingPractices.delete(practiceId);
  }

  logger.info('Batch eligibility processing completed', {
    practiceId,
    processed: itemsToProcess.length,
    succeeded,
    failed,
  });

  return {
    processed: itemsToProcess.length,
    succeeded,
    failed,
    results,
  };
}

/**
 * Process a single eligibility check: look up patient/insurance data,
 * call the Stedi API, and store the result.
 */
async function processSingleCheck(item: QueuedCheck): Promise<{
  patientId: number;
  insuranceId: number;
  status: string;
  eligible?: boolean;
  error?: string;
}> {
  // Create a pending record
  const [pendingRecord] = await db
    .insert(eligibilityChecks)
    .values({
      patientId: item.patientId,
      practiceId: item.practiceId,
      insuranceId: item.insuranceId,
      status: 'unknown',
      processingStatus: 'pending',
    })
    .returning();

  try {
    // Look up patient
    const [patient] = await db
      .select()
      .from(patients)
      .where(eq(patients.id, item.patientId));

    if (!patient) {
      throw new Error(`Patient ${item.patientId} not found`);
    }

    // Look up insurance
    const [insurance] = await db
      .select()
      .from(insurances)
      .where(eq(insurances.id, item.insuranceId));

    if (!insurance) {
      throw new Error(`Insurance ${item.insuranceId} not found`);
    }

    if (!isStediConfigured()) {
      throw new Error('Stedi API is not configured');
    }

    // Build eligibility request
    const eligibilityResponse = await checkEligibility({
      subscriber: {
        memberId: patient.insuranceId || patient.policyNumber || '',
        firstName: patient.firstName,
        lastName: patient.lastName,
        dateOfBirth: patient.dateOfBirth || '',
      },
      provider: {
        npi: '', // Would come from practice settings in production
      },
      payer: {
        id: insurance.payerCode || '',
        name: insurance.name,
      },
    });

    const isEligible = eligibilityResponse.status === 'active';
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

    // Update the record with results
    await db
      .update(eligibilityChecks)
      .set({
        eligible: isEligible,
        checkedAt: now,
        expiresAt,
        copay: eligibilityResponse.copay?.primary?.toString() || null,
        deductible: eligibilityResponse.deductible?.individual?.toString() || null,
        coinsurance: eligibilityResponse.coinsurance != null ? Math.round(eligibilityResponse.coinsurance) : null,
        rawResponse: eligibilityResponse.raw,
        status: eligibilityResponse.status,
        processingStatus: 'completed',
      })
      .where(eq(eligibilityChecks.id, pendingRecord.id));

    return {
      patientId: item.patientId,
      insuranceId: item.insuranceId,
      status: 'completed',
      eligible: isEligible,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Update record with error
    await db
      .update(eligibilityChecks)
      .set({
        processingStatus: 'error',
        errorMessage,
        checkedAt: new Date(),
      })
      .where(eq(eligibilityChecks.id, pendingRecord.id));

    return {
      patientId: item.patientId,
      insuranceId: item.insuranceId,
      status: 'error',
      error: errorMessage,
    };
  }
}

/**
 * Get eligibility check history for a patient within a practice.
 */
export async function getEligibilityHistory(
  patientId: number,
  practiceId: number
): Promise<Array<typeof eligibilityChecks.$inferSelect>> {
  const results = await db
    .select()
    .from(eligibilityChecks)
    .where(
      and(
        eq(eligibilityChecks.patientId, patientId),
        eq(eligibilityChecks.practiceId, practiceId)
      )
    )
    .orderBy(desc(eligibilityChecks.createdAt));

  return results;
}

/**
 * Find patients whose last eligibility check is older than a threshold.
 * Default threshold is 30 days.
 */
export async function getExpiringEligibility(
  practiceId: number,
  daysAhead: number = 30
): Promise<Array<typeof eligibilityChecks.$inferSelect>> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysAhead);

  // Get the most recent completed check for each patient, filtered to those older than cutoff
  const results = await db
    .select()
    .from(eligibilityChecks)
    .where(
      and(
        eq(eligibilityChecks.practiceId, practiceId),
        eq(eligibilityChecks.processingStatus, 'completed'),
        isNotNull(eligibilityChecks.checkedAt),
        lt(eligibilityChecks.checkedAt, cutoffDate)
      )
    )
    .orderBy(desc(eligibilityChecks.checkedAt));

  // Deduplicate: keep only the most recent check per patient
  const seenPatients = new Map<number, typeof eligibilityChecks.$inferSelect>();
  for (const check of results) {
    if (!seenPatients.has(check.patientId)) {
      seenPatients.set(check.patientId, check);
    }
  }

  return Array.from(seenPatients.values());
}

/**
 * Clear the queue for a practice (admin utility).
 */
export function clearQueue(practiceId: number): number {
  const queue = practiceQueues.get(practiceId);
  if (!queue) return 0;
  const count = queue.length;
  practiceQueues.set(practiceId, []);
  return count;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default {
  queueEligibilityCheck,
  getQueueStatus,
  processBatchEligibility,
  getEligibilityHistory,
  getExpiringEligibility,
  clearQueue,
};
