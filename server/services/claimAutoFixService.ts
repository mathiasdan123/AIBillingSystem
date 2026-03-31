import { db } from '../db';
import { claims, claimLineItems } from '@shared/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import { logger } from './logger';

export interface ClaimCorrection {
  claimId: number;
  correctionType: 'modifier_fix' | 'code_correction' | 'info_update';
  originalValue: string;
  suggestedValue: string;
  reason: string;
  confidence: number; // 0-1
}

/**
 * Analyzes a denied claim for simple correctable issues
 */
export async function analyzeClaimForFixes(claimId: number): Promise<ClaimCorrection[]> {
  try {
    const corrections: ClaimCorrection[] = [];

    // Fetch claim
    const claim = await db.query.claims.findFirst({
      where: eq(claims.id, claimId),
    });

    if (!claim) {
      logger.error('Claim not found for auto-fix analysis', { claimId });
      return [];
    }

    // Only analyze denied claims
    if (claim.status !== 'denied') {
      logger.info('Claim is not denied, skipping auto-fix analysis', {
        claimId,
        status: claim.status,
      });
      return [];
    }

    const denialReason = (claim.denialReason || '').toLowerCase();

    // Pattern 1: Modifier-related denials
    if (denialReason.includes('modifier')) {
      if (!denialReason.includes('duplicate') && !denialReason.includes('inappropriate')) {
        corrections.push({
          claimId,
          correctionType: 'modifier_fix',
          originalValue: 'No modifier',
          suggestedValue: 'Add modifier GP (for physical therapy) or GO (for occupational therapy)',
          reason: 'Denial mentions missing or incorrect modifier',
          confidence: 0.7,
        });
      }
    }

    // Pattern 2: Bundling denials
    if (denialReason.includes('bundl') || denialReason.includes('inclusive')) {
      corrections.push({
        claimId,
        correctionType: 'modifier_fix',
        originalValue: 'No unbundling modifier',
        suggestedValue: 'Add modifier 59 or XE (separate service)',
        reason: 'Services may have been bundled inappropriately',
        confidence: 0.65,
      });
    }

    // Pattern 3: Coding-related denials
    if (
      denialReason.includes('invalid code') ||
      denialReason.includes('incorrect code') ||
      denialReason.includes('coding')
    ) {
      corrections.push({
        claimId,
        correctionType: 'code_correction',
        originalValue: 'Current procedure codes',
        suggestedValue: 'Review codes for accuracy and current year validity',
        reason: 'Denial indicates coding issue',
        confidence: 0.6,
      });
    }

    // Pattern 4: Missing information
    if (
      denialReason.includes('missing') ||
      denialReason.includes('incomplete') ||
      denialReason.includes('invalid') && (
        denialReason.includes('information') ||
        denialReason.includes('data')
      )
    ) {
      corrections.push({
        claimId,
        correctionType: 'info_update',
        originalValue: 'Incomplete claim data',
        suggestedValue: 'Verify all required fields: patient info, provider NPI, diagnosis codes, service dates',
        reason: 'Denial indicates missing or invalid information',
        confidence: 0.75,
      });
    }

    // Fetch line items for deeper analysis
    const lineItems = await db.query.claimLineItems.findMany({
      where: eq(claimLineItems.claimId, claimId),
    });

    // Analyze line items
    for (const item of lineItems) {
      const procedureCode = item.procedureCode;

      // Common therapy codes that often need modifiers
      const therapyCodes = [
        '97110', // Therapeutic exercises
        '97112', // Neuromuscular re-education
        '97116', // Gait training
        '97140', // Manual therapy
        '97530', // Therapeutic activities
        '97535', // Self-care management
        '97750', // Physical performance test
        '97760', // Orthotic management
        '97763', // Orthotic/prosthetic management
      ];

      if (therapyCodes.includes(procedureCode)) {
        const modifiers = item.modifiers ? JSON.parse(item.modifiers as string) : [];

        // Check if GP/GO modifier is present
        const hasTherapyModifier = modifiers.some((m: string) =>
          ['GP', 'GO', 'GN'].includes(m)
        );

        if (!hasTherapyModifier) {
          corrections.push({
            claimId,
            correctionType: 'modifier_fix',
            originalValue: `${procedureCode} without therapy modifier`,
            suggestedValue: `Add GP (Physical Therapy), GO (Occupational Therapy), or GN (Speech Therapy) modifier`,
            reason: `Therapy code ${procedureCode} typically requires a therapy modifier`,
            confidence: 0.8,
          });
        }
      }

      // Check for missing diagnosis pointer
      if (!item.diagnosisPointer) {
        corrections.push({
          claimId,
          correctionType: 'info_update',
          originalValue: `Line item ${item.id} missing diagnosis pointer`,
          suggestedValue: 'Add diagnosis pointer linking to primary diagnosis',
          reason: 'Line item must reference a diagnosis code',
          confidence: 0.85,
        });
      }
    }

    // Remove duplicate corrections (same type + same suggested value)
    const uniqueCorrections = corrections.filter((correction, index, self) =>
      index === self.findIndex((c) =>
        c.correctionType === correction.correctionType &&
        c.suggestedValue === correction.suggestedValue
      )
    );

    logger.info('Auto-fix analysis completed', {
      claimId,
      correctionsFound: uniqueCorrections.length,
      denialReason: claim.denialReason,
    });

    return uniqueCorrections;
  } catch (error) {
    logger.error('Error analyzing claim for auto-fixes', { error, claimId });
    return [];
  }
}

/**
 * Analyzes recent denied claims for a practice and suggests fixes
 */
export async function analyzeRecentDenialsForFixes(
  practiceId: number
): Promise<{ analyzed: number; fixesSuggested: number }> {
  try {
    // Find denied claims from the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const deniedClaims = await db
      .select({
        id: claims.id,
      })
      .from(claims)
      .where(
        and(
          eq(claims.practiceId, practiceId),
          eq(claims.status, 'denied'),
          gte(claims.updatedAt, sevenDaysAgo)
        )
      );

    let totalFixes = 0;

    // Analyze each denied claim
    for (const claim of deniedClaims) {
      const corrections = await analyzeClaimForFixes(claim.id);
      totalFixes += corrections.length;
    }

    logger.info('Recent denials analyzed for auto-fixes', {
      practiceId,
      claimsAnalyzed: deniedClaims.length,
      totalFixesSuggested: totalFixes,
    });

    return {
      analyzed: deniedClaims.length,
      fixesSuggested: totalFixes,
    };
  } catch (error) {
    logger.error('Error analyzing recent denials for fixes', { error, practiceId });
    return { analyzed: 0, fixesSuggested: 0 };
  }
}
