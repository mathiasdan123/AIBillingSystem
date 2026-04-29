/**
 * Appeal Prompt Preview (Debug)
 *
 * Admin-only route that returns the literal prompt that WOULD be sent to
 * Claude for a given denied claim, without actually calling the API. Lets
 * us iterate on prompt quality (Phase 0 enrichment from plan benefits +
 * payment precedents) without burning Claude tokens.
 *
 * GET /api/ai/appeal-prompt-preview/:claimId
 *
 * Response shape:
 *   {
 *     systemPrompt: string,
 *     userPrompt: string,
 *     enrichment: {
 *       parsedBenefits: { found: boolean, planName?: string, ... },
 *       precedents: { totalCount: number, byCpt: Record<cpt, count> }
 *     },
 *     claim: { id, claimNumber, denialReason, ... }
 *   }
 */

import { Router, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';
import { db } from '../db';
import { claims } from '@shared/schema';
import logger from '../services/logger';
import { buildSystemPrompt, buildUserPrompt } from '../services/claudeAppealService';
import { findPrecedentsForDeniedClaim } from '../services/claimPrecedentService';
import { getProvenArgumentsForContext } from '../services/appealOutcomeLearningService';
import { getPatientPlanBenefits } from '../storage/patients';

const router = Router();

/**
 * Look up a claim by either:
 *   - database ID (numeric, e.g. "47"), OR
 *   - human-readable claim number (e.g. "CLM-DEMO-006")
 *
 * The UI shows claim numbers, not database IDs, and claims open in a modal
 * so the database ID isn't visible from the URL bar. Accepting both makes
 * the debug endpoint usable straight from the address bar.
 */
async function resolveClaim(idOrNumber: string) {
  const asInt = parseInt(idOrNumber, 10);
  if (!isNaN(asInt) && String(asInt) === idOrNumber.trim()) {
    return await storage.getClaim(asInt);
  }
  // Fallback: lookup by claimNumber
  const [row] = await db
    .select()
    .from(claims)
    .where(eq(claims.claimNumber, idOrNumber.trim()))
    .limit(1);
  return row;
}

router.get('/appeal-prompt-preview/:claimId', isAuthenticated, async (req: any, res: Response) => {
  // Admin-only — this exposes raw prompts which include verbatim plan
  // language. Not appropriate for general staff.
  if (req.userRole !== 'admin') {
    return res.status(403).json({ message: 'Admin role required' });
  }

  try {
    const idOrNumber = req.params.claimId;
    if (!idOrNumber || typeof idOrNumber !== 'string') {
      return res.status(400).json({ message: 'Provide a claim ID or claim number' });
    }

    const claim = await resolveClaim(idOrNumber);
    if (!claim) {
      return res.status(404).json({ message: `Claim "${idOrNumber}" not found (looked up by ID and by claimNumber)` });
    }

    const userPracticeId = req.userPracticeId;
    if (claim.practiceId !== userPracticeId && req.userRole !== 'admin') {
      return res.status(403).json({ message: 'Claim does not belong to your practice' });
    }

    // Patient + practice
    const patient = claim.patientId ? await storage.getPatient(claim.patientId) : null;
    const practice = await storage.getPractice(claim.practiceId);

    // Line items + CPT/ICD lookups (mirrors the real handler in ai-assistant.ts)
    const lineItems = await storage.getClaimLineItems(claim.id);
    const allCpts: any[] = await storage.getCptCodes();
    const allIcds: any[] = await storage.getIcd10Codes();

    const lineItemDetails = lineItems.map((li: any) => {
      const cpt = li.cptCodeId ? allCpts.find((c) => c.id === li.cptCodeId) : null;
      const icd = li.icd10CodeId ? allIcds.find((c) => c.id === li.icd10CodeId) : null;
      return {
        cptCode: cpt ? { code: cpt.code, description: cpt.description } : undefined,
        icd10Code: icd ? { code: icd.code, description: icd.description } : undefined,
        units: li.units || 1,
        amount: li.amount || '0',
      };
    });

    // Phase 0 enrichment data — same fetch logic as ai-assistant.ts
    let parsedBenefits: any = null;
    let precedents: any = null;
    if (claim.patientId) {
      try {
        parsedBenefits = await getPatientPlanBenefits(claim.patientId);
      } catch (err: any) {
        logger.warn('Preview: plan benefits fetch failed', { claimId: claim.id, error: err?.message });
      }

      const cptList = lineItemDetails
        .map((li) => li.cptCode?.code)
        .filter((c): c is string => typeof c === 'string' && c.length > 0);
      const firstDx = lineItemDetails.find((li) => li.icd10Code)?.icd10Code?.code;

      if (cptList.length > 0) {
        try {
          precedents = await findPrecedentsForDeniedClaim({
            practiceId: claim.practiceId,
            patientId: claim.patientId,
            insuranceId: claim.insuranceId ?? undefined,
            cptCodes: cptList,
            diagnosisCode: firstDx,
            daysBack: 365,
          });
        } catch (err: any) {
          logger.warn('Preview: precedent fetch failed', { claimId: claim.id, error: err?.message });
        }
      }
    }

    // Tier A #2 — proven arguments from past won appeals for this practice + payer
    let provenArguments: any[] = [];
    try {
      provenArguments = await getProvenArgumentsForContext({
        practiceId: claim.practiceId,
        payerName: patient?.insuranceProvider ?? null,
      });
    } catch (err: any) {
      logger.warn('Preview: proven arguments fetch failed', { claimId: claim.id, error: err?.message });
    }

    // Build the prompts using the exact same paths as the real generator.
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt({
      claim: {
        id: claim.id,
        claimNumber: claim.claimNumber,
        totalAmount: claim.totalAmount,
        denialReason: claim.denialReason,
        submittedAt: claim.submittedAt,
      },
      lineItems: lineItemDetails,
      patient: {
        firstName: patient?.firstName || 'Unknown',
        lastName: patient?.lastName || 'Patient',
        dateOfBirth: patient?.dateOfBirth || null,
        insuranceProvider: patient?.insuranceProvider || null,
        insuranceId: patient?.insuranceId || patient?.policyNumber || null,
      },
      practice: {
        name: practice?.name || 'Practice',
        npi: practice?.npi || null,
        address: practice?.address || null,
        phone: practice?.phone || null,
      },
      denialReason: claim.denialReason || 'Reason not specified',
      parsedBenefits,
      precedents,
      provenArguments,
    });

    // Build a small enrichment summary so admins can quickly see what Phase 0
    // data was available without parsing the full prompt.
    const precedentsByCpt: Record<string, number> = {};
    let totalPrecedents = 0;
    if (precedents) {
      precedents.forEach((list: any[], cpt: string) => {
        precedentsByCpt[cpt] = list.length;
        totalPrecedents += list.length;
      });
    }

    res.json({
      systemPrompt,
      userPrompt,
      enrichment: {
        parsedBenefits: parsedBenefits
          ? {
              found: true,
              planName: parsedBenefits.planName ?? null,
              planType: parsedBenefits.planType ?? null,
              hasExclusions: Array.isArray(parsedBenefits.rawExtractedData?.exclusions)
                && parsedBenefits.rawExtractedData.exclusions.length > 0,
              hasMedicalNecessityCriteria: Boolean(parsedBenefits.rawExtractedData?.medical_necessity_criteria),
              hasNetworkAdequacyLanguage: Boolean(parsedBenefits.rawExtractedData?.network_adequacy_language),
              hasAppealRights: Boolean(parsedBenefits.rawExtractedData?.appeal_rights),
            }
          : { found: false },
        precedents: {
          totalCount: totalPrecedents,
          byCpt: precedentsByCpt,
        },
        provenArguments: {
          count: provenArguments.length,
          arguments: provenArguments.map((p) => ({
            argument: p.argument,
            winRate: p.winRate,
            winCount: p.winCount,
            totalCount: p.totalCount,
          })),
        },
      },
      claim: {
        id: claim.id,
        claimNumber: claim.claimNumber,
        denialReason: claim.denialReason,
        totalAmount: claim.totalAmount,
        status: claim.status,
      },
    });
  } catch (err: any) {
    logger.error('Appeal prompt preview failed', { error: err?.message, stack: err?.stack });
    res.status(500).json({ message: 'Failed to build appeal prompt preview' });
  }
});

export default router;
