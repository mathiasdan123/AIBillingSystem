/**
 * Claim Status Reaper Service
 *
 * Symmetrical follow-on to the daily eligibility sweep (PR #185). Where the
 * eligibility sweep probes 270/271 for upcoming appointments, this reaper
 * probes 276/277 for claims that have been sitting in `submitted` status
 * too long without an automated payer update.
 *
 * Behavior notes:
 * - Every claim with status='submitted' AND submittedAt < NOW() - N hours is
 *   polled exactly once per reap. (Default N = 24h.) The shorter-cadence
 *   `automatedClaimStatusService` (every 4h) covers fresher claims; this
 *   reaper is the safety net for the long-tail of claims that the payer
 *   has gone quiet on.
 * - Per-claim try/catch — one bad Stedi call does NOT abort the rest.
 * - Idempotent across same-window re-runs: we bump `lastStatusCheckAt` on
 *   every poll, then filter by `lastStatusCheckAt IS NULL OR < cutoff`.
 *   A manual re-trigger within the same window will skip already-polled claims.
 * - Maps Stedi's 277CA buckets onto the 4-value enum the spec calls for:
 *     paid              -> 'paid'
 *     finalized_denied  -> 'denied'
 *     pending / received / returned_for_correction -> 'pending'
 *     unknown / errors  -> leave as 'submitted'
 *   Sub-bucket detail is preserved on claim.clearinghouseStatus +
 *   clearinghouseStatusValue so the UI can still distinguish A7 from A8.
 * - Writes an `audit_log` row with eventCategory='claim_status_reap' on
 *   completion so downstream dashboards can read "last reap summary"
 *   without inventing a new table.
 *
 * Coexistence:
 * - The existing `automatedClaimStatusService.pollClaimStatuses` runs every
 *   4h on a 6h "stale check" window with a 50-claim batch cap. It's a fast
 *   loop for fresh claims. The reaper is the OPPOSITE end — daily, no batch
 *   cap, scoped to claims that have been quiet for ≥24h. Same Stedi
 *   primitive, same audit table, different selection criteria.
 */

import { db } from '../db';
import { claims, claimStatusChecks, patients, insurances, practices } from '@shared/schema';
import { eq, and, isNull, lt, or, sql } from 'drizzle-orm';
import { storage } from '../storage';
import logger from './logger';
import { decryptField, resolveEncryptedDob } from './phiEncryptionService';
import {
  checkClaimStatus,
  type ClaimStatusRequest,
  type ClaimStatusResponse,
} from './stediService';

export interface ReapOptions {
  practiceId?: number;
  olderThanHours?: number;
}

export interface ReapPracticeSummary {
  practiceId: number;
  polled: number;
  transitionedToPaid: number;
  transitionedToDenied: number;
  transitionedToPending: number;
  unchanged: number;
  errors: Array<{ claimId: number; claimNumber?: string | null; error: string }>;
  /** Claim IDs that transitioned to `denied` this run — fed to the denial pipeline. */
  deniedClaimIds: number[];
}

export interface ReapRunSummary {
  olderThanHours: number;
  startedAt: string;
  finishedAt: string;
  practices: ReapPracticeSummary[];
  totals: {
    polled: number;
    transitionedToPaid: number;
    transitionedToDenied: number;
    transitionedToPending: number;
    unchanged: number;
    errors: number;
  };
}

// Test seam: swap the 276/277 primitive and the DB layer in unit tests
// without touching the network or a live database.
export interface ReapDeps {
  checkClaimStatus: typeof checkClaimStatus;
  storage: typeof storage;
  /**
   * Pluggable claim selector. Production hits Drizzle directly; tests inject
   * a fixture array. Receives the practice id + cutoff date and returns the
   * flat join shape `processClaim` expects.
   */
  getStaleSubmittedClaims: (
    practiceId: number,
    cutoff: Date,
  ) => Promise<StaleClaimRow[]>;
  /** Pluggable claim updater. Production uses Drizzle; tests spy. */
  applyClaimTransition: (
    claimId: number,
    update: ClaimTransitionUpdate,
  ) => Promise<void>;
  /** Pluggable audit-row writer for the 276/277 check itself. */
  recordStatusCheck: (row: any) => Promise<void>;
  /** Pluggable "mark we polled this" writer for idempotency. */
  markPolled: (claimId: number, when: Date) => Promise<void>;
}

export interface StaleClaimRow {
  id: number;
  practiceId: number;
  patientId: number;
  insuranceId: number | null;
  claimNumber: string | null;
  clearinghouseClaimId: string | null;
  status: string | null;
  totalAmount: string | null;
  submittedAt: Date | null;
  lastStatusCheckAt: Date | null;
  patientFirstName: string | null;
  patientLastName: string | null;
  patientDateOfBirth: Date | string | null;
  patientDateOfBirthEnc: string | null;
  patientInsuranceId: string | null;
  insurancePayerCode: string | null;
  insuranceName: string | null;
  practiceNpi: string | null;
  practiceTaxId: string | null;
}

export interface ClaimTransitionUpdate {
  status: 'paid' | 'denied' | 'pending' | 'submitted';
  clearinghouseStatus?: string | null;
  clearinghouseStatusValue?: string | null;
  clearinghouseResponse?: any;
  denialReason?: string | null;
  paidAmount?: string | null;
  paidAt?: Date | null;
}

const defaultDeps = (): ReapDeps => ({
  checkClaimStatus,
  storage,
  getStaleSubmittedClaims: defaultGetStaleSubmittedClaims,
  applyClaimTransition: defaultApplyClaimTransition,
  recordStatusCheck: defaultRecordStatusCheck,
  markPolled: defaultMarkPolled,
});

async function defaultGetStaleSubmittedClaims(
  practiceId: number,
  cutoff: Date,
): Promise<StaleClaimRow[]> {
  // status='submitted' AND submittedAt < cutoff (claim has been quiet ≥N hours).
  // ALSO require that lastStatusCheckAt is null or older than the cutoff so a
  // re-run within the same reap window is a no-op (idempotency).
  const rows = await db
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
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      patientDateOfBirth: patients.dateOfBirth,
      patientDateOfBirthEnc: patients.dateOfBirthEnc,
      patientInsuranceId: patients.insuranceId,
      insurancePayerCode: insurances.payerCode,
      insuranceName: insurances.name,
      practiceNpi: practices.npi,
      practiceTaxId: practices.taxId,
    })
    .from(claims)
    .leftJoin(patients, eq(claims.patientId, patients.id))
    .leftJoin(insurances, eq(claims.insuranceId, insurances.id))
    .leftJoin(practices, eq(claims.practiceId, practices.id))
    .where(
      and(
        eq(claims.practiceId, practiceId),
        eq(claims.status, 'submitted'),
        sql`${claims.submittedAt} IS NOT NULL`,
        lt(claims.submittedAt, cutoff),
        or(isNull(claims.lastStatusCheckAt), lt(claims.lastStatusCheckAt, cutoff)),
      ),
    );
  return rows as unknown as StaleClaimRow[];
}

async function defaultApplyClaimTransition(
  claimId: number,
  update: ClaimTransitionUpdate,
): Promise<void> {
  const set: any = {
    status: update.status,
    updatedAt: new Date(),
  };
  if (update.clearinghouseStatus !== undefined) set.clearinghouseStatus = update.clearinghouseStatus;
  if (update.clearinghouseStatusValue !== undefined) {
    set.clearinghouseStatusValue = update.clearinghouseStatusValue;
  }
  if (update.clearinghouseResponse !== undefined) set.clearinghouseResponse = update.clearinghouseResponse;
  if (update.denialReason !== undefined) set.denialReason = update.denialReason;
  if (update.paidAmount !== undefined) set.paidAmount = update.paidAmount;
  if (update.paidAt !== undefined) set.paidAt = update.paidAt;
  await db.update(claims).set(set).where(eq(claims.id, claimId));
}

async function defaultRecordStatusCheck(row: any): Promise<void> {
  await db.insert(claimStatusChecks).values(row);
}

async function defaultMarkPolled(claimId: number, when: Date): Promise<void> {
  await db
    .update(claims)
    .set({ lastStatusCheckAt: when, updatedAt: when })
    .where(eq(claims.id, claimId));
}

/**
 * Map the fine-grained Stedi bucket to the 4-value enum the reaper traffics
 * in. Spec: 'paid' | 'denied' | 'pending' | (no change → leave 'submitted').
 */
export function mapStediBucketToReaperStatus(
  bucket: ClaimStatusResponse['status'],
): 'paid' | 'denied' | 'pending' | 'submitted' {
  switch (bucket) {
    case 'paid':
      return 'paid';
    case 'finalized_denied':
      return 'denied';
    case 'pending':
    case 'received':
    case 'returned_for_correction':
      return 'pending';
    // Rejections are not a coverage decision yet — leave the claim as
    // 'submitted' so the biller fixes & resubmits via the existing flow
    // rather than burying it as a permanent 'denied'.
    case 'rejected':
    case 'rejected_invalid_data':
    case 'rejected_relational_error':
    case 'error_submission':
    case 'unknown':
    default:
      return 'submitted';
  }
}

async function processClaim(
  claim: StaleClaimRow,
  practiceSummary: ReapPracticeSummary,
  deps: ReapDeps,
): Promise<void> {
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
  // Resolve DOB from the encrypted column (preferred) or the legacy plaintext
  // date column, so this keeps working after the plaintext column is dropped.
  const dob = resolveEncryptedDob(claim.patientDateOfBirthEnc, claim.patientDateOfBirth);
  if (!claim.patientFirstName || !claim.patientLastName || !dob) {
    throw new Error('Patient missing required demographics');
  }

  const request: ClaimStatusRequest = {
    claimId: claim.claimNumber,
    payer: { id: claim.insurancePayerCode },
    // practices.taxId is PHI-encrypted at rest and this is a raw join (no
    // storage decryption), so decrypt before sending on the 276 status request.
    provider: { npi: claim.practiceNpi, taxId: decryptField(claim.practiceTaxId) ?? undefined },
    subscriber: {
      // Patient name + member ID are PHI-encrypted at rest (raw join) — decrypt
      // before sending the 276, else the payer gets ciphertext and never matches.
      memberId: decryptField(claim.patientInsuranceId) as string,
      firstName: decryptField(claim.patientFirstName) as string,
      lastName: decryptField(claim.patientLastName) as string,
      dateOfBirth: dob,
    },
    dateOfService:
      claim.submittedAt?.toISOString().split('T')[0] ??
      new Date().toISOString().split('T')[0],
    claimAmount: claim.totalAmount ? parseFloat(claim.totalAmount) : undefined,
  };

  const response = await deps.checkClaimStatus(request, claim.practiceId);

  const previousStatus = claim.status ?? 'submitted';
  const reaperStatus = mapStediBucketToReaperStatus(response.status);

  if (reaperStatus === 'submitted' || reaperStatus === previousStatus) {
    practiceSummary.unchanged += 1;
    return;
  }

  // Build the update payload
  const update: ClaimTransitionUpdate = {
    status: reaperStatus,
    clearinghouseStatus:
      response.statusCategoryCode ?? response.statusCode ?? response.status,
    clearinghouseStatusValue: response.statusCategoryValue ?? null,
    clearinghouseResponse: response.raw,
  };

  if (reaperStatus === 'denied' && response.denialReason) {
    update.denialReason = response.denialReason;
  }
  if (reaperStatus === 'paid') {
    if (response.paidAmount != null) update.paidAmount = String(response.paidAmount);
    if (response.paidDate) update.paidAt = new Date(response.paidDate);
  }

  await deps.applyClaimTransition(claim.id, update);

  await deps.recordStatusCheck({
    claimId: claim.id,
    practiceId: claim.practiceId,
    previousStatus,
    newStatus: reaperStatus,
    stediResponse: response.raw,
    statusCode: response.statusCode ?? null,
    statusCategoryCode: response.statusCategoryCode ?? null,
    statusCategoryValue: response.statusCategoryValue ?? null,
    denialReason: response.denialReason ?? null,
    paidAmount: response.paidAmount != null ? String(response.paidAmount) : null,
    paidDate: response.paidDate ? new Date(response.paidDate) : null,
    autoDetected: true,
  });

  if (reaperStatus === 'paid') practiceSummary.transitionedToPaid += 1;
  else if (reaperStatus === 'denied') {
    practiceSummary.transitionedToDenied += 1;
    practiceSummary.deniedClaimIds.push(claim.id);
  } else if (reaperStatus === 'pending') practiceSummary.transitionedToPending += 1;
}

async function reapPractice(
  practiceId: number,
  olderThanHours: number,
  deps: ReapDeps,
): Promise<ReapPracticeSummary> {
  const summary: ReapPracticeSummary = {
    practiceId,
    polled: 0,
    transitionedToPaid: 0,
    transitionedToDenied: 0,
    transitionedToPending: 0,
    unchanged: 0,
    errors: [],
    deniedClaimIds: [],
  };

  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  let stale: StaleClaimRow[];
  try {
    stale = await deps.getStaleSubmittedClaims(practiceId, cutoff);
  } catch (err: any) {
    logger.error('Claim status reaper: failed to query stale claims', {
      practiceId,
      error: err?.message || String(err),
    });
    summary.errors.push({ claimId: -1, error: err?.message || String(err) });
    return summary;
  }

  for (const claim of stale) {
    summary.polled += 1;
    const now = new Date();
    try {
      await processClaim(claim, summary, deps);
    } catch (err: any) {
      const message = err?.message || String(err);
      logger.error('Claim status reaper: per-claim poll failed', {
        practiceId,
        claimId: claim.id,
        claimNumber: claim.claimNumber,
        error: message,
      });
      summary.errors.push({
        claimId: claim.id,
        claimNumber: claim.claimNumber,
        error: message,
      });
    } finally {
      // Mark the claim as polled regardless of outcome so a re-run in the
      // same window won't re-hit Stedi for the same claim.
      try {
        await deps.markPolled(claim.id, now);
      } catch (markErr: any) {
        logger.error('Claim status reaper: failed to mark claim polled', {
          claimId: claim.id,
          error: markErr?.message || String(markErr),
        });
      }
    }
  }

  return summary;
}

/**
 * Run the claim-status reaper. If `practiceId` is supplied, reaps only that
 * practice (used by the manual-trigger endpoint). Otherwise iterates every
 * practice (used by the cron).
 */
export async function runClaimStatusReap(
  opts: ReapOptions = {},
  injectedDeps?: Partial<ReapDeps>,
): Promise<ReapRunSummary> {
  const deps: ReapDeps = { ...defaultDeps(), ...(injectedDeps || {}) };
  const olderThanHours = opts.olderThanHours ?? 24;
  const startedAt = new Date();

  logger.info('Claim status reap starting', {
    practiceId: opts.practiceId,
    olderThanHours,
  });

  let practiceIds: number[];
  if (opts.practiceId != null) {
    practiceIds = [opts.practiceId];
  } else {
    practiceIds = await deps.storage.getAllPracticeIds();
  }

  const practiceSummaries: ReapPracticeSummary[] = [];
  for (const pid of practiceIds) {
    try {
      practiceSummaries.push(await reapPractice(pid, olderThanHours, deps));
    } catch (err: any) {
      logger.error('Claim status reaper: practice-level failure', {
        practiceId: pid,
        error: err?.message || String(err),
      });
      practiceSummaries.push({
        practiceId: pid,
        polled: 0,
        transitionedToPaid: 0,
        transitionedToDenied: 0,
        transitionedToPending: 0,
        unchanged: 0,
        errors: [{ claimId: -1, error: err?.message || String(err) }],
        deniedClaimIds: [],
      });
    }
  }

  const totals = practiceSummaries.reduce(
    (acc, p) => {
      acc.polled += p.polled;
      acc.transitionedToPaid += p.transitionedToPaid;
      acc.transitionedToDenied += p.transitionedToDenied;
      acc.transitionedToPending += p.transitionedToPending;
      acc.unchanged += p.unchanged;
      acc.errors += p.errors.length;
      return acc;
    },
    {
      polled: 0,
      transitionedToPaid: 0,
      transitionedToDenied: 0,
      transitionedToPending: 0,
      unchanged: 0,
      errors: 0,
    },
  );

  const finishedAt = new Date();
  const result: ReapRunSummary = {
    olderThanHours,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    practices: practiceSummaries,
    totals,
  };

  // Stash the per-practice summary so a future dashboard can read "last
  // reap" without us inventing a new table.
  for (const p of practiceSummaries) {
    try {
      await deps.storage.createAuditLog({
        eventCategory: 'claim_status_reap',
        eventType: 'reap_completed',
        resourceType: 'claim_status_reap',
        resourceId: `practice-${p.practiceId}-${finishedAt.toISOString().slice(0, 10)}`,
        userId: 'system',
        practiceId: p.practiceId,
        details: {
          olderThanHours,
          polled: p.polled,
          transitionedToPaid: p.transitionedToPaid,
          transitionedToDenied: p.transitionedToDenied,
          transitionedToPending: p.transitionedToPending,
          unchanged: p.unchanged,
          errorSample: p.errors.slice(0, 5),
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
        },
        success: p.errors.length === 0,
        ipAddress: '0.0.0.0',
      } as any);
    } catch (auditErr: any) {
      logger.error('Claim status reaper: audit log write failed', {
        practiceId: p.practiceId,
        error: auditErr?.message || String(auditErr),
      });
    }
  }

  logger.info('Claim status reap completed', {
    olderThanHours,
    practicesProcessed: practiceSummaries.length,
    totals,
  });

  // Feed all overnight-detected denials into the denial pipeline so they get
  // an auto-drafted appeal, mirroring what the 4h poller does for fresher
  // claims. runDenialPipeline only DRAFTS (status='ready') and creates a
  // follow-up task — it sends nothing outward. An empty array is a safe no-op.
  const allDeniedClaimIds = practiceSummaries.flatMap((p) => p.deniedClaimIds);
  if (allDeniedClaimIds.length > 0) {
    try {
      const { runDenialPipeline } = await import('./denialPipelineService');
      await runDenialPipeline(allDeniedClaimIds);
    } catch (pipelineErr: any) {
      logger.error('Claim status reaper: denial pipeline handoff failed', {
        claimIds: allDeniedClaimIds,
        error: pipelineErr?.message || String(pipelineErr),
      });
    }
  }

  return result;
}
