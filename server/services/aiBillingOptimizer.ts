import OpenAI from "openai";
import { storage } from "../storage";
import {
  OT_INTERVENTION_CATEGORIES,
  PAYERS_REQUIRING_DIFFERENT_CODES,
  getOptimalCodeForIntervention,
  getPayerRatesSummary
} from "./reimbursementOptimizer";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface SessionDetails {
  duration: number; // in minutes
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  interventions?: string[];
}

interface CptCode {
  id: number;
  code: string;
  description: string;
  category?: string;
  baseRate?: string;
}

interface InsuranceRule {
  cptCodeId?: number;
  maxUnitsPerVisit?: number;
  maxUnitsPerDay?: number;
  requiresModifier?: string;
  cannotBillWith?: number[];
}

interface InsurancePreferences {
  maxTotalUnitsPerVisit?: number;
  preferredCodeCombinations?: string[][];
  avoidCodeCombinations?: string[][];
  billingGuidelines?: string;
  reimbursementTier?: string;
}

interface BillingRecommendation {
  lineItems: Array<{
    cptCodeId: number;
    cptCode: string;
    description: string;
    units: number;
    modifier?: string;
    reasoning: string;
    reimbursementRate?: number;
  }>;
  totalUnits: number;
  estimatedAmount: number;
  optimizationNotes: string;
  complianceScore: number; // 0-100
  reimbursementOptimized: boolean; // indicates if reimbursement data was used
}

export async function optimizeBillingCodes(
  sessionDetails: SessionDetails,
  availableCptCodes: CptCode[],
  insuranceName: string,
  insuranceRules: InsuranceRule[],
  insurancePreferences: InsurancePreferences | null,
  icd10Code?: { code: string; description: string }
): Promise<BillingRecommendation> {

  // Calculate available units based on session duration (15-min increments)
  const totalAvailableUnits = Math.floor(sessionDetails.duration / 15);

  // Build context about insurance rules
  const rulesContext = buildRulesContext(insuranceRules, insurancePreferences, insuranceName);

  // Get reimbursement data for this payer to guide code selection
  let reimbursementContext = '';
  let reimbursementOptimized = false;
  try {
    const payerRates = await getPayerRatesSummary(insuranceName);
    if (payerRates.rates.length > 0) {
      reimbursementOptimized = true;
      reimbursementContext = `\nREIMBURSEMENT DATA FOR ${insuranceName.toUpperCase()}:
${payerRates.rates.slice(0, 10).map(r => `- ${r.cptCode}: $${r.inNetworkRate?.toFixed(2)} (Rank #${r.rank})`).join('\n')}
Average rate: $${payerRates.averageRate.toFixed(2)} per unit
OPTIMIZATION TIP: When clinically appropriate, favor higher-reimbursing codes.`;
    }
  } catch (error) {
    console.log("No reimbursement data available for", insuranceName);
  }

  // Check if payer requires different codes per 15-minute unit
  const requiresDifferentCodes = PAYERS_REQUIRING_DIFFERENT_CODES.some(
    p => insuranceName.toLowerCase().includes(p.toLowerCase())
  );
  const unitRuleContext = requiresDifferentCodes
    ? `\nIMPORTANT: ${insuranceName} typically requires DIFFERENT codes for each 15-minute unit. Avoid billing multiple units of the same code - instead distribute across different applicable codes.`
    : '';

  // Build code equivalency hints for the AI
  const equivalencyHints = Object.entries(OT_INTERVENTION_CATEGORIES)
    .map(([category, { codes, description }]) =>
      `- ${category.replace(/_/g, ' ')}: ${codes.join(' or ')} - ${description}`
    ).join('\n');

  // Build the prompt
  const prompt = `You are a medical billing expert specializing in occupational/physical therapy billing. Your job is to recommend the optimal CPT code combination for a therapy session that:
1. Accurately reflects the services provided (medical necessity is PRIMARY)
2. Maximizes appropriate reimbursement within compliance rules
3. Follows insurance-specific billing guidelines

SESSION DETAILS:
- Duration: ${sessionDetails.duration} minutes (${totalAvailableUnits} billable 15-minute units available)
- Subjective: ${sessionDetails.subjective || 'Not provided'}
- Objective: ${sessionDetails.objective || 'Not provided'}
- Assessment: ${sessionDetails.assessment || 'Not provided'}
- Plan: ${sessionDetails.plan || 'Not provided'}
${sessionDetails.interventions?.length ? `- Interventions: ${sessionDetails.interventions.join(', ')}` : ''}
${icd10Code ? `- Diagnosis: ${icd10Code.code} - ${icd10Code.description}` : ''}

INSURANCE: ${insuranceName}
${rulesContext}
${reimbursementContext}
${unitRuleContext}

CODE EQUIVALENCIES (same intervention can often be coded multiple ways):
${equivalencyHints}

AVAILABLE CPT CODES:
${availableCptCodes.map(c => `- ${c.code}: ${c.description} (Rate: $${c.baseRate || '289'})`).join('\n')}

BILLING RULES TO FOLLOW:
1. CLINICAL ACCURACY IS PRIMARY - only use codes that accurately describe documented services
2. When multiple codes could accurately describe an intervention, prefer higher-reimbursing codes
3. Total units across all codes should not exceed ${insurancePreferences?.maxTotalUnitsPerVisit || totalAvailableUnits} units
4. Document must support medical necessity for each code billed
5. ${requiresDifferentCodes ? 'Use DIFFERENT codes for each 15-minute unit (payer requirement)' : 'May bill multiple units of same code if clinically appropriate'}
6. Stay within insurance-specific limits

Based on the session documentation, recommend the optimal billing codes. Return your response as JSON:
{
  "lineItems": [
    {
      "cptCode": "97110",
      "units": 1,
      "modifier": null,
      "reasoning": "Brief explanation of why this code applies"
    }
  ],
  "optimizationNotes": "Overall explanation of billing strategy including any reimbursement optimization applied",
  "complianceScore": 95
}

Focus on accuracy and compliance. When multiple codes are clinically valid for the documented service, choose the one that reimburses better.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a medical billing compliance expert. Always recommend billing that is accurate, defensible, and follows payer guidelines. Return only valid JSON."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    const aiResult = JSON.parse(content);

    // Map AI recommendations to our format with full details and actual reimbursement rates
    const lineItemsPromises = aiResult.lineItems.map(async (item: any) => {
      const cptCode = availableCptCodes.find(c => c.code === item.cptCode);

      // Get actual reimbursement rate if available
      let actualRate: number | undefined;
      try {
        const insuranceRate = await storage.getInsuranceRateByCode(insuranceName, item.cptCode);
        if (insuranceRate?.inNetworkRate) {
          actualRate = parseFloat(insuranceRate.inNetworkRate.toString());
        }
      } catch (e) {
        // Rate not available
      }

      return {
        cptCodeId: cptCode?.id || 0,
        cptCode: item.cptCode,
        description: cptCode?.description || '',
        units: item.units || 1,
        modifier: item.modifier || null,
        reasoning: item.reasoning || '',
        reimbursementRate: actualRate
      };
    });

    const lineItems = (await Promise.all(lineItemsPromises)).filter((item: any) => item.cptCodeId > 0);

    // Calculate totals using actual reimbursement rates when available
    const totalUnits = lineItems.reduce((sum: number, item: any) => sum + item.units, 0);
    const estimatedAmount = lineItems.reduce((sum: number, item: any) => {
      // Use actual reimbursement rate if available, otherwise use base rate
      const rate = item.reimbursementRate || parseFloat(availableCptCodes.find(c => c.id === item.cptCodeId)?.baseRate || '289');
      return sum + (rate * item.units);
    }, 0);

    return {
      lineItems,
      totalUnits,
      estimatedAmount,
      optimizationNotes: aiResult.optimizationNotes || '',
      complianceScore: aiResult.complianceScore || 85,
      reimbursementOptimized
    };

  } catch (error) {
    console.error("AI billing optimization error:", error);

    // Fallback: return simple single-code billing
    const defaultCode = availableCptCodes.find(c => c.code === '97530') || availableCptCodes[0];
    return {
      lineItems: [{
        cptCodeId: defaultCode.id,
        cptCode: defaultCode.code,
        description: defaultCode.description,
        units: Math.min(totalAvailableUnits, 2),
        reasoning: "Default billing - AI optimization unavailable",
        reimbursementRate: undefined
      }],
      totalUnits: Math.min(totalAvailableUnits, 2),
      estimatedAmount: parseFloat(defaultCode.baseRate || '289') * Math.min(totalAvailableUnits, 2),
      optimizationNotes: "Fallback billing applied - please review manually",
      complianceScore: 70,
      reimbursementOptimized: false
    };
  }
}

function buildRulesContext(
  rules: InsuranceRule[],
  preferences: InsurancePreferences | null,
  insuranceName: string
): string {
  let context = '';

  if (preferences) {
    if (preferences.maxTotalUnitsPerVisit) {
      context += `\nMAX UNITS PER VISIT: ${preferences.maxTotalUnitsPerVisit}`;
    }
    if (preferences.billingGuidelines) {
      context += `\nBILLING GUIDELINES: ${preferences.billingGuidelines}`;
    }
    if (preferences.reimbursementTier) {
      context += `\nREIMBURSEMENT TIER: ${preferences.reimbursementTier}`;
    }
  }

  if (rules.length > 0) {
    context += '\nCODE-SPECIFIC RULES:';
    rules.forEach(rule => {
      if (rule.maxUnitsPerVisit) {
        context += `\n- Max ${rule.maxUnitsPerVisit} unit(s) per code per visit`;
      }
      if (rule.requiresModifier) {
        context += `\n- Requires modifier: ${rule.requiresModifier}`;
      }
    });
  }

  // Add common insurance-specific knowledge
  const insuranceLower = insuranceName.toLowerCase();
  if (insuranceLower.includes('medicare')) {
    context += '\nMEDICARE RULES: Strict medical necessity requirements. 8-minute rule applies. Cannot bill evaluation and treatment same day without modifier.';
  } else if (insuranceLower.includes('medicaid')) {
    context += '\nMEDICAID RULES: Prior authorization often required. Limited units per day/week. Strict documentation requirements.';
  } else if (insuranceLower.includes('blue cross') || insuranceLower.includes('bcbs')) {
    context += '\nBCBS RULES: Generally allows multiple codes per visit. Good reimbursement rates. Requires clear documentation of distinct services.';
  } else if (insuranceLower.includes('aetna')) {
    context += '\nAETNA RULES: May limit to 1 unit per code per visit for some plans. Prior auth needed for extended treatment.';
  } else if (insuranceLower.includes('united') || insuranceLower.includes('uhc')) {
    context += '\nUNITED HEALTHCARE RULES: Strict utilization management. May require modifier 59 for multiple procedures. Watch for bundling edits.';
  } else if (insuranceLower.includes('cigna')) {
    context += '\nCIGNA RULES: Moderate reimbursement. Requires clear differentiation between therapeutic activities.';
  }

  return context || '\nNo specific insurance rules configured - use standard billing practices.';
}

export async function getInsuranceBillingRules(
  storage: any,
  insuranceId: number | null
): Promise<{ rules: InsuranceRule[]; preferences: InsurancePreferences | null }> {
  if (!insuranceId) {
    return { rules: [], preferences: null };
  }

  try {
    // These would be fetched from database in production
    // For now, return empty - rules will be built from insurance name
    return { rules: [], preferences: null };
  } catch (error) {
    console.error("Error fetching insurance rules:", error);
    return { rules: [], preferences: null };
  }
}
