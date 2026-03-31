/**
 * Automated Claim Status Polling Service
 *
 * Polls Stedi 276/277 for submitted claims and auto-detects status changes:
 * - Denials: Updates claim status to 'denied' with reason
 * - Payments: Updates claim status to 'paid' with amount and date
 * - Rejections: Updates claim status to 'rejected'
 *
 * Features:
 * - Rate limiting: 200ms delay between calls, max 50 claims per batch
 * - Smart polling: Only checks claims submitted > 6 hours ago
 * - Audit trail: Creates claimStatusCheck record for every status change
 * - Error handling: Continues processing even if individual checks fail
 */

import { db } from '../db';
import { claims, claimStatusChecks, patients, insurances, practices } from '@shared/schema';
import { eq, and, or, isNull, lt, sql } from 'drizzle-orm';
import { checkClaimStatus, isStediConfigured } from './stediService';
import type { ClaimStatusRequest, ClaimStatusResponse } from './stediService';
import { logger } from './logger';

const RATE_LIMIT_DELAY_MS = 200;
const MAX_CLAIMS_PER_BATCH = 50;
const STATUS_CHECK_INTERVAL_HOURS = 6;

export interface ClaimStatusPollingSummary {
  checked: number;
  statusChanges: number;
  newDenials: number;
  newPayments: number;
  newRejections: number;
  errors: Array<{
    claimId: number;
    claimNumber: string;
    error: string;
  }>;
}

/**
 * Polls claim status for all eligible submitted claims
 * Returns summary of changes detected
 */
export async function pollClaimStatuses(): Promise<ClaimStatusPollingSummary> {
  if (!isStediConfigured()) {
    logger.warn('Stedi not configured, skipping claim status polling');
    return {
      checked: 0,
      statusChanges: 0,
      newDenials: 0,
      newPayments: 0,
      newRejections: 0,
      errors: [],
    };
  }

  const summary: ClaimStatusPollingSummary = {
    checked: 0,
    statusChanges: 0,
    newDenials: 0,
    newPayments: 0,
    newRejections: 0,
    errors: [],
  };

  try {
    // Query claims eligible for status check
    const eligibleClaims = await getEligibleClaims();

    logger.info('Starting claim status polling', {
      eligibleClaimsCount: eligibleClaims.length,
      maxBatchSize: MAX_CLAIMS_PER_BATCH,
    });

    // Process claims with rate limiting
    for (let i = 0; i < Math.min(eligibleClaims.length, MAX_CLAIMS_PER_BATCH); i++) {
      const claim = eligibleClaims[i];

      try {
        await processClaimStatusCheck(claim, summary);
        summary.checked++;

        // Rate limiting: delay between calls
        if (i < eligibleClaims.length - 1) {
          await delay(RATE_LIMIT_DELAY_MS);
        }
      } catch (error: any) {
        logger.error('Error checking claim status', {
          claimId: claim.id,
          claimNumber: claim.claimNumber,
          error: error.message,
        });

        summary.errors.push({
          claimId: claim.id,
          claimNumber: claim.claimNumber || 'unknown',
          error: error.message || 'Unknown error',
        });
      }

      // Always update lastStatusCheckAt, even if check failed
      await db
        .update(claims)
        .set({
          lastStatusCheckAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(claims.id, claim.id));
    }

    logger.info('Completed claim status polling', summary);
    return summary;

  } catch (error: any) {
    logger.error('Fatal error in claim status polling', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Gets claims eligible for status checking:
 * - status = 'submitted'
 * - clearinghouseClaimId is present
 * - lastStatusCheckAt is NULL or > 6 hours ago
 */
async function getEligibleClaims() {
  const sixHoursAgo = new Date(Date.now() - STATUS_CHECK_INTERVAL_HOURS * 60 * 60 * 1000);

  const eligibleClaims = await db
    .select({
      id: claims.id,
      practiceId: claims.practiceId,
      patientId: claims.patientId,
      insuranceId: claims.insuranceId,
      claimNumber: claims.claimNumber,
      clearinghouseClaimId: claims.clearinghouseClaimId,
      status: claims.status,
      totalAmount: claims.totalAmount,
      submittedAt: claims.submittedAt,
      lastStatusCheckAt: claims.lastStatusCheckAt,
      // Patient info
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      patientDateOfBirth: patients.dateOfBirth,
      patientInsuranceId: patients.insuranceId,
      // Insurance info
      insuranceName: insurances.name,
      insurancePayerCode: insurances.payerCode,
      // Practice info
      practiceNpi: practices.npi,
      practiceTaxId: practices.taxId,
    })
    .from(claims)
    .leftJoin(patients, eq(claims.patientId, patients.id))
    .leftJoin(insurances, eq(claims.insuranceId, insurances.id))
    .leftJoin(practices, eq(claims.practiceId, practices.id))
    .where(
      and(
        eq(claims.status, 'submitted'),
        sql`${claims.clearinghouseClaimId} IS NOT NULL`,
        or(
          isNull(claims.lastStatusCheckAt),
          lt(claims.lastStatusCheckAt, sixHoursAgo)
        )
      )
    )
    .limit(MAX_CLAIMS_PER_BATCH);

  return eligibleClaims;
}

/**
 * Processes a single claim status check
 */
async function processClaimStatusCheck(
  claim: any,
  summary: ClaimStatusPollingSummary
): Promise<void> {
  // Validate required data
  if (!claim.claimNumber) {
    throw new Error('Claim missing claimNumber');
  }
  if (!claim.insurancePayerCode) {
    throw new Error('Claim missing insurance payer code');
  }
  if (!claim.practiceNpi) {
    throw new Error('Practice missing NPI');
  }
  if (!claim.patientInsuranceId) {
    throw new Error('Patient missing insurance member ID');
  }
  if (!claim.patientFirstName || !claim.patientLastName || !claim.patientDateOfBirth) {
    throw new Error('Patient missing required demographics');
  }

  // Build Stedi request
  const statusRequest: ClaimStatusRequest = {
    claimId: claim.claimNumber,
    payer: {
      id: claim.insurancePayerCode,
    },
    provider: {
      npi: claim.practiceNpi,
      taxId: claim.practiceTaxId,
    },
    subscriber: {
      memberId: claim.patientInsuranceId,
      firstName: claim.patientFirstName,
      lastName: claim.patientLastName,
      dateOfBirth: claim.patientDateOfBirth.toISOString().split('T')[0],
    },
    dateOfService: claim.submittedAt?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
    claimAmount: claim.totalAmount ? parseFloat(claim.totalAmount) : undefined,
  };

  // Call Stedi
  const statusResponse: ClaimStatusResponse = await checkClaimStatus(statusRequest);

  // Check if status changed
  const previousStatus = claim.status;
  const newStatus = mapStediStatusToClaim(statusResponse.status);

  if (previousStatus !== newStatus) {
    logger.info('Claim status change detected', {
      claimId: claim.id,
      claimNumber: claim.claimNumber,
      previousStatus,
      newStatus,
      statusCode: statusResponse.statusCode,
    });

    // Update claim record
    await updateClaimStatus(claim, statusResponse, newStatus);

    // Create audit record
    await createStatusCheckRecord(claim, statusResponse, previousStatus, newStatus);

    // Update summary
    summary.statusChanges++;
    if (newStatus === 'denied') summary.newDenials++;
    if (newStatus === 'paid') summary.newPayments++;
    if (newStatus === 'rejected') summary.newRejections++;
  }
}

/**
 * Maps Stedi status response to claim status
 */
function mapStediStatusToClaim(stediStatus: ClaimStatusResponse['status']): string {
  switch (stediStatus) {
    case 'paid':
      return 'paid';
    case 'denied':
      return 'denied';
    case 'rejected':
      return 'rejected';
    case 'pending':
    case 'unknown':
    default:
      return 'submitted'; // Keep as submitted if still pending or unknown
  }
}

/**
 * Updates the claim record with new status information
 */
async function updateClaimStatus(
  claim: any,
  statusResponse: ClaimStatusResponse,
  newStatus: string
): Promise<void> {
  const updateData: any = {
    status: newStatus,
    clearinghouseStatus: statusResponse.statusCode || statusResponse.status,
    clearinghouseResponse: statusResponse.raw,
    updatedAt: new Date(),
  };

  // Add status-specific fields
  if (newStatus === 'denied' && statusResponse.denialReason) {
    updateData.denialReason = statusResponse.denialReason;
  }

  if (newStatus === 'paid') {
    if (statusResponse.paidAmount) {
      updateData.paidAmount = statusResponse.paidAmount.toString();
    }
    if (statusResponse.paidDate) {
      updateData.paidAt = new Date(statusResponse.paidDate);
    }
  }

  await db
    .update(claims)
    .set(updateData)
    .where(eq(claims.id, claim.id));
}

/**
 * Creates a claimStatusCheck record for audit trail
 */
async function createStatusCheckRecord(
  claim: any,
  statusResponse: ClaimStatusResponse,
  previousStatus: string,
  newStatus: string
): Promise<void> {
  await db.insert(claimStatusChecks).values({
    claimId: claim.id,
    practiceId: claim.practiceId,
    previousStatus,
    newStatus,
    stediResponse: statusResponse.raw,
    statusCode: statusResponse.statusCode,
    denialReason: statusResponse.denialReason || null,
    paidAmount: statusResponse.paidAmount ? statusResponse.paidAmount.toString() : null,
    paidDate: statusResponse.paidDate ? new Date(statusResponse.paidDate) : null,
    autoDetected: true,
  });
}

/**
 * Delays execution for specified milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Manually check status for a specific claim (bypasses polling eligibility)
 */
export async function checkSingleClaimStatus(claimId: number): Promise<{
  success: boolean;
  statusChanged: boolean;
  previousStatus?: string;
  newStatus?: string;
  error?: string;
}> {
  try {
    // Fetch claim with joined data
    const [claim] = await db
      .select({
        id: claims.id,
        practiceId: claims.practiceId,
        patientId: claims.patientId,
        insuranceId: claims.insuranceId,
        claimNumber: claims.claimNumber,
        clearinghouseClaimId: claims.clearinghouseClaimId,
        status: claims.status,
        totalAmount: claims.totalAmount,
        submittedAt: claims.submittedAt,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        patientDateOfBirth: patients.dateOfBirth,
        patientInsuranceId: patients.insuranceId,
        insurancePayerCode: insurances.payerCode,
        practiceNpi: practices.npi,
        practiceTaxId: practices.taxId,
      })
      .from(claims)
      .leftJoin(patients, eq(claims.patientId, patients.id))
      .leftJoin(insurances, eq(claims.insuranceId, insurances.id))
      .leftJoin(practices, eq(claims.practiceId, practices.id))
      .where(eq(claims.id, claimId));

    if (!claim) {
      return {
        success: false,
        statusChanged: false,
        error: 'Claim not found',
      };
    }

    if (!claim.clearinghouseClaimId) {
      return {
        success: false,
        statusChanged: false,
        error: 'Claim not submitted to clearinghouse',
      };
    }

    const summary: ClaimStatusPollingSummary = {
      checked: 0,
      statusChanges: 0,
      newDenials: 0,
      newPayments: 0,
      newRejections: 0,
      errors: [],
    };

    const previousStatus = claim.status;
    await processClaimStatusCheck(claim, summary);

    // Update lastStatusCheckAt
    await db
      .update(claims)
      .set({
        lastStatusCheckAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(claims.id, claimId));

    // Fetch updated status
    const [updatedClaim] = await db
      .select({ status: claims.status })
      .from(claims)
      .where(eq(claims.id, claimId));

    return {
      success: true,
      statusChanged: previousStatus !== updatedClaim?.status,
      previousStatus,
      newStatus: updatedClaim?.status || undefined,
    };

  } catch (error: any) {
    logger.error('Error checking single claim status', {
      claimId,
      error: error.message,
    });

    return {
      success: false,
      statusChanged: false,
      error: error.message || 'Unknown error',
    };
  }
}

export default {
  pollClaimStatuses,
  checkSingleClaimStatus,
};
