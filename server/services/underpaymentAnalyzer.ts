/**
 * Underpayment Analyzer Service
 *
 * Analyzes CAS (Claim Adjustment Segment) adjustment reason codes from ERA/835
 * remittance data to determine:
 * - Whether an adjustment represents patient responsibility vs payer shortfall
 * - Whether an underpayment is worth disputing based on contracted rates
 * - Recommended actions for each type of adjustment
 *
 * Reference: X12 835 CAS segment group/reason code combinations
 */

// ==================== Types ====================

export interface AdjustmentAnalysis {
  /** Original adjustment code, e.g. "CO-45" */
  code: string;
  /** Group code: CO, PR, PI, OA, CR */
  groupCode: string;
  /** Reason code number */
  reasonCode: string;
  /** Human-readable description */
  description: string;
  /** Adjustment amount (positive = reduction from billed) */
  amount: number;
  /** Classification of this adjustment */
  category: 'patient_responsibility' | 'contractual' | 'payer_initiated' | 'other' | 'correction';
  /** Whether this adjustment is potentially disputable */
  disputable: boolean;
  /** Explanation of what this adjustment means in plain language */
  explanation: string;
  /** Recommended action */
  recommendedAction: string;
}

export interface UnderpaymentAssessment {
  /** The claim or line item being assessed */
  claimId?: number;
  cptCode?: string;
  /** Amounts */
  billedAmount: number;
  expectedReimbursement: number | null;
  paidAmount: number;
  /** Dollar amount of underpayment relative to expected reimbursement */
  underpaymentAmount: number;
  /** Whether this qualifies as an underpayment worth reviewing */
  isUnderpaid: boolean;
  /** Individual adjustment analyses */
  adjustmentAnalyses: AdjustmentAnalysis[];
  /** Summary of patient responsibility adjustments */
  patientResponsibilityTotal: number;
  /** Summary of contractual adjustments */
  contractualAdjustmentTotal: number;
  /** Summary of payer-initiated reductions */
  payerInitiatedTotal: number;
  /** Summary of other/unknown adjustments */
  otherAdjustmentTotal: number;
  /** Whether the underpayment is worth disputing after accounting for normal adjustments */
  worthDisputing: boolean;
  /** Overall recommendation */
  recommendation: string;
}

// ==================== Adjustment Reason Code Database ====================

/** Group code descriptions and classification */
const GROUP_CODE_INFO: Record<string, { description: string; category: AdjustmentAnalysis['category']; defaultDisputable: boolean }> = {
  'CO': { description: 'Contractual Obligations', category: 'contractual', defaultDisputable: false },
  'PR': { description: 'Patient Responsibility', category: 'patient_responsibility', defaultDisputable: false },
  'PI': { description: 'Payor Initiated Reductions', category: 'payer_initiated', defaultDisputable: true },
  'OA': { description: 'Other Adjustments', category: 'other', defaultDisputable: true },
  'CR': { description: 'Corrections/Reversals', category: 'correction', defaultDisputable: false },
};

/**
 * Detailed reason code analysis rules.
 * Each entry provides context-specific classification that may override the group default.
 */
const REASON_CODE_RULES: Record<string, {
  description: string;
  /** Override the group-level category if needed */
  categoryOverride?: AdjustmentAnalysis['category'];
  /** Override the group-level disputable flag */
  disputableOverride?: boolean;
  /** Plain language explanation */
  explanation: string;
  /** Recommended action */
  recommendedAction: string;
}> = {
  '1': {
    description: 'Deductible amount',
    explanation: 'This portion is the patient\'s annual deductible — they must pay this out-of-pocket before insurance covers services.',
    recommendedAction: 'Bill the patient for the deductible amount. This is not an underpayment by the insurer.',
  },
  '2': {
    description: 'Coinsurance amount',
    explanation: 'This is the patient\'s coinsurance share (e.g., 20% of the allowed amount). Standard cost-sharing per their plan.',
    recommendedAction: 'Bill the patient for the coinsurance amount. This is normal cost-sharing.',
  },
  '3': {
    description: 'Copayment amount',
    explanation: 'This is the patient\'s flat copay amount per their insurance plan.',
    recommendedAction: 'Collect the copay from the patient. This should have been collected at the time of service.',
  },
  '4': {
    description: 'Procedure code inconsistent with modifier',
    disputableOverride: true,
    explanation: 'The payer claims the procedure code doesn\'t match the modifier used. This may be a coding error or a payer adjudication mistake.',
    recommendedAction: 'Review the CPT code and modifier combination. If correct, dispute with documentation supporting the modifier use.',
  },
  '5': {
    description: 'Procedure code/bill type inconsistent with place of service',
    disputableOverride: true,
    explanation: 'The payer rejected based on place of service not matching the billed procedure. Check if the POS code was correct on the claim.',
    recommendedAction: 'Verify place of service code on the original claim. If correct, dispute with documentation of service location.',
  },
  '16': {
    description: 'Claim/service lacks information needed for adjudication',
    disputableOverride: true,
    explanation: 'The payer says information was missing from the claim. This could be a payer processing error if the information was actually included.',
    recommendedAction: 'Review the original claim for completeness. Resubmit with any missing information, or dispute if all information was provided.',
  },
  '18': {
    description: 'Duplicate claim/service',
    explanation: 'The payer identified this as a duplicate submission. Check if the claim was truly submitted twice.',
    recommendedAction: 'Verify whether this was a duplicate. If services were distinct, resubmit with modifier 59 and supporting documentation.',
  },
  '22': {
    description: 'Care may not be covered',
    disputableOverride: true,
    explanation: 'The payer is questioning whether the service is covered. This can often be overturned with proper clinical documentation.',
    recommendedAction: 'Review coverage terms and file an appeal with clinical documentation supporting medical necessity.',
  },
  '23': {
    description: 'Payment adjusted — charges covered under capitation agreement',
    explanation: 'This service is included under a capitation (per-member-per-month) payment arrangement. No additional fee-for-service payment is expected.',
    recommendedAction: 'Verify the capitation contract terms. If this CPT code should not be capitated, dispute with the contract reference.',
  },
  '29': {
    description: 'Time limit for filing has expired',
    explanation: 'The payer is denying because the claim was filed past the timely filing deadline.',
    recommendedAction: 'If you have proof of timely submission (clearinghouse confirmation), file a timely filing appeal immediately.',
  },
  '45': {
    description: 'Charge exceeds fee schedule/maximum allowable/contracted/legislated amount',
    explanation: 'The payer reduced the charge to their fee schedule or contracted rate. This is NORMAL if the paid amount matches your contracted rate. However, if the paid amount is BELOW your contracted rate, this is an underpayment worth disputing.',
    recommendedAction: 'Compare the paid amount against your contracted rate from the fee schedule. If paid below contracted rate, dispute citing the contract.',
  },
  '50': {
    description: 'Non-covered services',
    disputableOverride: true,
    explanation: 'The payer says this service is not covered under the patient\'s plan.',
    recommendedAction: 'Verify coverage and consider: alternative CPT codes, appeal with medical necessity documentation, or bill the patient if ABN was obtained.',
  },
  '96': {
    description: 'Non-covered charges',
    disputableOverride: true,
    explanation: 'Similar to code 50 — the payer is not covering these charges.',
    recommendedAction: 'Review plan coverage, consider alternative coding, or appeal with clinical justification.',
  },
  '97': {
    description: 'Payment adjusted — benefit for this service not provided',
    disputableOverride: true,
    explanation: 'The payer says this service type is not a covered benefit. This may be incorrect if the patient\'s plan does cover therapy.',
    recommendedAction: 'Verify the patient\'s actual benefit details. If therapy is covered, dispute with the benefit verification documentation.',
  },
  '109': {
    description: 'Claim not covered by this payer/plan',
    explanation: 'The payer says this claim doesn\'t belong to them.',
    recommendedAction: 'Verify the correct payer and member ID. Resubmit to the correct payer if a COB issue.',
  },
  '119': {
    description: 'Benefit maximum for this time period has been reached',
    explanation: 'The patient has used all their allowed visits or dollar amount for this benefit period.',
    recommendedAction: 'Verify visit counts and benefit limits. If incorrect, dispute. Otherwise, discuss out-of-pocket options with the patient.',
  },
  '197': {
    description: 'Precertification/authorization/notification absent',
    disputableOverride: true,
    explanation: 'The payer says prior authorization was not obtained for this service.',
    recommendedAction: 'If authorization was obtained, dispute with the auth number. If not, request retroactive authorization.',
  },
  '204': {
    description: 'Service not covered under patient benefit plan',
    disputableOverride: true,
    explanation: 'The payer says this specific service isn\'t covered under the patient\'s plan.',
    recommendedAction: 'Review plan benefits. If therapy IS covered, dispute with plan documentation. Consider alternative CPT codes if applicable.',
  },
  '253': {
    description: 'Sequestration — reduction in federal payment',
    disputableOverride: false,
    explanation: 'This is a mandatory 2% reduction applied to all Medicare fee-for-service claims under federal sequestration. This is standard and NOT disputable.',
    recommendedAction: 'No action needed. This is a standard 2% Medicare sequestration reduction applied to all claims.',
  },
};

// ==================== Analysis Functions ====================

/**
 * Analyze a single CAS adjustment code and return detailed analysis.
 */
export function analyzeAdjustment(
  groupCode: string,
  reasonCode: string,
  amount: number,
): AdjustmentAnalysis {
  const code = `${groupCode}-${reasonCode}`;
  const groupInfo = GROUP_CODE_INFO[groupCode] || {
    description: `Unknown group (${groupCode})`,
    category: 'other' as const,
    defaultDisputable: true,
  };

  const reasonRule = REASON_CODE_RULES[reasonCode];

  const category = reasonRule?.categoryOverride || groupInfo.category;
  const disputable = reasonRule?.disputableOverride ?? groupInfo.defaultDisputable;
  const description = reasonRule?.description || `Reason code ${reasonCode}`;
  const explanation = reasonRule?.explanation || `Adjustment under ${groupInfo.description} group with reason code ${reasonCode}.`;
  const recommendedAction = reasonRule?.recommendedAction || `Review this ${groupInfo.description.toLowerCase()} adjustment and determine if further action is needed.`;

  return {
    code,
    groupCode,
    reasonCode,
    description,
    amount,
    category,
    disputable,
    explanation,
    recommendedAction,
  };
}

/**
 * Analyze multiple adjustments from a remittance line item and produce
 * a comprehensive underpayment assessment.
 *
 * @param adjustments - Array of { code: "CO-45", ... } or { groupCode, reasonCode, amount }
 * @param billedAmount - Original billed amount
 * @param paidAmount - Amount actually paid by the payer
 * @param expectedReimbursement - Expected reimbursement from the fee schedule (nullable)
 * @param underpaymentThreshold - Dollar amount below which we don't flag as underpayment (default $5)
 */
export function assessUnderpayment(params: {
  adjustments: Array<{ groupCode?: string; reasonCode?: string; code?: string; amount: number }>;
  billedAmount: number;
  paidAmount: number;
  expectedReimbursement: number | null;
  claimId?: number;
  cptCode?: string;
  underpaymentThreshold?: number;
}): UnderpaymentAssessment {
  const {
    adjustments,
    billedAmount,
    paidAmount,
    expectedReimbursement,
    claimId,
    cptCode,
    underpaymentThreshold = 5,
  } = params;

  // Parse and analyze each adjustment
  const adjustmentAnalyses: AdjustmentAnalysis[] = adjustments.map((adj) => {
    let groupCode = adj.groupCode || '';
    let reasonCode = adj.reasonCode || '';

    // Parse from "CO-45" format if needed
    if (!groupCode && adj.code) {
      const parts = adj.code.split('-');
      groupCode = parts[0] || '';
      reasonCode = parts[1] || '';
    }

    return analyzeAdjustment(groupCode, reasonCode, adj.amount);
  });

  // Sum by category
  const patientResponsibilityTotal = adjustmentAnalyses
    .filter((a) => a.category === 'patient_responsibility')
    .reduce((sum, a) => sum + a.amount, 0);

  const contractualAdjustmentTotal = adjustmentAnalyses
    .filter((a) => a.category === 'contractual')
    .reduce((sum, a) => sum + a.amount, 0);

  const payerInitiatedTotal = adjustmentAnalyses
    .filter((a) => a.category === 'payer_initiated')
    .reduce((sum, a) => sum + a.amount, 0);

  const otherAdjustmentTotal = adjustmentAnalyses
    .filter((a) => a.category === 'other' || a.category === 'correction')
    .reduce((sum, a) => sum + a.amount, 0);

  // Determine underpayment
  let underpaymentAmount = 0;
  let isUnderpaid = false;

  if (expectedReimbursement !== null && expectedReimbursement > 0) {
    // Compare paid + patient responsibility against expected reimbursement
    // Patient responsibility is expected — only the payer's portion matters
    underpaymentAmount = expectedReimbursement - paidAmount - patientResponsibilityTotal;
    isUnderpaid = underpaymentAmount > underpaymentThreshold;
  }

  // Determine if worth disputing
  const hasDisputableAdjustments = adjustmentAnalyses.some((a) => a.disputable && a.amount > 0);
  const worthDisputing = isUnderpaid && (hasDisputableAdjustments || underpaymentAmount > underpaymentThreshold);

  // Build recommendation
  let recommendation: string;
  if (!isUnderpaid) {
    if (patientResponsibilityTotal > 0) {
      recommendation = `Payment is in line with expected reimbursement. Patient owes $${patientResponsibilityTotal.toFixed(2)} (deductible/coinsurance/copay). Send a patient statement for this amount.`;
    } else {
      recommendation = 'Payment matches expected reimbursement. No action needed.';
    }
  } else if (worthDisputing) {
    const disputableAmount = adjustmentAnalyses
      .filter((a) => a.disputable)
      .reduce((sum, a) => sum + a.amount, 0);
    recommendation = `Underpaid by $${underpaymentAmount.toFixed(2)} compared to contracted rate. $${disputableAmount.toFixed(2)} in potentially disputable adjustments found. Recommend filing an underpayment dispute with the payer.`;
  } else {
    recommendation = `Paid $${underpaymentAmount.toFixed(2)} below expected reimbursement, but adjustments appear to be standard contractual or sequestration reductions. Monitor for a pattern of underpayment from this payer.`;
  }

  return {
    claimId,
    cptCode,
    billedAmount,
    expectedReimbursement,
    paidAmount,
    underpaymentAmount: Math.max(0, underpaymentAmount),
    isUnderpaid,
    adjustmentAnalyses,
    patientResponsibilityTotal,
    contractualAdjustmentTotal,
    payerInitiatedTotal,
    otherAdjustmentTotal,
    worthDisputing,
    recommendation,
  };
}

/**
 * Parse adjustment reason codes from the remittance line item JSON format.
 * The DB stores them as [{ code: "CO-45", description: "..." }].
 */
export function parseStoredAdjustmentCodes(
  adjustmentReasonCodes: unknown,
): Array<{ groupCode: string; reasonCode: string; code: string; amount: number }> {
  if (!Array.isArray(adjustmentReasonCodes)) return [];

  return adjustmentReasonCodes.map((adj: any) => {
    const code = adj.code || '';
    const parts = code.split('-');
    return {
      code,
      groupCode: parts[0] || '',
      reasonCode: parts[1] || '',
      amount: parseFloat(adj.amount) || 0,
    };
  });
}
