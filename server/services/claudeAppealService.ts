/**
 * Claude Appeal Service
 *
 * Generates payer-specific appeal letters for denied claims using Claude (Anthropic API).
 * Uses AI to analyze denial reasons and create compelling, professional appeal letters
 * with category-specific language and clinical justification.
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger';
import type { ClaimPrecedent } from './claimPrecedentService';
import { formatPrecedentsForAppeal } from './claimPrecedentService';
import type { ProvenArgument } from './appealOutcomeLearningService';
import { formatProvenArgumentsForPrompt } from './appealOutcomeLearningService';

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

/**
 * Optional richer-data inputs (Phase 0 / Workstream A + B). When present,
 * Claude is instructed to cite the patient's actual plan language and prior
 * paid claims by the same payer to make the appeal much more specific.
 *
 * Loose-typed because plan benefits come from a Drizzle row whose
 * `rawExtractedData` JSONB field carries the new appeal-relevant fields
 * (exclusions, appealRights, medicalNecessityCriteria, etc.) added to
 * ParsedBenefits in planDocumentParser.ts. Caller doesn't need to know
 * the shape — we read defensively.
 */
interface GenerateClaudeAppealParams {
  claim: ClaimData;
  lineItems: LineItemData[];
  patient: PatientData;
  practice: PracticeData;
  soapNote?: string | null;
  denialReason: string;
  appealLevel?: string;
  previousAppealOutcome?: string;
  /** Patient's parsed plan benefits (DB row from getPatientPlanBenefits). */
  parsedBenefits?: Record<string, any> | null;
  /** Precedent paid claims keyed by CPT code from findPrecedentsForDeniedClaim. */
  precedents?: Map<string, ClaimPrecedent[]> | null;
  /** Tier A #2 — proven arguments from past appeals that won for this
   *  practice + payer + denial category. Caller fetches via
   *  getProvenArgumentsForContext. Optional. */
  provenArguments?: ProvenArgument[] | null;
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
/**
 * Exported for the prompt-preview debug route. Public callers should use
 * generateClaudeAppeal — this is just so admins can inspect prompts.
 */
export function buildSystemPrompt(): string {
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

7. **Plan Document Citations** (when "Plan Benefits" section is provided in the prompt):
   - When the plan's exclusions list is provided, check if the denial reason matches an actual exclusion. If it does NOT, say so explicitly and cite the verbatim exclusion list.
   - When the plan's medical necessity criteria is provided, quote the verbatim language back at the payer to argue the denial conflicts with the plan's own definition.
   - When network adequacy language is provided and this is an out-of-network denial, cite the verbatim language to argue OON services should be covered at in-network rates.
   - When per-discipline visit limits are provided (otVisitLimit, ptVisitLimit, stVisitLimit), cite specific numbers: "Plan covers 60 visits per year; member has used X."
   - When appeal rights timeframes are provided, cite them at the payer ("Per plan terms, [Payer] must respond within N days").
   - Use VERBATIM language when quoting the plan — do not paraphrase. Wrap quoted plan text in quotation marks.

8. **Precedent Claim Citations** (when "Prior Paid Claims" section is provided):
   - Cite specific prior claim numbers, dates, and amounts where the SAME payer paid for the SAME CPT code on the SAME member previously.
   - Use this as an inconsistency argument: "Aetna paid claim #X for CPT 97530 with diagnosis F84.0 on date Y. The denial of the present claim for the same code, member, and diagnosis is inconsistent with that prior payment history."
   - Don't fabricate precedents — only cite what's provided in the prompt context.

9. **Proven Arguments** (when "Proven Arguments" section is provided):
   - These are arguments that have HISTORICALLY won appeals for this practice with this payer for this denial category.
   - Weave the most relevant ones into the new appeal letter where they apply truthfully — but DO NOT force them in if they don't fit the specific facts of the current case.
   - Treat each proven argument as a starting point or template; restate it in your own words tied to this case's specifics.

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
/**
 * Exported for the prompt-preview debug route. Public callers should use
 * generateClaudeAppeal — this is just so admins can inspect prompts.
 */
export function buildUserPrompt(params: GenerateClaudeAppealParams): string {
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

  // Add parsed plan benefits when present (Workstream A enrichment).
  // We read defensively from the rawExtractedData JSONB to surface the new
  // appeal-relevant fields. If the patient hasn't uploaded a plan document,
  // this whole block is skipped and the appeal proceeds without it.
  const benefitsSection = buildPlanBenefitsSection(params.parsedBenefits);
  if (benefitsSection) {
    prompt += `\n\n${benefitsSection}`;
  }

  // Add precedent claims when present (Workstream B enrichment).
  const precedentSection = buildPrecedentsSection(params.precedents);
  if (precedentSection) {
    prompt += `\n\n${precedentSection}`;
  }

  // Add proven arguments when present (Tier A #2 — outcome learning).
  if (Array.isArray(params.provenArguments) && params.provenArguments.length > 0) {
    prompt += `\n\n## Proven Arguments (won past appeals for this practice + payer + category)\n${formatProvenArgumentsForPrompt(params.provenArguments)}`;
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
 * Build the "Plan Benefits" section of the prompt from the patient's parsed
 * plan-document data. Returns empty string when nothing useful is available.
 *
 * Reads both columns and the rawExtractedData JSONB defensively — different
 * documents extract different fields, and we don't want a single null to
 * suppress everything else.
 *
 * Exported for unit testing — callers should still use generateClaudeAppeal.
 */
export function buildPlanBenefitsSection(benefits: any): string {
  if (!benefits) return '';
  const raw = benefits.rawExtractedData ?? {};
  const lines: string[] = [];

  // Column-level fields (always populated when document was parsed).
  if (benefits.planName) lines.push(`Plan: ${benefits.planName}${benefits.planType ? ` (${benefits.planType})` : ''}`);

  // Per-discipline visit limits — pull from raw JSONB. Most useful in appeals
  // arguing "plan covers N visits, member has used Y".
  const therapy = raw.therapy_limits ?? {};
  const visitLimitParts: string[] = [];
  if (raw.ot_visit_limit ?? therapy.ot) visitLimitParts.push(`OT ${raw.ot_visit_limit ?? therapy.ot} visits/year`);
  if (raw.pt_visit_limit ?? therapy.pt) visitLimitParts.push(`PT ${raw.pt_visit_limit ?? therapy.pt} visits/year`);
  if (raw.st_visit_limit ?? therapy.st) visitLimitParts.push(`ST ${raw.st_visit_limit ?? therapy.st} visits/year`);
  if (therapy.combined && therapy.combined_limit) visitLimitParts.push(`Combined OT/PT/ST cap: ${therapy.combined_limit} visits/year`);
  if (visitLimitParts.length > 0) lines.push(`Visit limits: ${visitLimitParts.join('; ')}`);

  // Verbatim exclusions — quotable in appeals
  if (Array.isArray(raw.exclusions) && raw.exclusions.length > 0) {
    lines.push('Plan exclusions (verbatim — cite these when refuting denial reasons that don\'t match an actual exclusion):');
    raw.exclusions.slice(0, 8).forEach((ex: string) => {
      if (typeof ex === 'string' && ex.trim().length > 0) lines.push(`  - "${ex.trim()}"`);
    });
  }

  // Verbatim medical necessity criteria
  if (typeof raw.medical_necessity_criteria === 'string' && raw.medical_necessity_criteria.trim().length > 0) {
    lines.push(`Plan's verbatim definition of medical necessity (quote this back):\n  "${raw.medical_necessity_criteria.trim()}"`);
  }

  // Network adequacy language
  if (typeof raw.network_adequacy_language === 'string' && raw.network_adequacy_language.trim().length > 0) {
    lines.push(`Plan's verbatim network-adequacy language (cite for OON denials):\n  "${raw.network_adequacy_language.trim()}"`);
  }

  // Prior auth requirements
  if (Array.isArray(raw.prior_auth_required_for) && raw.prior_auth_required_for.length > 0) {
    lines.push(`Prior authorization required for: ${raw.prior_auth_required_for.join(', ')}`);
  }

  // Appeal rights timeframes
  const ar = raw.appeal_rights ?? {};
  const arParts: string[] = [];
  if (ar.first_level_days) arParts.push(`first-level appeal: ${ar.first_level_days} days from denial`);
  if (ar.second_level_days) arParts.push(`second-level: ${ar.second_level_days} days`);
  if (ar.external_review_days) arParts.push(`external review: ${ar.external_review_days} days`);
  if (ar.payer_response_days) arParts.push(`payer must respond within: ${ar.payer_response_days} days`);
  if (arParts.length > 0) lines.push(`Plan's appeal rights timeframes: ${arParts.join('; ')}`);

  // OON benefits (from columns)
  const oonParts: string[] = [];
  if (benefits.oonDeductibleIndividual) oonParts.push(`OON deductible: $${benefits.oonDeductibleIndividual}`);
  if (benefits.oonCoinsurancePercent) oonParts.push(`OON coinsurance: ${benefits.oonCoinsurancePercent}%`);
  if (benefits.oonOutOfPocketMax) oonParts.push(`OON OOP max: $${benefits.oonOutOfPocketMax}`);
  if (oonParts.length > 0) lines.push(`OON benefits: ${oonParts.join(' / ')}`);

  // Accumulators (Tier A #1) — from EOB upload + parse. The "deductible
  // already met" argument is one of the strongest denial-fight tools.
  const innDedMet = benefits.innDeductibleMet ?? raw.accumulators?.inn_deductible_met ?? raw.inn_deductible_met;
  const innOopMet = benefits.innOutOfPocketMet ?? raw.accumulators?.inn_out_of_pocket_met ?? raw.inn_out_of_pocket_met;
  const oonDedMet = benefits.oonDeductibleMet ?? raw.accumulators?.oon_deductible_met ?? raw.oon_deductible_met;
  const oonOopMet = benefits.oonOutOfPocketMet ?? raw.accumulators?.oon_out_of_pocket_met ?? raw.oon_out_of_pocket_met;
  const asOfDate = raw.accumulators?.as_of_date ?? raw.accumulator_as_of_date;
  const accParts: string[] = [];
  if (innDedMet != null) accParts.push(`In-network deductible met: $${innDedMet}`);
  if (innOopMet != null) accParts.push(`In-network OOP met: $${innOopMet}`);
  if (oonDedMet != null) accParts.push(`OON deductible met: $${oonDedMet}`);
  if (oonOopMet != null) accParts.push(`OON OOP met: $${oonOopMet}`);
  if (accParts.length > 0) {
    const asOfSuffix = asOfDate ? ` (as of ${asOfDate})` : '';
    lines.push(`Accumulators${asOfSuffix} — use for "deductible/OOP already met" arguments:`);
    accParts.forEach((p) => lines.push(`  - ${p}`));
  }

  // Recent claims from EOB — proves payer processed similar codes already
  if (Array.isArray(raw.recent_claims) && raw.recent_claims.length > 0) {
    lines.push(`Recent claims listed on member's EOB (payer's own record of past adjudications):`);
    raw.recent_claims.slice(0, 6).forEach((c: any) => {
      if (!c) return;
      const parts: string[] = [];
      if (c.date_of_service) parts.push(c.date_of_service);
      if (c.cpt_code) parts.push(`CPT ${c.cpt_code}`);
      if (c.status) parts.push(c.status);
      if (c.paid_amount != null) parts.push(`paid $${c.paid_amount}`);
      if (c.denial_code) parts.push(`denial ${c.denial_code}`);
      lines.push(`  - ${parts.join(' · ')}`);
    });
  }

  // Coverage status per CPT (when explicit yes/no was extracted)
  if (Array.isArray(raw.coverage_status) && raw.coverage_status.length > 0) {
    lines.push('Coverage status by CPT:');
    raw.coverage_status.slice(0, 10).forEach((cs: any) => {
      if (cs && typeof cs.code === 'string') {
        lines.push(`  - ${cs.code}: ${cs.covered ? 'covered' : 'NOT covered'}${cs.notes ? ` — ${cs.notes}` : ''}`);
      }
    });
  }

  if (lines.length === 0) return '';

  return ['## Plan Benefits (from member\'s parsed plan documents)', ...lines].join('\n');
}

/**
 * Build the "Prior Paid Claims" section from a precedent map keyed by CPT.
 * Returns empty string when the map is empty or null. Exported for testing.
 */
export function buildPrecedentsSection(precedents: Map<string, ClaimPrecedent[]> | null | undefined): string {
  if (!precedents || precedents.size === 0) return '';

  const sections: string[] = [];
  precedents.forEach((list, cpt) => {
    if (list.length === 0) return;
    sections.push(`For CPT ${cpt} — ${formatPrecedentsForAppeal(list)}`);
  });
  if (sections.length === 0) return '';

  return [
    '## Prior Paid Claims (precedent — same payer paid these for the same member)',
    'Cite these specifically as inconsistency arguments. Do not fabricate additional precedents.',
    '',
    sections.join('\n\n'),
  ].join('\n');
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
