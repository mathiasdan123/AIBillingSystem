import Anthropic from "@anthropic-ai/sdk";
import { storage } from "../storage";
import {
  OT_INTERVENTION_CATEGORIES,
  PAYERS_REQUIRING_DIFFERENT_CODES,
  getOptimalCodeForIntervention,
  getPayerRatesSummary
} from "./reimbursementOptimizer";

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not set - AI billing accuracy review disabled');
    return null;
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

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
  accuracyNotes: string;
  /** Codes the reviewer considered but did NOT recommend because the
   *  documentation didn't support them (Blanche Rule 5: suppress rather than
   *  bill-with-warning). Surfaced for QA and provider visibility. */
  suppressedCodes: Array<{ cptCode: string; reason: string }>;
  complianceScore: number; // 0-100
  reimbursementOptimized: boolean; // indicates if reimbursement data was used
}

export async function reviewBillingCodeAccuracy(
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

  // Whether payer rate data exists for this insurer. NOTE: we deliberately do
  // NOT feed payer rates into the code-SELECTION prompt — surfacing "here are
  // the higher-paying codes" while asking the model to pick a code is exactly
  // the reimbursement-steering behavior CLAUDE.md forbids and the accuracy
  // reframing removes. Rates are still used AFTER selection to compute the
  // dollar estimate (see the rate lookup below). This flag only records that
  // rate data was available for that estimate.
  let reimbursementContext = '';
  let reimbursementOptimized = false;
  try {
    const payerRates = await getPayerRatesSummary(insuranceName);
    if (payerRates.rates.length > 0) {
      reimbursementOptimized = true;
      // Intentionally left blank — no rate steering in the selection prompt.
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
  const prompt = `You are a medical billing accuracy reviewer specializing in occupational and speech therapy. Your job is to recommend the CPT code(s) that most ACCURATELY reflect the skilled services the documentation actually supports. You are NOT optimizing or maximizing reimbursement — you are ensuring each code is defensible against audit and denial. The treating provider makes the final coding decision.

CORE PRINCIPLES (in priority order):
1. MEDICAL NECESSITY & DOCUMENTATION SUPPORT IS PRIMARY. Only recommend a code the documentation clearly supports with skilled, functional, measurable clinical content.
2. If the documentation does NOT support a code, DO NOT recommend it. Suppressing an unsupported code is safer than billing it — unsupported CPT carry-through is where denials and audits happen. Note the suppression in suppressedCodes (see output format) rather than forcing the code through.
3. NEVER choose a code because it reimburses more. When two codes are each clinically valid for the documented service, pick the one whose description best matches the PRIMARY SKILLED OBJECTIVE — not the higher-paying one.
4. Map by skilled outcome, not by activity label (see SENSORY-INTEGRATION GUIDANCE below).

SENSORY-INTEGRATION & FUNCTIONAL MAPPING (critical for OT/ST reimbursement):
Payers reimburse poorly for documentation framed primarily as "sensory integration", "sensory play", "sensory diet", or "regulation activities" — those read as developmental/non-specific and weakly tied to medical necessity. The treatment is appropriate; the DOCUMENTATION must connect it to a skilled, functional, neuromuscular/motor or ADL objective. Map to CPT by the PRIMARY SKILLED OUTCOME being addressed:
- Vestibular-proprioceptive activities targeting postural control, balance, bilateral coordination, motor planning, praxis, or body awareness → 97112 (neuromuscular re-education).
- Sensory-based obstacle courses / activities targeting functional participation, transitions, fine motor tasks, or play/ADL skills → 97530 (therapeutic activities).
- Do NOT default to a "sensory integration" code (e.g. 97533) unless the documentation pairs the sensory work with clear functional deficits, measurable assistance levels, and skilled therapeutic analysis. If it doesn't, prefer the functional/neuromuscular code that the skilled objective supports, or suppress.
Use payer-aligned skilled vocabulary in your reasoning: skilled clinical analysis, clinical reasoning, task grading/modification, dynamic assessment, neuromuscular re-education, cueing hierarchy, compensatory strategies, safety/judgment, therapist-directed adaptation, measurable functional impact. Avoid generic phrases like "provided skilled support", "therapeutic engagement", "facilitated participation".

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
1. DOCUMENTATION SUPPORT IS PRIMARY - only recommend codes the documentation clearly supports with skilled, functional clinical content.
2. When multiple codes could each accurately describe an intervention, choose the one whose description best matches the PRIMARY SKILLED OBJECTIVE. Do NOT choose based on reimbursement.
3. If a code is NOT supported by the documentation, leave it OUT of lineItems and record it in suppressedCodes with the reason. Do not force a code through with a warning.
4. Total units across all codes should not exceed ${insurancePreferences?.maxTotalUnitsPerVisit || totalAvailableUnits} units.
5. ${requiresDifferentCodes ? 'Use DIFFERENT codes for each 15-minute unit (payer requirement)' : 'May bill multiple units of same code if clinically appropriate'}.
6. Stay within insurance-specific limits.

Based on the session documentation, recommend ONLY the codes the documentation supports. Return your response as JSON:
{
  "lineItems": [
    {
      "cptCode": "97110",
      "units": 1,
      "modifier": null,
      "reasoning": "Skilled-objective explanation tying this code to the documented intervention (functional/neuromuscular outcome), not to reimbursement"
    }
  ],
  "suppressedCodes": [
    {
      "cptCode": "97533",
      "reason": "Considered but documentation lacked functional deficits / measurable assistance / skilled analysis to support a sensory-integration code"
    }
  ],
  "accuracyNotes": "Overall explanation of how each recommended code maps to the documented skilled objective, and why any considered codes were suppressed",
  "complianceScore": 95
}

Recommend the most ACCURATE, defensible coding. If the documentation is thin, recommend fewer codes (or none) and explain in suppressedCodes — never manufacture support for a code. The treating provider reviews and approves all suggestions.`;

  try {
    const client = getAnthropic();
    if (!client) {
      throw new Error("Anthropic API key not configured");
    }
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      temperature: 0.3,
      // See aiDenialPredictor for the same caching pattern + caveat: the
      // marker is here for when the prompt grows; today it sits under the
      // 1024-token caching minimum and will be a no-op until that changes.
      system: [
        {
          type: "text",
          text: "You are a medical billing accuracy reviewer. Recommend only coding that the documentation defensibly supports; suppress unsupported codes rather than forcing them through. Never select a code because it pays more. The treating provider makes the final coding decision. Return ONLY a valid JSON object with no markdown fencing or commentary.",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const content = textBlock?.text;
    if (!content) {
      throw new Error("No response from AI");
    }

    const jsonMatch =
      content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content;
    const aiResult = JSON.parse(jsonStr);

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

    // Rule 5 (Blanche): suppress unsupported codes rather than billing with a
    // warning. Capture what the reviewer dropped, and log it internally for QA
    // so we keep visibility into removed candidates without risking submission.
    const suppressedCodes: Array<{ cptCode: string; reason: string }> = Array.isArray(aiResult.suppressedCodes)
      ? aiResult.suppressedCodes
          .filter((s: any) => s && typeof s.cptCode === 'string')
          .map((s: any) => ({ cptCode: s.cptCode, reason: typeof s.reason === 'string' ? s.reason : 'insufficient documentation support' }))
      : [];
    if (suppressedCodes.length > 0) {
      console.log(
        `[billing-accuracy] suppressed ${suppressedCodes.length} unsupported code(s): ` +
          suppressedCodes.map((s) => `${s.cptCode} (${s.reason})`).join('; '),
      );
    }

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
      accuracyNotes: aiResult.accuracyNotes || '',
      suppressedCodes,
      complianceScore: aiResult.complianceScore || 85,
      reimbursementOptimized
    };

  } catch (error) {
    console.error("AI billing accuracy review error:", error);

    // Fallback: return simple single-code billing
    const defaultCode = availableCptCodes.find(c => c.code === '97530') || availableCptCodes[0];
    return {
      lineItems: [{
        cptCodeId: defaultCode.id,
        cptCode: defaultCode.code,
        description: defaultCode.description,
        units: Math.min(totalAvailableUnits, 2),
        reasoning: "Default billing - AI accuracy review unavailable",
        reimbursementRate: undefined
      }],
      totalUnits: Math.min(totalAvailableUnits, 2),
      estimatedAmount: parseFloat(defaultCode.baseRate || '289') * Math.min(totalAvailableUnits, 2),
      accuracyNotes: "Fallback billing applied - please review manually",
      suppressedCodes: [],
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
