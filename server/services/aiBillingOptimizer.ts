import OpenAI from "openai";

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
  }>;
  totalUnits: number;
  estimatedAmount: number;
  optimizationNotes: string;
  complianceScore: number; // 0-100
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

  // Build the prompt
  const prompt = `You are a medical billing expert specializing in occupational/physical therapy billing. Your job is to recommend the optimal CPT code combination for a therapy session that:
1. Accurately reflects the services provided (medical necessity)
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

AVAILABLE CPT CODES:
${availableCptCodes.map(c => `- ${c.code}: ${c.description} (Rate: $${c.baseRate || '289'})`).join('\n')}

BILLING RULES TO FOLLOW:
1. Each CPT code represents a distinct type of service - don't bill the same code multiple times unless truly performed multiple separate times
2. Total units across all codes should not exceed ${insurancePreferences?.maxTotalUnitsPerVisit || totalAvailableUnits} units
3. Document must support medical necessity for each code billed
4. Use different codes that reflect the variety of interventions performed
5. Stay within insurance-specific limits

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
  "optimizationNotes": "Overall explanation of billing strategy",
  "complianceScore": 95
}

Focus on accuracy and compliance over maximizing revenue. Only recommend codes that are clearly supported by the documentation.`;

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

    // Map AI recommendations to our format with full details
    const lineItems = aiResult.lineItems.map((item: any) => {
      const cptCode = availableCptCodes.find(c => c.code === item.cptCode);
      return {
        cptCodeId: cptCode?.id || 0,
        cptCode: item.cptCode,
        description: cptCode?.description || '',
        units: item.units || 1,
        modifier: item.modifier || null,
        reasoning: item.reasoning || ''
      };
    }).filter((item: any) => item.cptCodeId > 0);

    // Calculate totals
    const totalUnits = lineItems.reduce((sum: number, item: any) => sum + item.units, 0);
    const estimatedAmount = lineItems.reduce((sum: number, item: any) => {
      const cptCode = availableCptCodes.find(c => c.id === item.cptCodeId);
      const rate = parseFloat(cptCode?.baseRate || '289');
      return sum + (rate * item.units);
    }, 0);

    return {
      lineItems,
      totalUnits,
      estimatedAmount,
      optimizationNotes: aiResult.optimizationNotes || '',
      complianceScore: aiResult.complianceScore || 85
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
        reasoning: "Default billing - AI optimization unavailable"
      }],
      totalUnits: Math.min(totalAvailableUnits, 2),
      estimatedAmount: parseFloat(defaultCode.baseRate || '289') * Math.min(totalAvailableUnits, 2),
      optimizationNotes: "Fallback billing applied - please review manually",
      complianceScore: 70
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
