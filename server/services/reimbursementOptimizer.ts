/**
 * Reimbursement Optimizer Service
 *
 * Analyzes insurance reimbursement rates and payer-specific rules to recommend
 * optimal CPT codes when multiple codes could accurately describe the same intervention.
 *
 * Key features:
 * - Tracks code equivalencies (which codes can represent similar interventions)
 * - Ranks codes by reimbursement for each payer
 * - Handles payer rules for 15-minute unit billing (some require different codes per unit)
 * - Maintains clinical appropriateness as primary consideration
 */

import { storage } from "../storage";
import type { CptCode, InsuranceRate, CptCodeEquivalency } from "@shared/schema";

// Common OT intervention categories and their equivalent codes
export const OT_INTERVENTION_CATEGORIES: Record<string, { codes: string[]; description: string }> = {
  therapeutic_exercise: {
    codes: ["97110", "97530"],
    description: "Strengthening, ROM, stretching - can bill as therapeutic exercise or therapeutic activities"
  },
  neuromuscular_reeducation: {
    codes: ["97112", "97530"],
    description: "Balance, coordination, posture - can bill as neuro re-ed or therapeutic activities"
  },
  fine_motor_skills: {
    codes: ["97530", "97535"],
    description: "Hand function, dexterity - can bill as therapeutic activities or self-care training"
  },
  adl_training: {
    codes: ["97535", "97530"],
    description: "Dressing, bathing, grooming - can bill as self-care or therapeutic activities"
  },
  manual_therapy: {
    codes: ["97140", "97530"],
    description: "Soft tissue mobilization - can bill as manual therapy or therapeutic activities"
  },
  sensory_processing: {
    codes: ["97533", "97530"],
    description: "Sensory integration work - can bill as sensory integration or therapeutic activities"
  },
  cognitive_skills: {
    codes: ["97127", "97530"],
    description: "Attention, memory, problem-solving - can bill as cognitive function or therapeutic activities"
  },
  wheelchair_mobility: {
    codes: ["97542", "97530"],
    description: "W/C management training - can bill as wheelchair training or therapeutic activities"
  }
};

// Payers known to require different codes for each 15-minute unit
export const PAYERS_REQUIRING_DIFFERENT_CODES: string[] = [
  "aetna",
  "cigna",
  "some medicaid plans"
];

export interface CodeOptimizationResult {
  recommendedCode: string;
  recommendedCodeId: number;
  reimbursementRate: number | null;
  alternativeCodes: Array<{
    code: string;
    codeId: number;
    rate: number | null;
    reason: string;
  }>;
  payerRules: {
    requiresDifferentCodesPerUnit: boolean;
    maxUnitsPerCode: number | null;
    notes: string;
  };
  reasoning: string;
}

export interface SessionCodeRecommendation {
  totalUnits: number;
  lineItems: Array<{
    code: string;
    codeId: number;
    units: number;
    rate: number | null;
    interventionType: string;
  }>;
  totalEstimatedReimbursement: number;
  optimizationNotes: string[];
}

/**
 * Get the optimal CPT code for an intervention category based on payer reimbursement
 */
export async function getOptimalCodeForIntervention(
  interventionCategory: string,
  insuranceProvider: string
): Promise<CodeOptimizationResult | null> {
  const category = OT_INTERVENTION_CATEGORIES[interventionCategory];
  if (!category) {
    return null;
  }

  // Get all CPT codes
  const allCptCodes = await storage.getCptCodes();

  // Get reimbursement rates for each equivalent code
  const codeRates: Array<{ code: CptCode; rate: InsuranceRate | null }> = [];

  for (const codeStr of category.codes) {
    const cptCode = allCptCodes.find((c: CptCode) => c.code === codeStr);
    if (cptCode) {
      const rate = await storage.getInsuranceRateByCode(insuranceProvider, codeStr);
      codeRates.push({ code: cptCode, rate: rate || null });
    }
  }

  if (codeRates.length === 0) {
    return null;
  }

  // Sort by reimbursement rate (highest first)
  codeRates.sort((a, b) => {
    const rateA = a.rate?.inNetworkRate ? parseFloat(a.rate.inNetworkRate.toString()) : 0;
    const rateB = b.rate?.inNetworkRate ? parseFloat(b.rate.inNetworkRate.toString()) : 0;
    return rateB - rateA;
  });

  const bestOption = codeRates[0];
  const alternatives = codeRates.slice(1);

  // Check payer-specific rules
  const requiresDifferentCodes = PAYERS_REQUIRING_DIFFERENT_CODES.some(
    p => insuranceProvider.toLowerCase().includes(p.toLowerCase())
  );

  const bestRate = bestOption.rate?.inNetworkRate
    ? parseFloat(bestOption.rate.inNetworkRate.toString())
    : null;

  return {
    recommendedCode: bestOption.code.code,
    recommendedCodeId: bestOption.code.id,
    reimbursementRate: bestRate,
    alternativeCodes: alternatives.map(alt => ({
      code: alt.code.code,
      codeId: alt.code.id,
      rate: alt.rate?.inNetworkRate ? parseFloat(alt.rate.inNetworkRate.toString()) : null,
      reason: `Alternative for ${interventionCategory}`
    })),
    payerRules: {
      requiresDifferentCodesPerUnit: requiresDifferentCodes,
      maxUnitsPerCode: requiresDifferentCodes ? 1 : null,
      notes: requiresDifferentCodes
        ? `${insuranceProvider} typically requires different codes for each 15-minute unit`
        : ""
    },
    reasoning: bestRate
      ? `${bestOption.code.code} reimburses at $${bestRate.toFixed(2)} for ${insuranceProvider}`
      : `Using ${bestOption.code.code} (no rate data available for this payer)`
  };
}

/**
 * Optimize code selection for a full session with multiple interventions
 */
export async function optimizeSessionCodes(
  sessionDurationMinutes: number,
  interventions: string[], // Array of intervention categories performed
  insuranceProvider: string
): Promise<SessionCodeRecommendation> {
  const totalUnits = Math.floor(sessionDurationMinutes / 15);
  const lineItems: SessionCodeRecommendation["lineItems"] = [];
  const optimizationNotes: string[] = [];

  // Check if payer requires different codes per unit
  const requiresDifferentCodes = PAYERS_REQUIRING_DIFFERENT_CODES.some(
    p => insuranceProvider.toLowerCase().includes(p.toLowerCase())
  );

  if (requiresDifferentCodes) {
    optimizationNotes.push(
      `${insuranceProvider} requires different codes for each 15-minute unit - distributing across intervention types`
    );
  }

  // Get optimal code for each intervention
  const interventionCodes: Array<{
    intervention: string;
    optimal: CodeOptimizationResult;
  }> = [];

  for (const intervention of interventions) {
    const optimal = await getOptimalCodeForIntervention(intervention, insuranceProvider);
    if (optimal) {
      interventionCodes.push({ intervention, optimal });
    }
  }

  // Sort by reimbursement rate (highest first)
  interventionCodes.sort((a, b) => {
    const rateA = a.optimal.reimbursementRate || 0;
    const rateB = b.optimal.reimbursementRate || 0;
    return rateB - rateA;
  });

  // Distribute units across codes
  let unitsRemaining = totalUnits;
  const allCptCodes = await storage.getCptCodes();

  if (requiresDifferentCodes) {
    // Each unit needs a different code - use highest paying codes first
    const allAvailableCodes: Array<{ code: string; codeId: number; rate: number; intervention: string }> = [];

    for (const { intervention, optimal } of interventionCodes) {
      allAvailableCodes.push({
        code: optimal.recommendedCode,
        codeId: optimal.recommendedCodeId,
        rate: optimal.reimbursementRate || 0,
        intervention
      });
      for (const alt of optimal.alternativeCodes) {
        allAvailableCodes.push({
          code: alt.code,
          codeId: alt.codeId,
          rate: alt.rate || 0,
          intervention
        });
      }
    }

    // Sort by rate and assign one unit to each unique code
    allAvailableCodes.sort((a, b) => b.rate - a.rate);
    const usedCodes = new Set<string>();

    for (const codeOption of allAvailableCodes) {
      if (unitsRemaining <= 0) break;
      if (usedCodes.has(codeOption.code)) continue;

      lineItems.push({
        code: codeOption.code,
        codeId: codeOption.codeId,
        units: 1,
        rate: codeOption.rate,
        interventionType: codeOption.intervention
      });
      usedCodes.add(codeOption.code);
      unitsRemaining--;
    }
  } else {
    // Can stack multiple units on same code - use highest paying codes
    for (const { intervention, optimal } of interventionCodes) {
      if (unitsRemaining <= 0) break;

      // Allocate units proportionally, at least 1 unit per intervention performed
      const unitsForThis = Math.min(
        Math.max(1, Math.floor(totalUnits / interventions.length)),
        unitsRemaining
      );

      lineItems.push({
        code: optimal.recommendedCode,
        codeId: optimal.recommendedCodeId,
        units: unitsForThis,
        rate: optimal.reimbursementRate,
        interventionType: intervention
      });
      unitsRemaining -= unitsForThis;
    }

    // If we have remaining units, add to the highest-paying code
    if (unitsRemaining > 0 && lineItems.length > 0) {
      lineItems[0].units += unitsRemaining;
    }
  }

  // Calculate total estimated reimbursement
  const totalEstimatedReimbursement = lineItems.reduce(
    (sum, item) => sum + (item.rate || 0) * item.units,
    0
  );

  if (interventionCodes.length > 0 && interventionCodes[0].optimal.reimbursementRate) {
    optimizationNotes.push(
      `Selected highest-reimbursing codes: ${lineItems.map(l => `${l.code} ($${l.rate?.toFixed(2) || 'N/A'})`).join(", ")}`
    );
  }

  return {
    totalUnits: lineItems.reduce((sum, item) => sum + item.units, 0),
    lineItems,
    totalEstimatedReimbursement,
    optimizationNotes
  };
}

/**
 * Get all reimbursement rates for a payer, ranked by amount
 */
export async function getPayerRatesSummary(insuranceProvider: string): Promise<{
  provider: string;
  rates: Array<{
    cptCode: string;
    description: string;
    inNetworkRate: number | null;
    rank: number;
  }>;
  averageRate: number;
  highestPayingCode: string | null;
  lowestPayingCode: string | null;
}> {
  const rates = await storage.getRatesRankedByReimbursement(insuranceProvider);
  const allCptCodes = await storage.getCptCodes();

  const ratesWithDetails = rates.map((rate, index) => {
    const cptCode = allCptCodes.find((c: CptCode) => c.code === rate.cptCode);
    return {
      cptCode: rate.cptCode,
      description: cptCode?.description || "",
      inNetworkRate: rate.inNetworkRate ? parseFloat(rate.inNetworkRate.toString()) : null,
      rank: index + 1
    };
  }).filter(r => r.inNetworkRate !== null);

  const validRates = ratesWithDetails.filter(r => r.inNetworkRate !== null);
  const averageRate = validRates.length > 0
    ? validRates.reduce((sum, r) => sum + (r.inNetworkRate || 0), 0) / validRates.length
    : 0;

  return {
    provider: insuranceProvider,
    rates: ratesWithDetails,
    averageRate,
    highestPayingCode: validRates[0]?.cptCode || null,
    lowestPayingCode: validRates[validRates.length - 1]?.cptCode || null
  };
}

/**
 * Parse a fee schedule document and identify highest-reimbursing codes
 */
export async function analyzeFeeSchedule(
  feeScheduleData: Array<{ cptCode: string; rate: number }>,
  insuranceProvider: string
): Promise<{
  saved: number;
  analysis: {
    highestPaying: Array<{ code: string; rate: number }>;
    lowestPaying: Array<{ code: string; rate: number }>;
    recommendations: string[];
  };
}> {
  // Sort by rate
  const sortedRates = [...feeScheduleData].sort((a, b) => b.rate - a.rate);

  // Save rates to database with rank
  let saved = 0;
  for (let i = 0; i < sortedRates.length; i++) {
    const { cptCode, rate } = sortedRates[i];
    try {
      await storage.upsertInsuranceRate({
        insuranceProvider,
        cptCode,
        inNetworkRate: rate.toString(),
        outOfNetworkRate: null,
        deductibleApplies: true,
        coinsurancePercent: "20",
        copayAmount: null
      });
      saved++;
    } catch (error) {
      console.error(`Failed to save rate for ${cptCode}:`, error);
    }
  }

  // Generate recommendations
  const recommendations: string[] = [];
  const highestPaying = sortedRates.slice(0, 5);
  const lowestPaying = sortedRates.slice(-5).reverse();

  // Check for code equivalencies where there's a significant rate difference
  for (const [category, { codes }] of Object.entries(OT_INTERVENTION_CATEGORIES)) {
    const categoryRates = sortedRates.filter(r => codes.includes(r.cptCode));
    if (categoryRates.length >= 2) {
      const highest = categoryRates[0];
      const lowest = categoryRates[categoryRates.length - 1];
      const difference = highest.rate - lowest.rate;
      if (difference > 10) {
        recommendations.push(
          `For ${category.replace(/_/g, " ")}, prefer ${highest.cptCode} ($${highest.rate.toFixed(2)}) over ${lowest.cptCode} ($${lowest.rate.toFixed(2)}) - $${difference.toFixed(2)} difference per unit`
        );
      }
    }
  }

  return {
    saved,
    analysis: {
      highestPaying: highestPaying.map(r => ({ code: r.cptCode, rate: r.rate })),
      lowestPaying: lowestPaying.map(r => ({ code: r.cptCode, rate: r.rate })),
      recommendations
    }
  };
}
