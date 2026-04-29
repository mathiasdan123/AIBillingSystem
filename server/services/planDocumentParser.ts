/**
 * Plan Document Parser Service
 *
 * Parses insurance plan documents (SBC, EOB, plan contracts) using AI
 * to extract OON benefit details for accurate reimbursement predictions.
 *
 * Similar to Sheer Health's approach of reading actual plan documents
 * rather than relying on estimates.
 */

import Anthropic from '@anthropic-ai/sdk';
import { InsertPatientPlanBenefits } from '../../shared/schema';

// Lazy initialize Anthropic client
let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not set - plan document parsing AI disabled');
    return null;
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

// Shared helper: call Claude with a text prompt and parse JSON out of the response.
async function callClaudeForJson(
  systemPrompt: string,
  userPrompt: string
): Promise<any> {
  const client = getAnthropic();
  if (!client) {
    throw new Error('Anthropic API key not configured');
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    temperature: 0.1,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text'
  );
  const content = textBlock?.text;
  if (!content) {
    throw new Error('No response from Claude');
  }

  const jsonMatch =
    content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not extract JSON from Claude response');
  }
  const jsonStr = jsonMatch[1] || jsonMatch[0];
  return JSON.parse(jsonStr);
}

export interface ParsedBenefits {
  // Plan identification
  planName?: string;
  planType?: 'PPO' | 'HMO' | 'EPO' | 'POS' | 'HDHP' | 'Indemnity' | string;
  insuranceProvider?: string;
  groupNumber?: string;
  policyNumber?: string;
  effectiveDate?: string;
  terminationDate?: string;

  // OON Benefits
  oonDeductibleIndividual?: number;
  oonDeductibleFamily?: number;
  oonCoinsurancePercent?: number; // What patient pays (e.g., 40)
  oonOutOfPocketMax?: number;

  // Accumulators (Tier A #1 — extracted from EOBs, stored on the patient)
  // The "deductible already met" argument is one of the strongest denial-fight
  // tools. EOBs ARE the source of truth for accumulator status.
  oonDeductibleMet?: number; // YTD individual OON deductible used
  oonOutOfPocketMet?: number; // YTD OON out-of-pocket used
  innDeductibleMet?: number; // YTD individual in-network deductible used
  innOutOfPocketMet?: number; // YTD in-network out-of-pocket used
  /** ISO date the accumulator values were current as-of (typically the EOB
   *  process date). Without this, "deductible met" arguments lose force. */
  accumulatorAsOfDate?: string;

  // Allowed Amount Method (critical!)
  allowedAmountMethod?: 'ucr' | 'medicare_percent' | 'fair_health' | 'plan_schedule' | 'unknown';
  allowedAmountPercent?: number; // e.g., 150 for 150% of Medicare
  allowedAmountSource?: string;

  // Mental Health
  mentalHealthParity?: boolean;
  mentalHealthVisitLimit?: number;
  mentalHealthPriorAuthRequired?: boolean;
  mentalHealthCopay?: number;

  // In-Network (for comparison)
  innDeductibleIndividual?: number;
  innCoinsurancePercent?: number;
  innOutOfPocketMax?: number;

  // Telehealth
  teleHealthCovered?: boolean;
  teleHealthOonSameAsInPerson?: boolean;

  // ===== APPEAL-RELEVANT FIELDS (Phase 0 — power the smarter appeal generator) =====

  // Per-discipline visit limits (additive to mentalHealthVisitLimit which only covers MH)
  otVisitLimit?: number; // visits per year covered for OT
  ptVisitLimit?: number;
  stVisitLimit?: number;
  habilitativeServicesCombined?: boolean; // true when OT/PT/ST share a single combined cap
  combinedTherapyVisitLimit?: number; // when habilitativeServicesCombined is true

  /** CPT codes / service categories the plan requires prior authorization for.
   *  Used to refute "no auth required" type denials, OR to confirm an auth was needed. */
  priorAuthRequiredFor?: string[];

  /** Verbatim exclusion clauses. Quotable in appeals when payer denies for a
   *  reason that doesn't match an actual exclusion. */
  exclusions?: string[];

  /** Plan's own appeal-rights timeframes — quote these back at the payer. */
  appealRights?: {
    firstLevelDays?: number; // days member has to file first-level appeal
    secondLevelDays?: number;
    externalReviewDays?: number;
    payerResponseDays?: number; // payer must respond within
  };

  /** Plan's verbatim definition of medical necessity. Used to argue
   *  necessity-based denials by quoting the plan's own criteria. */
  medicalNecessityCriteria?: string;

  /** Verbatim network-adequacy language — used to refute out-of-network
   *  denials when no in-network provider exists within the plan's stated radius. */
  networkAdequacyLanguage?: string;

  /** Per-service-category copays. Catches denials that apply the wrong copay
   *  bucket (e.g., specialist copay instead of preventive). Keyed by category. */
  serviceCategoryCopays?: Record<string, number>;

  /** Per-CPT or category coverage status — explicit yes/no with optional notes.
   *  Useful for both pre-claim verification and refuting "not a covered service" denials. */
  coverageStatus?: Array<{
    code: string; // CPT code or category name
    covered: boolean;
    notes?: string;
  }>;

  /** Recent claim line items extracted from an uploaded EOB. Independent of
   *  the precedent service — these are the *member's* historical claims as
   *  the payer recorded them, useful for: (1) refuting "first time we've
   *  seen this code" denials, (2) confirming network/coverage decisions
   *  the payer made on prior encounters. */
  recentClaimsFromEob?: Array<{
    dateOfService?: string;
    cptCode?: string;
    icd10Code?: string;
    billedAmount?: number;
    allowedAmount?: number;
    paidAmount?: number;
    patientResponsibility?: number;
    status?: string; // 'paid' | 'denied' | 'partial' | 'pending'
    denialCode?: string;
    notes?: string;
  }>;

  // Extraction metadata
  extractionConfidence: number; // 0-1
  rawExtractedData: Record<string, any>;
}

export interface DocumentParseResult {
  success: boolean;
  benefits?: ParsedBenefits;
  error?: string;
  documentType: string;
  processingTimeMs: number;
}

/**
 * Parse a plan document using OpenAI
 */
export async function parsePlanDocument(
  documentContent: string,
  documentType: 'sbc' | 'eob' | 'plan_contract' | 'insurance_card' | 'other',
  mimeType?: string
): Promise<DocumentParseResult> {
  const startTime = Date.now();

  try {
    const systemPrompt = getSystemPrompt(documentType);
    const userPrompt = getUserPrompt(documentContent, documentType);

    const parsedData = await callClaudeForJson(systemPrompt, userPrompt);

    // Transform to our schema format
    const benefits: ParsedBenefits = transformParsedData(parsedData);

    return {
      success: true,
      benefits,
      documentType,
      processingTimeMs: Date.now() - startTime
    };

  } catch (error) {
    console.error('Error parsing plan document:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      documentType,
      processingTimeMs: Date.now() - startTime
    };
  }
}

/**
 * Parse a document from base64 PDF content
 */
export async function parsePlanDocumentFromPDF(
  base64Content: string,
  documentType: 'sbc' | 'eob' | 'plan_contract' | 'insurance_card' | 'other'
): Promise<DocumentParseResult> {
  const startTime = Date.now();

  try {
    const client = getAnthropic();
    if (!client) {
      throw new Error('Anthropic API key not configured');
    }
    const systemPrompt = getSystemPrompt(documentType);

    // Claude supports native PDF input via the document content block.
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      temperature: 0.1,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64Content,
              },
            } as any,
            {
              type: 'text',
              text: getExtractionPrompt(documentType),
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    const content = textBlock?.text;
    if (!content) {
      throw new Error('No response from Claude');
    }

    const jsonMatch =
      content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not extract JSON from response');
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const parsedData = JSON.parse(jsonStr);

    // Transform to benefits format
    const benefits: ParsedBenefits = transformParsedData(parsedData);

    return {
      success: true,
      benefits,
      documentType,
      processingTimeMs: Date.now() - startTime
    };

  } catch (error) {
    console.error('Error parsing PDF document:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      documentType,
      processingTimeMs: Date.now() - startTime
    };
  }
}

/**
 * Transform parsed data to benefits format.
 * Exported for unit testing — public API stays parsePlanDocument().
 */
export function transformParsedData(parsedData: any): ParsedBenefits {
  return {
    planName: parsedData.plan_name || parsedData.planName,
    planType: parsedData.plan_type || parsedData.planType,
    insuranceProvider: parsedData.insurance_provider || parsedData.insuranceProvider || parsedData.carrier,
    groupNumber: parsedData.group_number || parsedData.groupNumber,
    policyNumber: parsedData.policy_number || parsedData.policyNumber || parsedData.member_id,
    effectiveDate: parsedData.effective_date || parsedData.effectiveDate,
    terminationDate: parsedData.termination_date || parsedData.terminationDate,

    oonDeductibleIndividual: parseAmount(parsedData.oon_deductible_individual || parsedData.out_of_network?.deductible?.individual),
    oonDeductibleFamily: parseAmount(parsedData.oon_deductible_family || parsedData.out_of_network?.deductible?.family),
    oonCoinsurancePercent: parsePercent(parsedData.oon_coinsurance || parsedData.out_of_network?.coinsurance),
    oonOutOfPocketMax: parseAmount(parsedData.oon_out_of_pocket_max || parsedData.out_of_network?.out_of_pocket_max?.individual),

    // Accumulators (typically populated from EOB documents)
    oonDeductibleMet: parseAmount(parsedData.oon_deductible_met || parsedData.accumulators?.oon_deductible_met),
    oonOutOfPocketMet: parseAmount(parsedData.oon_out_of_pocket_met || parsedData.accumulators?.oon_out_of_pocket_met),
    innDeductibleMet: parseAmount(parsedData.inn_deductible_met || parsedData.accumulators?.inn_deductible_met),
    innOutOfPocketMet: parseAmount(parsedData.inn_out_of_pocket_met || parsedData.accumulators?.inn_out_of_pocket_met),
    accumulatorAsOfDate: typeof (parsedData.accumulator_as_of_date || parsedData.accumulators?.as_of_date) === 'string'
      ? (parsedData.accumulator_as_of_date || parsedData.accumulators?.as_of_date)
      : undefined,

    allowedAmountMethod: normalizeAllowedAmountMethod(
      parsedData.allowed_amount_method ||
      parsedData.reimbursement_methodology ||
      parsedData.out_of_network?.allowed_amount_basis
    ),
    allowedAmountPercent: parsePercent(parsedData.allowed_amount_percent || parsedData.medicare_percent),
    allowedAmountSource: parsedData.allowed_amount_source || parsedData.ucr_source,

    mentalHealthParity: parsedData.mental_health_parity ?? parsedData.mh_parity ?? parsedData.mental_health?.parity,
    mentalHealthVisitLimit: parsedData.mental_health_visit_limit || parsedData.mh_visits_per_year || parsedData.mental_health?.visit_limit,
    mentalHealthPriorAuthRequired: parsedData.mental_health_prior_auth || parsedData.mh_prior_auth_required || parsedData.mental_health?.prior_auth_required,
    mentalHealthCopay: parseAmount(parsedData.mental_health_copay || parsedData.mh_copay || parsedData.mental_health?.copay),

    innDeductibleIndividual: parseAmount(parsedData.inn_deductible_individual || parsedData.in_network?.deductible?.individual),
    innCoinsurancePercent: parsePercent(parsedData.inn_coinsurance || parsedData.in_network?.coinsurance),
    innOutOfPocketMax: parseAmount(parsedData.inn_out_of_pocket_max || parsedData.in_network?.out_of_pocket_max?.individual),

    teleHealthCovered: parsedData.telehealth_covered ?? parsedData.telehealth?.covered,
    teleHealthOonSameAsInPerson: parsedData.telehealth_oon_same || parsedData.telehealth?.oon_same_as_in_person,

    // Appeal-relevant fields (Phase 0)
    otVisitLimit: parseAmount(parsedData.ot_visit_limit || parsedData.therapy_limits?.ot),
    ptVisitLimit: parseAmount(parsedData.pt_visit_limit || parsedData.therapy_limits?.pt),
    stVisitLimit: parseAmount(parsedData.st_visit_limit || parsedData.therapy_limits?.st),
    habilitativeServicesCombined: parsedData.habilitative_services_combined ?? parsedData.therapy_limits?.combined,
    combinedTherapyVisitLimit: parseAmount(parsedData.combined_therapy_visit_limit || parsedData.therapy_limits?.combined_limit),
    priorAuthRequiredFor: normalizeStringArray(parsedData.prior_auth_required_for || parsedData.prior_auth_codes),
    exclusions: normalizeStringArray(parsedData.exclusions),
    appealRights: parsedData.appeal_rights ? {
      firstLevelDays: parseAmount(parsedData.appeal_rights.first_level_days),
      secondLevelDays: parseAmount(parsedData.appeal_rights.second_level_days),
      externalReviewDays: parseAmount(parsedData.appeal_rights.external_review_days),
      payerResponseDays: parseAmount(parsedData.appeal_rights.payer_response_days),
    } : undefined,
    medicalNecessityCriteria: typeof parsedData.medical_necessity_criteria === 'string' ? parsedData.medical_necessity_criteria : undefined,
    networkAdequacyLanguage: typeof parsedData.network_adequacy_language === 'string' ? parsedData.network_adequacy_language : undefined,
    serviceCategoryCopays: parsedData.service_category_copays && typeof parsedData.service_category_copays === 'object'
      ? Object.fromEntries(
          Object.entries(parsedData.service_category_copays as Record<string, any>)
            .map(([k, v]) => [k, parseAmount(v)])
            .filter((e): e is [string, number] => typeof e[1] === 'number')
        )
      : undefined,
    coverageStatus: Array.isArray(parsedData.coverage_status)
      ? parsedData.coverage_status
          .filter((c: any) => c && typeof c.code === 'string')
          .map((c: any) => ({
            code: c.code,
            covered: Boolean(c.covered),
            notes: typeof c.notes === 'string' ? c.notes : undefined,
          }))
      : undefined,

    recentClaimsFromEob: Array.isArray(parsedData.recent_claims || parsedData.eob_claims)
      ? (parsedData.recent_claims || parsedData.eob_claims)
          .filter((c: any) => c && typeof c === 'object')
          .map((c: any) => ({
            dateOfService: typeof c.date_of_service === 'string' ? c.date_of_service : undefined,
            cptCode: typeof c.cpt_code === 'string' ? c.cpt_code : undefined,
            icd10Code: typeof c.icd10_code === 'string' ? c.icd10_code : undefined,
            billedAmount: parseAmount(c.billed_amount),
            allowedAmount: parseAmount(c.allowed_amount),
            paidAmount: parseAmount(c.paid_amount),
            patientResponsibility: parseAmount(c.patient_responsibility),
            status: typeof c.status === 'string' ? c.status : undefined,
            denialCode: typeof c.denial_code === 'string' ? c.denial_code : undefined,
            notes: typeof c.notes === 'string' ? c.notes : undefined,
          }))
      : undefined,

    extractionConfidence: parsedData.confidence || parsedData.extraction_confidence || 0.7,
    rawExtractedData: parsedData
  };
}

/** Coerce mixed input to a clean string[]. Strips empty/non-string entries. */
function normalizeStringArray(value: any): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const clean = value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  return clean.length > 0 ? clean : undefined;
}

/**
 * Get the system prompt for document parsing
 */
function getSystemPrompt(documentType: string): string {
  return `You are an expert insurance benefits analyst specializing in behavioral health and pediatric therapy coverage (OT, PT, ST, mental health).
Your task is to extract structured benefit information from insurance plan documents in a way that supports both pre-claim cost estimation AND post-claim denial appeals.

Focus on extracting:
1. OUT-OF-NETWORK (OON) benefits - critical for OON cost estimation
2. The ALLOWED AMOUNT METHODOLOGY - how the plan calculates what they'll pay for OON services
3. Per-discipline therapy benefits and visit limits (OT / PT / ST / MH — separately, AND whether they share a combined cap)
4. Deductibles, coinsurance, and out-of-pocket maximums (in-network and out-of-network)
5. Prior authorization requirements (which CPT codes / categories require it)
6. Exclusion clauses — extract the VERBATIM language for any explicit exclusions (so we can quote them in appeals)
7. Appeal rights — timeframes the member has to file appeals at each level, and timeframes the payer must respond within
8. The plan's verbatim definition of "medical necessity" — quote it exactly so we can cite it back in appeals
9. Network adequacy language — verbatim text covering what happens when no in-network provider is available
10. Per-service-category copays (preventive, specialist, therapy, urgent care, etc.)

Common allowed amount methodologies:
- UCR (Usual, Customary, and Reasonable) - often 80th or 90th percentile
- Medicare-based - e.g., "150% of Medicare rates" or "Medicare plus 20%"
- Fair Health - uses Fair Health database
- Plan Schedule - fixed fee schedule set by the plan

For therapy services:
- OT (97530, 97535, 97110, 97112, 97533) — extract OT-specific visit limits
- PT (97161-97164, 97110, 97112) — extract PT-specific visit limits
- ST (92507, 92521-92526) — extract ST-specific visit limits
- MH (90791, 90834, 90837, 90847) — extract MH visit limits + parity language
- Note whether OT/PT/ST share a combined visit cap (common in pediatric plans)

For exclusions and verbatim quotes:
- Preserve the EXACT WORDING from the plan document
- Don't paraphrase — appeals are stronger when we cite the plan's own language

For EOB documents specifically (documentType === 'eob'):
- Extract CURRENT ACCUMULATORS — what the member has already met YTD:
  - inn_deductible_met (in-network deductible used so far)
  - inn_out_of_pocket_met (in-network OOP used so far)
  - oon_deductible_met (out-of-network deductible used)
  - oon_out_of_pocket_met (out-of-network OOP used)
  - accumulator_as_of_date (the EOB process date — accumulators are point-in-time)
- Extract RECENT CLAIMS LISTED on the EOB (recent_claims array). For each:
  - date_of_service, cpt_code, icd10_code, billed_amount, allowed_amount,
    paid_amount, patient_responsibility, status (paid/denied/partial),
    denial_code (CARC), notes (any reason text)
- These recent claims are powerful in appeals — they prove the payer has
  processed similar codes/dates/diagnoses and how they were adjudicated.

Always provide a confidence score (0-1) for your extraction.
Output your findings as JSON only, no other text.`;
}

/**
 * Get the extraction prompt for the user message
 */
function getExtractionPrompt(documentType: string): string {
  return `Extract all insurance benefit information from this ${documentType.toUpperCase()} document.

Return ONLY a JSON object (no markdown, no explanation) with these fields:
{
  "plan_name": "Full plan name",
  "plan_type": "PPO/HMO/EPO/POS/HDHP",
  "insurance_provider": "Carrier name (e.g., Aetna, BCBS, Cigna)",
  "group_number": "Group #",
  "policy_number": "Policy/Member ID",
  "effective_date": "YYYY-MM-DD or null",

  "out_of_network": {
    "deductible": { "individual": 3000, "family": 6000 },
    "coinsurance": 40,
    "out_of_pocket_max": { "individual": 12000, "family": 24000 },
    "allowed_amount_basis": "medicare_percent"
  },

  "in_network": {
    "deductible": { "individual": 1500, "family": 3000 },
    "coinsurance": 20,
    "out_of_pocket_max": { "individual": 6000, "family": 12000 }
  },

  "allowed_amount_method": "ucr or medicare_percent or fair_health or plan_schedule",
  "allowed_amount_percent": 150,
  "allowed_amount_source": "Medicare Fee Schedule",

  "mental_health": {
    "parity": true,
    "visit_limit": null,
    "prior_auth_required": false,
    "copay": 30
  },

  "therapy_limits": {
    "ot": 60,
    "pt": 60,
    "st": 60,
    "combined": false,
    "combined_limit": null
  },

  "telehealth": {
    "covered": true,
    "oon_same_as_in_person": true
  },

  "prior_auth_required_for": ["97530 after visit 30", "92526"],

  "exclusions": [
    "Verbatim quote of any exclusion clause from the plan, e.g.: 'Educational, vocational, or recreational therapy is not covered.'"
  ],

  "appeal_rights": {
    "first_level_days": 180,
    "second_level_days": 60,
    "external_review_days": 120,
    "payer_response_days": 30
  },

  "medical_necessity_criteria": "Verbatim quote of the plan's definition of medical necessity, exactly as written.",

  "network_adequacy_language": "Verbatim quote of any network-adequacy provision, e.g.: 'When no in-network provider is available within 30 miles, out-of-network services will be covered at the in-network benefit level.'",

  "service_category_copays": {
    "specialist": 40,
    "primary_care": 25,
    "therapy": 30,
    "urgent_care": 75,
    "telehealth": 25
  },

  "coverage_status": [
    { "code": "97530", "covered": true, "notes": "Therapeutic Activities — covered when medically necessary" },
    { "code": "92507", "covered": true, "notes": "Speech therapy — covered with prior auth after visit 20" }
  ],

  "accumulators": {
    "inn_deductible_met": 750,
    "inn_out_of_pocket_met": 1200,
    "oon_deductible_met": 0,
    "oon_out_of_pocket_met": 0,
    "as_of_date": "2026-04-15"
  },

  "recent_claims": [
    {
      "date_of_service": "2026-03-20",
      "cpt_code": "97110",
      "icd10_code": "F84.0",
      "billed_amount": 216,
      "allowed_amount": 183,
      "paid_amount": 183,
      "patient_responsibility": 33,
      "status": "paid",
      "denial_code": null,
      "notes": null
    }
  ],

  "confidence": 0.85
}

If a value cannot be determined, use null. For verbatim fields (exclusions,
medical_necessity_criteria, network_adequacy_language) use null if the plan
doesn't contain that language — do NOT make up text. Return ONLY valid JSON.`;
}

/**
 * Get user prompt for text-based parsing
 */
function getUserPrompt(documentContent: string, documentType: string): string {
  return `${getExtractionPrompt(documentType)}

Document content:
---
${documentContent}
---

Return ONLY the JSON object, no other text.`;
}

/**
 * Parse amount from various formats
 */
function parseAmount(value: any): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,]/g, '').trim();
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/**
 * Parse percentage from various formats
 */
function parsePercent(value: any): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/%/g, '').trim();
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/**
 * Normalize allowed amount method to standard values
 */
function normalizeAllowedAmountMethod(value: any): 'ucr' | 'medicare_percent' | 'fair_health' | 'plan_schedule' | 'unknown' {
  if (!value) return 'unknown';

  const lower = String(value).toLowerCase();

  if (lower.includes('ucr') || lower.includes('usual') || lower.includes('customary') || lower.includes('reasonable')) {
    return 'ucr';
  }
  if (lower.includes('medicare') || lower.includes('cms')) {
    return 'medicare_percent';
  }
  if (lower.includes('fair health') || lower.includes('fairhealth')) {
    return 'fair_health';
  }
  if (lower.includes('schedule') || lower.includes('fee schedule') || lower.includes('fixed')) {
    return 'plan_schedule';
  }

  return 'unknown';
}

/**
 * Convert parsed benefits to database insert format
 */
export function benefitsToInsertFormat(
  benefits: ParsedBenefits,
  patientId: number,
  practiceId: number,
  documentId?: number
): Partial<InsertPatientPlanBenefits> {
  return {
    patientId,
    practiceId,
    documentId,

    planName: benefits.planName,
    planType: benefits.planType,
    insuranceProvider: benefits.insuranceProvider,
    groupNumber: benefits.groupNumber,
    policyNumber: benefits.policyNumber,
    effectiveDate: benefits.effectiveDate,
    terminationDate: benefits.terminationDate,

    oonDeductibleIndividual: benefits.oonDeductibleIndividual?.toString(),
    oonDeductibleFamily: benefits.oonDeductibleFamily?.toString(),
    oonCoinsurancePercent: benefits.oonCoinsurancePercent?.toString(),
    oonOutOfPocketMax: benefits.oonOutOfPocketMax?.toString(),
    oonDeductibleMet: benefits.oonDeductibleMet?.toString(),
    oonOutOfPocketMet: benefits.oonOutOfPocketMet?.toString(),

    allowedAmountMethod: benefits.allowedAmountMethod,
    allowedAmountPercent: benefits.allowedAmountPercent?.toString(),
    allowedAmountSource: benefits.allowedAmountSource,

    mentalHealthParity: benefits.mentalHealthParity,
    mentalHealthVisitLimit: benefits.mentalHealthVisitLimit,
    mentalHealthPriorAuthRequired: benefits.mentalHealthPriorAuthRequired,
    mentalHealthCopay: benefits.mentalHealthCopay?.toString(),

    innDeductibleIndividual: benefits.innDeductibleIndividual?.toString(),
    innCoinsurancePercent: benefits.innCoinsurancePercent?.toString(),
    innOutOfPocketMax: benefits.innOutOfPocketMax?.toString(),

    teleHealthCovered: benefits.teleHealthCovered,
    teleHealthOonSameAsInPerson: benefits.teleHealthOonSameAsInPerson,

    rawExtractedData: benefits.rawExtractedData,
    extractionConfidence: benefits.extractionConfidence?.toString(),

    isActive: true
  };
}
