/**
 * Claim Scrubber Service
 *
 * Validates claims before submission to insurance, checking for:
 * - Active insurance coverage
 * - Valid CPT codes matched to diagnosis
 * - Authorization requirements
 * - Duplicate claims
 * - Required field completeness (NPI, tax ID, patient DOB, etc.)
 *
 * Returns errors (blocking) and warnings (advisory) for each claim.
 */

import { storage } from '../storage';
import { db } from '../db';
import { claims, claimLineItems, insuranceBillingRules } from '@shared/schema';
import { eq, and, ne } from 'drizzle-orm';
import logger from './logger';

export interface ScrubResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  holdReason?: string;
}

/**
 * Scrub a claim for completeness and validity before submission.
 * Returns a result indicating whether the claim can be submitted.
 */
export async function scrubClaim(claimId: number, practiceId: number): Promise<ScrubResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let holdReason: string | undefined;

  try {
    // 1. Load the claim
    const claim = await storage.getClaim(claimId);
    if (!claim) {
      return { passed: false, errors: ['Claim not found'], warnings: [] };
    }

    if (claim.practiceId !== practiceId) {
      return { passed: false, errors: ['Claim does not belong to this practice'], warnings: [] };
    }

    // 2. Load related entities in parallel
    const [patient, practice, lineItems, insuranceList] = await Promise.all([
      storage.getPatient(claim.patientId),
      storage.getPractice(claim.practiceId),
      storage.getClaimLineItems(claimId),
      storage.getInsurances(),
    ]);

    const insurance = claim.insuranceId
      ? insuranceList.find((i) => i.id === claim.insuranceId)
      : null;

    // ---- Required fields ----

    if (!patient) {
      errors.push('Patient record not found');
    } else {
      if (!patient.dateOfBirth) {
        errors.push('Patient date of birth is missing');
      }
      if (!patient.firstName || !patient.lastName) {
        errors.push('Patient name is incomplete');
      }
    }

    if (!practice) {
      errors.push('Practice record not found');
    } else {
      if (!practice.npi) {
        errors.push('Practice NPI number is missing');
      }
      if (!practice.taxId) {
        errors.push('Practice Tax ID is missing');
      }
      if (!practice.address) {
        warnings.push('Practice address is not set');
      }
    }

    // ---- Insurance validation ----

    if (!claim.insuranceId) {
      errors.push('No insurance assigned to claim');
    } else if (!insurance) {
      errors.push('Insurance record not found');
    } else {
      if (insurance.isActive === false) {
        errors.push(`Insurance "${insurance.name}" is marked inactive`);
      }
    }

    // Check patient-level insurance info
    if (patient && !patient.insuranceId && !patient.policyNumber) {
      warnings.push('Patient has no member ID or policy number on file');
    }

    // ---- Line items validation ----

    if (!lineItems || lineItems.length === 0) {
      errors.push('Claim has no line items (CPT codes)');
    } else {
      // Load CPT and ICD codes for validation
      const [cptCodes, icd10Codes] = await Promise.all([
        storage.getCptCodes(),
        storage.getIcd10Codes(),
      ]);

      for (const item of lineItems) {
        const cpt = cptCodes.find((c) => c.id === item.cptCodeId);
        if (!cpt) {
          errors.push(`Line item references invalid CPT code (ID: ${item.cptCodeId})`);
        }

        if (!item.icd10CodeId) {
          warnings.push(
            `Line item for ${cpt?.code || 'unknown CPT'} has no diagnosis code linked`
          );
        } else {
          const icd = icd10Codes.find((c) => c.id === item.icd10CodeId);
          if (!icd) {
            errors.push(
              `Line item for ${cpt?.code || 'unknown CPT'} references invalid ICD-10 code (ID: ${item.icd10CodeId})`
            );
          }
        }

        if (!item.dateOfService) {
          errors.push(
            `Line item for ${cpt?.code || 'unknown CPT'} has no date of service`
          );
        }

        if (!item.amount || parseFloat(String(item.amount)) <= 0) {
          errors.push(
            `Line item for ${cpt?.code || 'unknown CPT'} has no valid amount`
          );
        }
      }

      // Phase 3 — STC consistency check. Fetch the patient's most-recent
      // eligibility check (ignore anything older than 60 days — stale
      // eligibility isn't a reliable signal of what STCs apply today)
      // and verify each line item's cpt.therapyCategory is present in
      // the eligibility's serviceTypeCodes. Mismatch = soft-deny risk.
      try {
        const eligibility = await storage.getPatientEligibility(claim.patientId);
        const eligAgeMs = eligibility?.checkedAt
          ? Date.now() - new Date(eligibility.checkedAt as any).getTime()
          : Number.MAX_SAFE_INTEGER;
        const freshEnough = eligAgeMs < 60 * 24 * 60 * 60 * 1000; // 60 days

        if (eligibility && freshEnough) {
          const sentStcs = (eligibility as any).serviceTypeCodes as string[] | null;
          if (Array.isArray(sentStcs) && sentStcs.length > 0) {
            // Map STC → therapyCategory for comparison.
            const stcToCategory: Record<string, string> = {
              AE: 'OT',
              A7: 'OT',     // legacy/alternate
              AD: 'PT',
              A8: 'PT',     // legacy/alternate
              AF: 'ST',
              A9: 'ST',
              MH: 'MH',
              '30': 'GENERAL', // generic — matches everything
            };
            const coveredCategories = new Set<string>(
              sentStcs.map((s) => stcToCategory[s]).filter(Boolean)
            );
            const allowsAnything = coveredCategories.has('GENERAL');

            for (const item of lineItems) {
              const cpt = cptCodes.find((c) => c.id === item.cptCodeId);
              const cptCategory = (cpt as any)?.therapyCategory as string | null;
              // Skip uncategorized CPTs (therapy_category backfill only
              // covers ~29 common codes) and GENERAL codes that both OT
              // and PT bill — neither is a mismatch signal.
              if (!cptCategory || cptCategory === 'GENERAL') continue;
              if (allowsAnything) continue;
              if (coveredCategories.has(cptCategory)) continue;

              const msg =
                `Line item ${cpt?.code} is ${cptCategory} but eligibility only verified ` +
                `${Array.from(coveredCategories).join('/') || '(none)'}. ` +
                `Payer may soft-deny — consider running a fresh eligibility check with an ` +
                `${cptCategory}-specific STC before resubmitting.`;

              if (practice?.strictStcValidation) {
                errors.push(msg);
                holdReason = holdReason || 'STC/CPT mismatch';
              } else {
                warnings.push(msg);
              }
            }
          }
        }
      } catch (err) {
        // Non-fatal — if storage lookup fails, skip the check and let
        // the existing validations carry the claim through.
        logger.warn('Scrubber: STC consistency check failed', {
          claimId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ---- Total amount validation ----

    if (!claim.totalAmount || parseFloat(String(claim.totalAmount)) <= 0) {
      errors.push('Claim total amount is zero or missing');
    }

    // ---- Authorization check ----

    if (claim.insuranceId && lineItems && lineItems.length > 0) {
      // Check if any billing rule for this payer requires prior auth
      const rules = await db
        .select()
        .from(insuranceBillingRules)
        .where(
          and(
            eq(insuranceBillingRules.insuranceId, claim.insuranceId),
            eq(insuranceBillingRules.requiresPriorAuth, true),
            eq(insuranceBillingRules.isActive, true)
          )
        );

      if (rules.length > 0) {
        // Prior auth is required by at least one billing rule for this payer
        if (!claim.authorizationNumber) {
          holdReason = 'Authorization Pending';
          errors.push(
            'Prior authorization is required by this payer but no authorization number is on file'
          );
        }
      }
    }

    // ---- Duplicate claim check ----

    if (lineItems && lineItems.length > 0 && patient) {
      const firstDateOfService = lineItems[0].dateOfService;
      if (firstDateOfService) {
        // Look for other claims for the same patient on the same date that are not this claim
        const allPracticeClaims = await storage.getClaims(practiceId);
        const potentialDupes = allPracticeClaims.filter(
          (c) =>
            c.id !== claimId &&
            c.patientId === claim.patientId &&
            c.status !== 'denied' &&
            c.insuranceId === claim.insuranceId
        );

        if (potentialDupes.length > 0) {
          // Check line-item level date overlap
          for (const dupe of potentialDupes) {
            const dupeLineItems = await storage.getClaimLineItems(dupe.id);
            const dupeHasSameDateAndCpt = dupeLineItems.some((di) =>
              lineItems.some(
                (li) =>
                  di.dateOfService === li.dateOfService &&
                  di.cptCodeId === li.cptCodeId
              )
            );
            if (dupeHasSameDateAndCpt) {
              warnings.push(
                `Possible duplicate: Claim #${dupe.claimNumber || dupe.id} has the same patient, date of service, and CPT code`
              );
              break; // One warning is enough
            }
          }
        }
      }
    }

    const passed = errors.length === 0;

    logger.info('Claim scrub completed', {
      claimId,
      practiceId,
      passed,
      errorCount: errors.length,
      warningCount: warnings.length,
      holdReason: holdReason || null,
    });

    return { passed, errors, warnings, holdReason };
  } catch (error) {
    logger.error('Claim scrubber error', {
      claimId,
      practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      passed: false,
      errors: ['Internal error during claim scrubbing'],
      warnings: [],
    };
  }
}
