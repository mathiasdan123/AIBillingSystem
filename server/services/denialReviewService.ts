/**
 * Denial-review shared service.
 *
 * Single source of truth for the "review denied claims" and "suggest claim
 * correction" behaviors. Both the in-app Blanche dispatcher
 * (server/routes/ai-assistant.ts) and the MCP tools
 * (server/mcp/tools/denials.ts) call these so the two surfaces stay in
 * lockstep.
 *
 * Compliance note: this code only *suggests* corrections and surfaces denial
 * reasons — the treating provider makes the final coding decision.
 */

import { storage } from '../storage';

export interface DeniedClaimSummary {
  claimId: number;
  claimNumber: string | null;
  patientName: string;
  amount: string;
  denialReason: string;
  serviceDate: unknown;
  suggestedAction: string;
}

export interface ReviewDeniedClaimsResult {
  totalDenied: number;
  deniedClaims: DeniedClaimSummary[];
  message: string;
}

/**
 * Map a denial reason to a high-level suggested next action. Pure function,
 * shared so both surfaces produce identical guidance.
 */
function suggestedActionForReason(denialReason: string | null | undefined): string {
  const reason = (denialReason || '').toLowerCase();
  if (reason.includes('authorization') || reason.includes('prior auth')) {
    return 'Obtain prior authorization and resubmit the claim';
  }
  if (reason.includes('duplicate')) {
    return 'Check for duplicate claims and void if necessary';
  }
  if (reason.includes('missing') || reason.includes('incomplete') || reason.includes('information')) {
    return 'Identify missing information, correct the claim, and resubmit';
  }
  if (reason.includes('not covered') || reason.includes('coverage') || reason.includes('non-covered')) {
    return 'Review coverage terms; consider alternative CPT codes or filing an appeal';
  }
  if (reason.includes('timely') || reason.includes('filing')) {
    return 'Gather proof of original submission and file a timely filing appeal';
  }
  if (reason.includes('medical necessity') || reason.includes('not medically necessary')) {
    return 'Strengthen clinical documentation and file a medical necessity appeal';
  }
  if (reason.includes('coding') || reason.includes('modifier') || reason.includes('bundl')) {
    return 'Review CPT/modifier coding and resubmit with corrections';
  }
  return 'Review denial reason and consider filing an appeal';
}

/**
 * List denied claims for a practice with a suggested action for each.
 * Returns at most 20 enriched entries (but reports the true total).
 */
export async function reviewDeniedClaims(practiceId: number): Promise<ReviewDeniedClaimsResult> {
  const allClaims = await storage.getClaims(practiceId);
  const deniedClaims = allClaims.filter((c: any) => c.status === 'denied');

  if (deniedClaims.length === 0) {
    return {
      totalDenied: 0,
      deniedClaims: [],
      message: 'No denied claims found for this practice.',
    };
  }

  const deniedDetails = await Promise.all(
    deniedClaims.slice(0, 20).map(async (claim: any) => {
      let patientName = 'Unknown';
      if (claim.patientId) {
        try {
          const patient = await storage.getPatient(claim.patientId);
          if (patient) patientName = `${patient.firstName} ${patient.lastName}`;
        } catch {
          /* non-blocking */
        }
      }
      return {
        claimId: claim.id,
        claimNumber: claim.claimNumber,
        patientName,
        amount: `$${claim.totalAmount}`,
        denialReason: claim.denialReason || 'Not specified',
        serviceDate: claim.submittedAt || claim.createdAt,
        suggestedAction: suggestedActionForReason(claim.denialReason),
      };
    }),
  );

  return {
    totalDenied: deniedClaims.length,
    deniedClaims: deniedDetails,
    message: `Found ${deniedClaims.length} denied claim(s). I can draft appeal letters or suggest corrections for any of them.`,
  };
}

export interface ClaimCorrection {
  issue: string;
  correction: string;
  priority: string;
}

export interface SuggestClaimCorrectionResult {
  claimId: number;
  claimNumber: string | null;
  amount: string;
  denialReason: string;
  overallStrategy: string;
  corrections: ClaimCorrection[];
  lineItems: Array<{ units: unknown; amount: unknown; modifier: unknown }>;
  message: string;
}

/**
 * Analyze a denied claim's denial reason and return concrete, prioritized
 * correction suggestions. Tenant-scoped: throws if the claim is missing or
 * belongs to another practice. The provider makes the final coding decision.
 */
export async function suggestClaimCorrection(
  practiceId: number,
  claimId: number,
): Promise<SuggestClaimCorrectionResult> {
  const corrClaim = await storage.getClaim(claimId);
  if (!corrClaim) throw new Error(`Claim ${claimId} not found.`);
  if ((corrClaim as any).practiceId !== practiceId) {
    throw new Error('Claim does not belong to this practice.');
  }

  const denialText = ((corrClaim as any).denialReason || '').toLowerCase();
  const corrections: ClaimCorrection[] = [];
  let overallStrategy = 'appeal';

  if (denialText.includes('authorization') || denialText.includes('prior auth') || denialText.includes('pre-cert')) {
    corrections.push({
      issue: 'Prior authorization required',
      correction: 'Obtain retroactive authorization from the payer if possible. Contact the insurance company to request a retroactive auth, citing clinical necessity and any documentation of the referral process. Then resubmit the claim with the authorization number.',
      priority: 'high',
    });
    overallStrategy = 'resubmit_with_auth';
  }

  if (denialText.includes('duplicate')) {
    corrections.push({
      issue: 'Duplicate claim detected',
      correction: 'Check your claims list for duplicate submissions for the same patient, date of service, and CPT codes. If a true duplicate exists, void the extra claim. If the services were distinct (e.g., different times or codes), add modifier 59 (Distinct Procedural Service) or modifier XE/XS/XP/XU and resubmit with documentation explaining why the services are separate.',
      priority: 'high',
    });
    overallStrategy = 'correct_and_resubmit';
  }

  if (denialText.includes('missing') || denialText.includes('incomplete') || denialText.includes('invalid') || denialText.includes('information')) {
    corrections.push({
      issue: 'Missing or incomplete information',
      correction: 'Review the claim for missing fields: patient demographics, insurance member ID, group number, referring provider NPI, diagnosis codes, or modifiers. Correct the missing data and resubmit. Common missing items include: GO/GP modifier on therapy codes, rendering provider NPI, and place of service code.',
      priority: 'high',
    });
    overallStrategy = 'correct_and_resubmit';
  }

  if (denialText.includes('not covered') || denialText.includes('non-covered') || denialText.includes('coverage') || denialText.includes('benefit')) {
    corrections.push({
      issue: 'Service not covered under plan',
      correction: 'Verify the patient\'s specific plan benefits for therapy services. Consider: (1) Using an alternative CPT code that is covered (e.g., 97530 instead of 97110 if functionally appropriate), (2) Adding appropriate modifiers, (3) Checking if a different diagnosis code better supports medical necessity, (4) Filing an appeal with clinical documentation showing the service was medically necessary.',
      priority: 'medium',
    });
    overallStrategy = 'appeal_or_recode';
  }

  if (denialText.includes('timely') || denialText.includes('filing') || denialText.includes('deadline')) {
    corrections.push({
      issue: 'Timely filing deadline exceeded',
      correction: 'Gather proof of original submission (clearinghouse confirmation, submission logs, or screenshots). File a timely filing appeal with this evidence. If the delay was due to incorrect payer information or a payer processing error, include documentation of the initial submission attempt.',
      priority: 'critical',
    });
    overallStrategy = 'timely_filing_appeal';
  }

  if (denialText.includes('medical necessity') || denialText.includes('not medically necessary') || denialText.includes('not necessary')) {
    corrections.push({
      issue: 'Medical necessity not established',
      correction: 'Strengthen clinical documentation by: (1) Ensuring SOAP notes clearly document functional deficits and skilled intervention need, (2) Including measurable treatment goals and progress data, (3) Referencing clinical practice guidelines (e.g., AOTA, APA), (4) Documenting why services require the skill of a licensed therapist. File an appeal with updated documentation.',
      priority: 'high',
    });
    overallStrategy = 'appeal_with_documentation';
  }

  if (denialText.includes('coding') || denialText.includes('modifier') || denialText.includes('bundl') || denialText.includes('unbundl')) {
    corrections.push({
      issue: 'Coding or modifier error',
      correction: 'Review CPT code selection and modifiers: (1) Ensure the correct therapy modifier is applied (GO for OT, GP for PT, GN for SLP), (2) Check for bundling conflicts (e.g., 97140 and 97530 billed same session may require modifier 59), (3) Verify units match documented treatment time per the 8-minute rule, (4) Correct any code-to-diagnosis mismatches. Resubmit with corrected codes.',
      priority: 'high',
    });
    overallStrategy = 'correct_and_resubmit';
  }

  if (denialText.includes('eligib') || denialText.includes('not eligible') || denialText.includes('inactive') || denialText.includes('terminated')) {
    corrections.push({
      issue: 'Patient eligibility issue',
      correction: 'Verify patient insurance eligibility for the date of service. Check: (1) Was the policy active on the service date? (2) Is the member ID correct? (3) Is there a coordination of benefits issue (secondary insurance)? Run an eligibility check and resubmit to the correct payer if needed.',
      priority: 'high',
    });
    overallStrategy = 'verify_eligibility_and_resubmit';
  }

  if (corrections.length === 0) {
    corrections.push({
      issue: 'Denial reason requires manual review',
      correction: `The denial reason "${(corrClaim as any).denialReason || 'not specified'}" does not match a common pattern. Recommended steps: (1) Contact the payer to clarify the exact denial reason and required corrections, (2) Review the EOB/ERA for specific remark codes, (3) Consider filing a formal appeal with supporting clinical documentation.`,
      priority: 'medium',
    });
    overallStrategy = 'contact_payer';
  }

  let lineItemSummary: Array<{ units: unknown; amount: unknown; modifier: unknown }> = [];
  try {
    const lineItems = await storage.getClaimLineItems(claimId);
    lineItemSummary = lineItems.map((li: any) => ({
      units: li.units,
      amount: li.amount,
      modifier: li.modifier,
    }));
  } catch {
    /* non-blocking */
  }

  return {
    claimId: (corrClaim as any).id,
    claimNumber: (corrClaim as any).claimNumber,
    amount: `$${(corrClaim as any).totalAmount}`,
    denialReason: (corrClaim as any).denialReason || 'Not specified',
    overallStrategy,
    corrections,
    lineItems: lineItemSummary,
    message: `Found ${corrections.length} suggested correction(s) for this denied claim. ${overallStrategy === 'appeal' ? 'I recommend filing an appeal.' : overallStrategy === 'correct_and_resubmit' ? 'I recommend correcting and resubmitting the claim.' : 'Review the corrections above and take action.'}`,
  };
}
