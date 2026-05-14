/**
 * Claim Auto-Fix Service
 *
 * Analyzes denied claims for correctable issues, persists every correction to
 * the `claim_corrections` table for tracking, and automatically applies the
 * narrow set of fixes that can be made unambiguously:
 *  - Missing therapy modifier on a therapy CPT whose discipline is known
 *    (OT->GO, PT->GP, ST->GN) and whose modifier field is empty.
 *  - Missing line-item diagnosis, backfilled from a sibling line item on the
 *    same claim.
 *
 * Anything ambiguous (which code to use, multi-modifier edits, generic
 * "review your coding" advice) is persisted as a `pending` correction for a
 * human to action — it is never auto-applied. Resubmission is always a human
 * action: this service fixes claim data, it does not send claims.
 */

import { db } from '../db';
import { claims, claimLineItems, cptCodes, claimCorrections } from '@shared/schema';
import { eq, and, gte } from 'drizzle-orm';
import { logger } from './logger';

export interface ClaimCorrection {
  claimId: number;
  correctionType: 'modifier_fix' | 'code_correction' | 'info_update';
  originalValue: string;
  suggestedValue: string;
  reason: string;
  confidence: number; // 0-1
  /** Set when the correction targets a specific line item. */
  lineItemId?: number;
  /** True when the fix can be applied programmatically without judgement. */
  autoApplicable?: boolean;
  /** Internal: the concrete change to apply when autoApplicable. */
  apply?: { field: 'modifier'; value: string } | { field: 'icd10CodeId'; value: number };
}

const THERAPY_MODIFIER_BY_DISCIPLINE: Record<string, string> = {
  PT: 'GP',
  OT: 'GO',
  ST: 'GN',
};

/**
 * Analyzes a denied claim for correctable issues. Returns in-memory
 * corrections (including the concrete change for auto-applicable ones).
 */
export async function analyzeClaimForFixes(claimId: number): Promise<ClaimCorrection[]> {
  try {
    const corrections: ClaimCorrection[] = [];

    const [claim] = await db.select().from(claims).where(eq(claims.id, claimId));
    if (!claim) {
      logger.error('Claim not found for auto-fix analysis', { claimId });
      return [];
    }
    if (claim.status !== 'denied') {
      logger.info('Claim is not denied, skipping auto-fix analysis', {
        claimId,
        status: claim.status,
      });
      return [];
    }

    const denialReason = (claim.denialReason || '').toLowerCase();

    // --- Advisory corrections from the denial reason text (never auto-applied) ---
    if (
      denialReason.includes('modifier') &&
      !denialReason.includes('duplicate') &&
      !denialReason.includes('inappropriate')
    ) {
      corrections.push({
        claimId,
        correctionType: 'modifier_fix',
        originalValue: 'Denial cites a modifier issue',
        suggestedValue: 'Review modifiers on each line item against payer rules',
        reason: 'Denial mentions a missing or incorrect modifier',
        confidence: 0.7,
      });
    }
    if (denialReason.includes('bundl') || denialReason.includes('inclusive')) {
      corrections.push({
        claimId,
        correctionType: 'modifier_fix',
        originalValue: 'Services may have been bundled',
        suggestedValue: 'Consider modifier 59 or XE (distinct/separate service) where appropriate',
        reason: 'Denial indicates services were bundled',
        confidence: 0.6,
      });
    }
    if (
      denialReason.includes('invalid code') ||
      denialReason.includes('incorrect code') ||
      denialReason.includes('coding')
    ) {
      corrections.push({
        claimId,
        correctionType: 'code_correction',
        originalValue: 'Denial cites a coding issue',
        suggestedValue: 'Review CPT/ICD-10 codes for accuracy and current-year validity',
        reason: 'Denial indicates a coding issue',
        confidence: 0.55,
      });
    }

    // --- Structured line-item analysis (some of these are auto-applicable) ---
    const lineItems = await db
      .select({
        id: claimLineItems.id,
        cptCodeId: claimLineItems.cptCodeId,
        icd10CodeId: claimLineItems.icd10CodeId,
        modifier: claimLineItems.modifier,
        cptCode: cptCodes.code,
        therapyCategory: cptCodes.therapyCategory,
      })
      .from(claimLineItems)
      .leftJoin(cptCodes, eq(claimLineItems.cptCodeId, cptCodes.id))
      .where(eq(claimLineItems.claimId, claimId));

    // Pick a fallback diagnosis from sibling line items for backfilling.
    const siblingDiagnosis = pickSiblingDiagnosis(lineItems);

    for (const item of lineItems) {
      // Missing therapy modifier — auto-applicable when discipline is known
      // and the single modifier field is currently empty.
      const expectedModifier = item.therapyCategory
        ? THERAPY_MODIFIER_BY_DISCIPLINE[item.therapyCategory]
        : undefined;
      if (expectedModifier) {
        const current = (item.modifier || '').toUpperCase();
        if (!current) {
          corrections.push({
            claimId,
            lineItemId: item.id,
            correctionType: 'modifier_fix',
            originalValue: `${item.cptCode ?? item.cptCodeId}: no modifier`,
            suggestedValue: `Add ${expectedModifier} modifier (${item.therapyCategory} discipline)`,
            reason: `Therapy code ${item.cptCode ?? item.cptCodeId} requires the ${item.therapyCategory} discipline modifier`,
            confidence: 0.9,
            autoApplicable: true,
            apply: { field: 'modifier', value: expectedModifier },
          });
        } else if (!current.includes(expectedModifier)) {
          // A modifier exists but isn't the expected discipline one — needs a
          // human to decide rather than blindly overwriting.
          corrections.push({
            claimId,
            lineItemId: item.id,
            correctionType: 'modifier_fix',
            originalValue: `${item.cptCode ?? item.cptCodeId}: modifier "${item.modifier}"`,
            suggestedValue: `Verify ${expectedModifier} (${item.therapyCategory}) modifier is present`,
            reason: `Therapy code expects the ${item.therapyCategory} discipline modifier`,
            confidence: 0.7,
          });
        }
      }

      // Missing line-item diagnosis — auto-applicable only when a sibling
      // line item supplies an unambiguous diagnosis to copy.
      if (!item.icd10CodeId) {
        if (siblingDiagnosis) {
          corrections.push({
            claimId,
            lineItemId: item.id,
            correctionType: 'info_update',
            originalValue: `${item.cptCode ?? item.cptCodeId}: no diagnosis`,
            suggestedValue: `Link diagnosis from claim's other line items`,
            reason: 'Line item must reference a diagnosis code',
            confidence: 0.85,
            autoApplicable: true,
            apply: { field: 'icd10CodeId', value: siblingDiagnosis },
          });
        } else {
          corrections.push({
            claimId,
            lineItemId: item.id,
            correctionType: 'info_update',
            originalValue: `${item.cptCode ?? item.cptCodeId}: no diagnosis`,
            suggestedValue: 'Assign a diagnosis code to this line item',
            reason: 'Line item must reference a diagnosis code',
            confidence: 0.85,
          });
        }
      }
    }

    return corrections;
  } catch (error) {
    logger.error('Error analyzing claim for auto-fixes', { error, claimId });
    return [];
  }
}

/**
 * Returns the diagnosis (icd10CodeId) shared by sibling line items, or null if
 * there is no single unambiguous value to copy.
 */
function pickSiblingDiagnosis(lineItems: Array<{ icd10CodeId: number | null }>): number | null {
  const present = lineItems
    .map(li => li.icd10CodeId)
    .filter((v): v is number => v != null);
  if (present.length === 0) return null;
  const unique = Array.from(new Set(present));
  return unique.length === 1 ? unique[0] : null;
}

export interface AutoFixResult {
  claimId: number;
  correctionsFound: number;
  correctionsPersisted: number;
  fixesApplied: number;
}

/**
 * Analyzes a denied claim, persists every correction to `claim_corrections`,
 * and applies the auto-applicable subset to the claim's line items. Idempotent
 * — applied fixes are not re-detected, and persistence dedupes on
 * claim + type + suggestedValue.
 */
export async function applyAutoFixableCorrections(
  claimId: number,
  practiceId: number,
): Promise<AutoFixResult> {
  const result: AutoFixResult = {
    claimId,
    correctionsFound: 0,
    correctionsPersisted: 0,
    fixesApplied: 0,
  };

  const corrections = await analyzeClaimForFixes(claimId);
  result.correctionsFound = corrections.length;
  if (corrections.length === 0) return result;

  // Existing corrections for this claim — used to dedupe.
  const existing = await db
    .select({
      correctionType: claimCorrections.correctionType,
      suggestedValue: claimCorrections.suggestedValue,
    })
    .from(claimCorrections)
    .where(eq(claimCorrections.claimId, claimId));
  const existingKeys = new Set(
    existing.map((e: any) => `${e.correctionType}:${e.suggestedValue}`),
  );

  for (const correction of corrections) {
    const key = `${correction.correctionType}:${correction.suggestedValue}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);

    let applied = false;
    if (correction.autoApplicable && correction.apply && correction.lineItemId) {
      try {
        await db
          .update(claimLineItems)
          .set({ [correction.apply.field]: correction.apply.value })
          .where(eq(claimLineItems.id, correction.lineItemId));
        applied = true;
        result.fixesApplied++;
        logger.info('Auto-fix applied to line item', {
          claimId,
          lineItemId: correction.lineItemId,
          field: correction.apply.field,
          value: correction.apply.value,
        });
      } catch (error: any) {
        logger.error('Failed to apply auto-fix', {
          claimId,
          lineItemId: correction.lineItemId,
          error: error.message,
        });
      }
    }

    await db.insert(claimCorrections).values({
      claimId,
      practiceId,
      correctionType: correction.correctionType,
      originalValue: correction.originalValue,
      suggestedValue: correction.suggestedValue,
      reason: correction.reason,
      confidence: correction.confidence.toFixed(2),
      status: applied ? 'applied' : 'pending',
      approvedBy: applied ? 'auto-fix' : null,
      approvedAt: applied ? new Date() : null,
    });
    result.correctionsPersisted++;
  }

  if (result.fixesApplied > 0 || result.correctionsPersisted > 0) {
    logger.info('Auto-fix processing completed', result);
  }
  return result;
}

/**
 * Runs auto-fix processing for all recently denied claims in a practice.
 */
export async function analyzeRecentDenialsForFixes(
  practiceId: number,
): Promise<{ analyzed: number; fixesApplied: number; correctionsPersisted: number }> {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const deniedClaims = await db
      .select({ id: claims.id })
      .from(claims)
      .where(
        and(
          eq(claims.practiceId, practiceId),
          eq(claims.status, 'denied'),
          gte(claims.updatedAt, sevenDaysAgo),
        ),
      );

    let fixesApplied = 0;
    let correctionsPersisted = 0;
    for (const claim of deniedClaims) {
      const r = await applyAutoFixableCorrections(claim.id, practiceId);
      fixesApplied += r.fixesApplied;
      correctionsPersisted += r.correctionsPersisted;
    }

    const summary = {
      analyzed: deniedClaims.length,
      fixesApplied,
      correctionsPersisted,
    };
    logger.info('Recent denials analyzed for auto-fixes', { practiceId, ...summary });
    return summary;
  } catch (error) {
    logger.error('Error analyzing recent denials for fixes', { error, practiceId });
    return { analyzed: 0, fixesApplied: 0, correctionsPersisted: 0 };
  }
}

/**
 * Runs auto-fix processing across every practice — scheduler safety net.
 */
export async function analyzeRecentDenialsForFixesAllPractices(): Promise<{
  practices: number;
  analyzed: number;
  fixesApplied: number;
}> {
  const allClaims = await db.select({ practiceId: claims.practiceId }).from(claims);
  const practiceIds: number[] = Array.from(
    new Set(allClaims.map((c: any) => c.practiceId as number)),
  );

  let analyzed = 0;
  let fixesApplied = 0;
  for (const practiceId of practiceIds) {
    const r = await analyzeRecentDenialsForFixes(practiceId);
    analyzed += r.analyzed;
    fixesApplied += r.fixesApplied;
  }
  return { practices: practiceIds.length, analyzed, fixesApplied };
}
