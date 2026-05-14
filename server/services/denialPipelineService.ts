/**
 * Denial Pipeline Service
 *
 * Closes the loop between claim-status polling and appeals. When a claim is
 * detected as denied, this orchestrator:
 *  1. Auto-drafts an appeal letter (AI generator) and stores it as an appeal
 *     in `ready` status — the letter is prepared but a human still submits it.
 *  2. Creates a `denial_appeal` follow-up task so the denial surfaces in the
 *     billing work queue.
 *
 * Idempotent: re-running for the same claim will not duplicate appeals or
 * follow-ups. Safe to call from both the automated poller and manual status
 * checks.
 */

import { db } from '../db';
import { claims, claimFollowUps } from '../../shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { storage } from '../storage';
import { appealGenerator } from '../aiAppealGenerator';
import { applyAutoFixableCorrections } from './claimAutoFixService';
import logger from './logger';

const APPEAL_FILING_WINDOW_DAYS = 14;

export interface DenialPipelineResult {
  claimId: number;
  appealCreated: boolean;
  appealId?: number;
  followUpCreated: boolean;
  autoFixesApplied: number;
  skippedReason?: string;
  error?: string;
}

/**
 * Processes a single denied claim: drafts an appeal and creates a follow-up.
 * Idempotent — skips work that already exists.
 */
export async function processDeniedClaim(claimId: number): Promise<DenialPipelineResult> {
  const result: DenialPipelineResult = {
    claimId,
    appealCreated: false,
    followUpCreated: false,
    autoFixesApplied: 0,
  };

  try {
    const claim = await storage.getClaim(claimId);
    if (!claim) {
      result.skippedReason = 'claim_not_found';
      return result;
    }
    if (claim.status !== 'denied') {
      result.skippedReason = `claim_status_${claim.status}`;
      return result;
    }

    // --- Appeal draft (idempotent: skip if an appeal already exists) ---
    const existingAppeals = await storage.getAppealsByClaimId(claimId);
    if (existingAppeals.length > 0) {
      result.skippedReason = 'appeal_exists';
      result.appealId = existingAppeals[0].id;
    } else {
      const appealId = await draftAppeal(claim);
      if (appealId) {
        result.appealCreated = true;
        result.appealId = appealId;
      }
    }

    // --- Follow-up task (idempotent: dedup on claimId + denial_appeal) ---
    result.followUpCreated = await ensureDenialFollowUp(claim);

    // --- Auto-fix: persist corrections and apply the unambiguous ones ---
    const autoFix = await applyAutoFixableCorrections(claimId, claim.practiceId);
    result.autoFixesApplied = autoFix.fixesApplied;

    return result;
  } catch (error: any) {
    logger.error('Denial pipeline failed for claim', { claimId, error: error.message });
    result.error = error.message || 'Unknown error';
    return result;
  }
}

/**
 * Runs the denial pipeline for a batch of claim IDs (e.g. the denials a
 * polling run just detected). Processes sequentially to keep AI/DB load low.
 */
export async function runDenialPipeline(claimIds: number[]): Promise<DenialPipelineResult[]> {
  if (claimIds.length === 0) return [];

  logger.info('Running denial pipeline', { claimCount: claimIds.length });
  const results: DenialPipelineResult[] = [];
  for (const claimId of claimIds) {
    results.push(await processDeniedClaim(claimId));
  }

  const appealsDrafted = results.filter(r => r.appealCreated).length;
  const followUpsCreated = results.filter(r => r.followUpCreated).length;
  const autoFixesApplied = results.reduce((sum, r) => sum + r.autoFixesApplied, 0);
  logger.info('Denial pipeline complete', {
    processed: results.length,
    appealsDrafted,
    followUpsCreated,
    autoFixesApplied,
  });

  return results;
}

/**
 * Generates an AI appeal letter for a denied claim and persists it as an
 * appeal in `ready` status. Returns the new appeal id, or null if generation
 * failed (the follow-up task still gets created so the denial isn't lost).
 */
async function draftAppeal(claim: any): Promise<number | null> {
  try {
    const patient = claim.patientId ? await storage.getPatient(claim.patientId) : null;
    const lineItems = await storage.getClaimLineItems(claim.id);
    const formattedLineItems = lineItems.map((item: any) => ({
      cptCode: item.cptCodeId ? { code: String(item.cptCodeId), description: '' } : undefined,
      icd10Code: item.diagnosisCodeId ? { code: String(item.diagnosisCodeId), description: '' } : undefined,
      units: item.units || 1,
      amount: item.amount || '0',
    }));
    const practiceData = { name: 'Practice', npi: null, address: null, phone: null };
    const patientData = patient
      ? {
          firstName: patient.firstName,
          lastName: patient.lastName,
          dateOfBirth: patient.dateOfBirth,
          insuranceProvider: patient.insuranceProvider,
          insuranceId: patient.insuranceId,
        }
      : { firstName: 'Unknown', lastName: 'Patient', dateOfBirth: null, insuranceProvider: null, insuranceId: null };

    const appealResult = await appealGenerator.generateAppeal(
      { ...claim, denialReason: claim.denialReason || 'No reason provided' },
      formattedLineItems,
      patientData,
      practiceData,
    );

    // 60-day filing deadline is the conservative default used by the manual
    // appeal flow; billing staff can adjust before submitting.
    const deadlineDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const appeal = await storage.createAppeal({
      claimId: claim.id,
      practiceId: claim.practiceId,
      appealLevel: 'initial',
      status: 'ready',
      denialCategory: appealResult.denialCategory || null,
      deadlineDate,
      appealedAmount: claim.totalAmount,
      appealLetter: appealResult.appealLetter || null,
      keyArguments: appealResult.keyArguments ?? null,
      notes: 'Auto-drafted by denial pipeline. Review and submit.',
      supportingDocs: [],
    });

    logger.info('Denial pipeline drafted appeal', { claimId: claim.id, appealId: appeal.id });
    return appeal.id;
  } catch (error: any) {
    logger.error('Denial pipeline could not draft appeal', {
      claimId: claim.id,
      error: error.message,
    });
    return null;
  }
}

/**
 * Creates a `denial_appeal` follow-up for the claim unless an active one
 * already exists. Returns true if a new follow-up was inserted.
 */
async function ensureDenialFollowUp(claim: any): Promise<boolean> {
  const existing = await db
    .select({ id: claimFollowUps.id })
    .from(claimFollowUps)
    .where(
      and(
        eq(claimFollowUps.claimId, claim.id),
        eq(claimFollowUps.followUpType, 'denial_appeal'),
        inArray(claimFollowUps.status, ['pending', 'in_progress']),
      ),
    );

  if (existing.length > 0) return false;

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + APPEAL_FILING_WINDOW_DAYS);

  await db.insert(claimFollowUps).values({
    claimId: claim.id,
    practiceId: claim.practiceId,
    followUpType: 'denial_appeal',
    status: 'pending',
    priority: 'high',
    notes: `Claim ${claim.claimNumber || claim.id} denied${claim.denialReason ? `: ${claim.denialReason}` : ''}. Draft appeal prepared — review and submit.`,
    dueDate,
  });

  return true;
}

export default { processDeniedClaim, runDenialPipeline };
