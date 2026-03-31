/**
 * Claude Appeal Service
 *
 * Generates payer-specific appeal letters for denied claims using Claude (Anthropic API).
 * Uses AI to analyze denial reasons and create compelling, professional appeal letters
 * with category-specific language and clinical justification.
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger';

// Re-export interfaces from aiAppealGenerator for consistency
export interface AppealResult {
  appealLetter: string;
  denialCategory: string;
  successProbability: number;
  suggestedActions: string[];
  keyArguments: string[];
  generatedAt: Date;
}

interface ClaimData {
  id: number;
  claimNumber: string | null;
  totalAmount: string;
  denialReason: string | null;
  submittedAt: Date | null;
}

interface PatientData {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  insuranceProvider: string | null;
  insuranceId: string | null;
}

interface LineItemData {
  cptCode?: { code: string; description: string };
  icd10Code?: { code: string; description: string };
  units: number;
  amount: string;
}

interface PracticeData {
  name: string;
  npi: string | null;
  address: string | null;
  phone: string | null;
}

interface GenerateClaudeAppealParams {
  claim: ClaimData;
  lineItems: LineItemData[];
  patient: PatientData;
  practice: PracticeData;
  soapNote?: string | null;
  denialReason: string;
  appealLevel?: string;
  previousAppealOutcome?: string;
}

interface ClaudeAppealResponse {
  appealLetter: string;
  denialCategory: string;
  successProbability: number;
  suggestedActions: string[];
  keyArguments: string[];
  missingDocumentation?: string[];
}

// Singleton Anthropic client
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is not set. Cannot generate AI-powered appeal letters.'
    );
  }

  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }

  return anthropicClient;
}

/**
 * Build the system prompt for Claude to generate appeal letters
 */
function buildSystemPrompt(): string {
  return `You are an expert medical billing appeal specialist for behavioral health and occupational therapy practices. Your role is to analyze denied insurance claims and generate professional, compelling appeal letters that maximize the likelihood of overturning denials.

## Your Expertise
- Deep knowledge of medical billing, CPT/ICD-10 coding, and payer policies
- Understanding of behavioral health/OT clinical documentation requirements
- Familiarity with common denial categories and successful appeal strategies
- Experience with Medicare, Medicaid, and commercial payer appeal processes

## Key Guidelines
1. **Compliance**: Use "accuracy" framing, NOT "optimization" or "maximization". Appeals should focus on ensuring correct billing and reimbursement for medically necessary services.

2. **Professional Tone**: Letters must be formal, respectful, and professional. Avoid adversarial language while being firm and clear.

3. **Evidence-Based**: Ground all arguments in:
   - Clinical documentation (SOAP notes, evaluations, progress notes)
   - Payer policy guidelines and coverage criteria
   - Medical necessity standards and practice guidelines (e.g., AOTA, APA)
   - Relevant CPT/ICD-10 coding guidelines

4. **Denial Categories**: Common categories include:
   - Medical necessity denials
   - Coding errors or mismatches
   - Missing authorization/prior auth
   - Coverage/benefits issues
   - Timely filing
   - Duplicate claims
   - Eligibility issues
   - Bundling/unbundling disputes

5. **Appeal Letter Structure**:
   - Practice letterhead (name, address, NPI, phone)
   - Date
   - Payer address
   - RE: Appeal subject line with patient info and claim details
   - Professional greeting
   - Clear statement of appeal purpose
   - Services provided (CPT codes with descriptions)
   - Diagnosis codes (ICD-10 with descriptions)
   - Grounds for appeal (numbered arguments)
   - Clinical justification (specific to the case)
   - Request for reconsideration
   - Professional closing
   - Enclosures list

6. **Category-Specific Language**:
   - Medical Necessity: Emphasize functional deficits, treatment goals, progress measures, clinical guidelines
   - Coding: Acknowledge error if applicable, provide corrected codes, explain rationale
   - Authorization: Document urgency, retroactive request, clinical necessity
   - Coverage: Cite specific policy language, member benefits, CPT definitions
   - Timely Filing: Provide proof of original submission, document delays beyond provider control

## Response Format
You MUST respond with valid JSON only (no markdown, no code blocks, no additional text). The JSON must have this exact structure:

{
  "appealLetter": "Full text of the appeal letter with proper formatting and line breaks",
  "denialCategory": "one of: medical_necessity, coding_error, auth_missing, coverage, timely_filing, duplicate_claim, eligibility, bundling, other",
  "successProbability": 65,
  "suggestedActions": [
    "Include detailed functional outcome measures",
    "Attach progress notes showing improvement"
  ],
  "keyArguments": [
    "Treatment aligns with established practice guidelines",
    "Documented functional deficits require skilled intervention"
  ],
  "missingDocumentation": [
    "Optional array of documents that would strengthen the appeal"
  ]
}

Remember: Your appeal letter should be ready to print on practice letterhead and mail directly to the payer. It must be professional, accurate, and compelling.`;
}

/**
 * Build the user prompt with specific claim details
 */
function buildUserPrompt(params: GenerateClaudeAppealParams): string {
  const {
    claim,
    lineItems,
    patient,
    practice,
    soapNote,
    denialReason,
    appealLevel,
    previousAppealOutcome,
  } = params;

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const dateOfService = claim.submittedAt
    ? new Date(claim.submittedAt).toLocaleDateString('en-US')
    : 'See attached documentation';

  const patientDOB = patient.dateOfBirth
    ? new Date(patient.dateOfBirth).toLocaleDateString('en-US')
    : 'On file';

  // Build CPT codes list
  const cptCodes = lineItems
    .filter((item) => item.cptCode)
    .map(
      (item) =>
        `${item.cptCode!.code} - ${item.cptCode!.description} (${item.units} unit${item.units > 1 ? 's' : ''}, $${item.amount})`
    );

  // Build ICD-10 codes list (deduplicated)
  const icd10Codes = lineItems
    .filter((item) => item.icd10Code)
    .map((item) => `${item.icd10Code!.code} - ${item.icd10Code!.description}`)
    .filter((value, index, self) => self.indexOf(value) === index);

  let prompt = `Generate a professional appeal letter for the following denied claim:

## Practice Information
Name: ${practice.name}
NPI: ${practice.npi || '[NPI Number]'}
Address: ${practice.address || '[Practice Address]'}
Phone: ${practice.phone || '[Practice Phone]'}

## Patient Information
Name: ${patient.firstName} ${patient.lastName}
Date of Birth: ${patientDOB}
Insurance Provider: ${patient.insuranceProvider || '[Insurance Company]'}
Member ID: ${patient.insuranceId || 'On file'}

## Claim Details
Claim Number: ${claim.claimNumber || 'See attached'}
Date of Service: ${dateOfService}
Total Billed Amount: $${claim.totalAmount}
Denial Reason: ${denialReason}
Today's Date: ${today}

## Services Billed (CPT Codes)
${cptCodes.length > 0 ? cptCodes.join('\n') : 'See attached claim'}

## Diagnosis Codes (ICD-10)
${icd10Codes.length > 0 ? icd10Codes.join('\n') : 'See attached documentation'}`;

  // Add SOAP note if available
  if (soapNote && soapNote.trim().length > 0) {
    prompt += `\n\n## Clinical Documentation (SOAP Note)
${soapNote.trim()}`;
  }

  // Add appeal level context
  if (appealLevel) {
    prompt += `\n\n## Appeal Level
This is a ${appealLevel} appeal.`;
  }

  // Add previous appeal outcome if this is a subsequent appeal
  if (previousAppealOutcome) {
    prompt += `\n\n## Previous Appeal Outcome
${previousAppealOutcome}

Please address any issues raised in the previous denial and strengthen the arguments accordingly.`;
  }

  prompt += `\n\n## Instructions
Analyze this denial and generate a compelling appeal letter that:
1. Identifies the denial category and root cause
2. Addresses the specific denial reason with evidence-based arguments
3. References the clinical documentation (SOAP note) to support medical necessity
4. Uses appropriate clinical and billing terminology
5. Includes specific, actionable arguments for why the claim should be paid
6. Maintains a professional, respectful tone throughout

Estimate the success probability (0-100) based on the strength of available evidence and typical outcomes for this denial category.

Respond ONLY with valid JSON matching the required schema. Do not include any markdown formatting or code blocks.`;

  return prompt;
}

/**
 * Parse and validate Claude's JSON response
 */
function parseClaudeResponse(responseText: string): ClaudeAppealResponse {
  try {
    // Remove markdown code blocks if present (defensive parsing)
    let cleanText = responseText.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(cleanText);

    // Validate required fields
    if (!parsed.appealLetter || typeof parsed.appealLetter !== 'string') {
      throw new Error('Missing or invalid appealLetter field');
    }
    if (!parsed.denialCategory || typeof parsed.denialCategory !== 'string') {
      throw new Error('Missing or invalid denialCategory field');
    }
    if (typeof parsed.successProbability !== 'number') {
      throw new Error('Missing or invalid successProbability field');
    }
    if (!Array.isArray(parsed.suggestedActions)) {
      throw new Error('Missing or invalid suggestedActions field');
    }
    if (!Array.isArray(parsed.keyArguments)) {
      throw new Error('Missing or invalid keyArguments field');
    }

    return parsed as ClaudeAppealResponse;
  } catch (error) {
    logger.error('Failed to parse Claude appeal response', {
      error: error instanceof Error ? error.message : String(error),
      responsePreview: responseText.substring(0, 200),
    });
    throw new Error(
      `Failed to parse AI response: ${error instanceof Error ? error.message : 'Invalid JSON'}`
    );
  }
}

/**
 * Generate a payer-specific appeal letter using Claude AI
 *
 * @param params - Claim, patient, practice, and clinical data
 * @returns AppealResult with letter, category, success probability, and suggestions
 * @throws Error if API key is missing or API call fails
 */
export async function generateClaudeAppeal(
  params: GenerateClaudeAppealParams
): Promise<AppealResult> {
  const startTime = Date.now();

  try {
    logger.info('Generating Claude appeal letter', {
      claimId: params.claim.id,
      claimNumber: params.claim.claimNumber,
      denialReason: params.denialReason,
      hasSOAPNote: !!params.soapNote,
      appealLevel: params.appealLevel,
    });

    const client = getAnthropicClient();
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(params);

    // Call Claude API
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      max_tokens: 4000, // Appeal letters can be longer than chat messages
      temperature: 0.3, // Lower temperature for more consistent, professional output
    });

    // Extract text content
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    );

    if (textBlocks.length === 0) {
      throw new Error('No text content in Claude response');
    }

    const responseText = textBlocks.map((block) => block.text).join('\n');

    // Parse and validate response
    const claudeResponse = parseClaudeResponse(responseText);

    const duration = Date.now() - startTime;

    logger.info('Successfully generated Claude appeal letter', {
      claimId: params.claim.id,
      denialCategory: claudeResponse.denialCategory,
      successProbability: claudeResponse.successProbability,
      letterLength: claudeResponse.appealLetter.length,
      durationMs: duration,
      tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    });

    // Map to AppealResult interface
    return {
      appealLetter: claudeResponse.appealLetter,
      denialCategory: claudeResponse.denialCategory,
      successProbability: claudeResponse.successProbability,
      suggestedActions: claudeResponse.suggestedActions,
      keyArguments: claudeResponse.keyArguments,
      generatedAt: new Date(),
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Failed to generate Claude appeal letter', {
      claimId: params.claim.id,
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    // Re-throw with context
    if (error instanceof Error) {
      if (error.message.includes('401') || error.message.includes('authentication')) {
        throw new Error(
          'Invalid Anthropic API key. Please check ANTHROPIC_API_KEY configuration.'
        );
      }
      if (error.message.includes('429') || error.message.includes('rate_limit')) {
        throw new Error(
          'Anthropic API rate limit exceeded. Please try again in a few moments.'
        );
      }
      if (error.message.includes('ANTHROPIC_API_KEY')) {
        throw error; // Re-throw missing API key error as-is
      }
    }

    throw new Error(
      `Failed to generate AI appeal letter: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Check if Claude appeal service is available (API key configured)
 */
export function isClaudeAppealAvailable(): boolean {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  return !!apiKey;
}
