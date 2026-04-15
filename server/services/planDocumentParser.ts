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
 * Transform parsed data to benefits format
 */
function transformParsedData(parsedData: any): ParsedBenefits {
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

    extractionConfidence: parsedData.confidence || parsedData.extraction_confidence || 0.7,
    rawExtractedData: parsedData
  };
}

/**
 * Get the system prompt for document parsing
 */
function getSystemPrompt(documentType: string): string {
  return `You are an expert insurance benefits analyst specializing in mental health coverage.
Your task is to extract structured benefit information from insurance plan documents.

Focus on extracting:
1. OUT-OF-NETWORK (OON) benefits - this is the most critical information
2. The ALLOWED AMOUNT METHODOLOGY - how the plan calculates what they'll pay for OON services
3. Mental health specific benefits and limitations
4. Deductibles, coinsurance, and out-of-pocket maximums

Common allowed amount methodologies:
- UCR (Usual, Customary, and Reasonable) - often 80th or 90th percentile
- Medicare-based - e.g., "150% of Medicare rates" or "Medicare plus 20%"
- Fair Health - uses Fair Health database
- Plan Schedule - fixed fee schedule set by the plan

For mental health (CPT codes 90791, 90834, 90837, 90847):
- Look for any visit limits or prior authorization requirements
- Check if mental health has parity with medical benefits
- Note any telehealth-specific provisions

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

  "telehealth": {
    "covered": true,
    "oon_same_as_in_person": true
  },

  "confidence": 0.85
}

If a value cannot be determined, use null. Return ONLY valid JSON.`;
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
