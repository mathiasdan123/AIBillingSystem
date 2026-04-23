/**
 * Prior Authorization Letter Service
 *
 * Generates a formal PA request letter for a patient + CPT + diagnosis,
 * pulling in the most recent SOAP note for clinical necessity language.
 * Used by the PA Assistant on the patient detail page — biller clicks
 * "Draft PA Request", fills in CPT/diagnosis/units, AI drafts the letter,
 * biller reviews + exports to PDF (or fax / email).
 *
 * Designed so the same prompt + output can later feed a 278 electronic
 * PA request (attached as the narrative / medical-necessity block). For
 * now the output is a plain letter the biller delivers manually.
 */

import Anthropic from '@anthropic-ai/sdk';
import logger from './logger';

export interface DraftPaLetterInput {
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth?: string | null;
    memberId?: string | null;
    insuranceProvider?: string | null;
  };
  practice: {
    name: string;
    npi?: string | null;
    taxId?: string | null;
    address?: string | null;
    phone?: string | null;
    specialty?: string | null;
    ownerName?: string | null;
    ownerTitle?: string | null;
  };
  request: {
    cptCode: string;
    cptDescription?: string | null;
    diagnosisCode: string;
    diagnosisDescription?: string | null;
    requestedUnits: number;
    requestedStartDate?: string | null;
    requestedEndDate?: string | null;
    frequency?: string | null; // e.g. "2x/week"
  };
  clinicalContext?: {
    latestSoapSubjective?: string | null;
    latestSoapAssessment?: string | null;
    latestSoapPlan?: string | null;
    recentSessionCount?: number | null;
    treatmentStartDate?: string | null;
    previousAuthorizationNumber?: string | null;
  };
}

export interface DraftPaLetterResult {
  letter: string; // Full letter text, formatted ready to paste/print
  subject: string; // Suggested subject line for email / fax cover
  medicalNecessitySummary: string; // Short 2-3 sentence summary for UI preview
  generatedAt: Date;
}

let anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not configured. PA letter drafting is unavailable.'
    );
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

function buildSystemPrompt(): string {
  return `You are an expert medical billing specialist who drafts prior authorization (PA) request letters for pediatric and adult therapy practices (OT, PT, Speech, Mental Health).

Your letters are used to obtain authorization from commercial and government payers for medically necessary therapy services. They are reviewed by payer medical directors and utilization review nurses, so they must be clear, clinically grounded, and professional.

## Writing guidelines

1. **Tone:** Formal, respectful, factual. Never adversarial. Never speculative.
2. **Length:** One page (300-450 words). Payer reviewers skim — brevity with clinical specificity wins.
3. **Structure:** Standard business-letter format with these sections, in order:
   - Letterhead (practice name, NPI, address, phone)
   - Date
   - Recipient ("Prior Authorization Review Department, [Payer Name]")
   - Re: line with patient name, DOB, member ID
   - Salutation
   - Opening paragraph: what is being requested (CPT, units, date range)
   - Clinical justification paragraph: diagnosis + relevant history + functional limitations
   - Treatment plan paragraph: frequency, expected duration, measurable goals
   - Closing paragraph: request for approval + contact info
   - Sign-off: authorized signer name + title
4. **Medical necessity language:** Ground every claim in the clinical context provided. If clinical context is sparse, write defensibly — say "based on clinical evaluation" rather than inventing specifics. NEVER fabricate clinical findings not in the source data.
5. **Compliance:** Use "accuracy" framing, not "optimization." This is about documenting medical necessity for correct reimbursement, not maximizing billable units.
6. **No placeholders:** The output is a finished letter the biller will review + send. Never include "[insert X here]" or "TBD" — if a field is missing, omit that sentence cleanly.

## Output format

Respond with JSON matching this shape exactly:
{
  "letter": "<full letter text, \\n for line breaks>",
  "subject": "<suggested email/fax subject line, under 80 chars>",
  "medicalNecessitySummary": "<2-3 sentence plain-English summary of the request for the biller to eyeball before sending>"
}

No prose outside the JSON. No markdown code fences.`;
}

function buildUserPrompt(input: DraftPaLetterInput): string {
  const lines: string[] = [];
  lines.push('Draft a prior authorization request letter using the following data:');
  lines.push('');
  lines.push('## Practice');
  lines.push(`- Name: ${input.practice.name}`);
  if (input.practice.npi) lines.push(`- NPI: ${input.practice.npi}`);
  if (input.practice.taxId) lines.push(`- Tax ID: ${input.practice.taxId}`);
  if (input.practice.address) lines.push(`- Address: ${input.practice.address}`);
  if (input.practice.phone) lines.push(`- Phone: ${input.practice.phone}`);
  if (input.practice.specialty) lines.push(`- Specialty: ${input.practice.specialty}`);
  if (input.practice.ownerName) {
    lines.push(
      `- Authorized signer: ${input.practice.ownerName}${
        input.practice.ownerTitle ? `, ${input.practice.ownerTitle}` : ''
      }`
    );
  }
  lines.push('');

  lines.push('## Patient');
  lines.push(`- Name: ${input.patient.firstName} ${input.patient.lastName}`);
  if (input.patient.dateOfBirth) lines.push(`- DOB: ${input.patient.dateOfBirth}`);
  if (input.patient.memberId) lines.push(`- Member ID: ${input.patient.memberId}`);
  if (input.patient.insuranceProvider) {
    lines.push(`- Payer: ${input.patient.insuranceProvider}`);
  }
  lines.push('');

  lines.push('## Request');
  lines.push(`- CPT code: ${input.request.cptCode}${
    input.request.cptDescription ? ` (${input.request.cptDescription})` : ''
  }`);
  lines.push(`- Diagnosis: ${input.request.diagnosisCode}${
    input.request.diagnosisDescription ? ` — ${input.request.diagnosisDescription}` : ''
  }`);
  lines.push(`- Requested units: ${input.request.requestedUnits}`);
  if (input.request.requestedStartDate || input.request.requestedEndDate) {
    lines.push(
      `- Requested dates: ${input.request.requestedStartDate ?? 'TBD'} – ${
        input.request.requestedEndDate ?? 'TBD'
      }`
    );
  }
  if (input.request.frequency) lines.push(`- Session frequency: ${input.request.frequency}`);
  lines.push('');

  if (input.clinicalContext) {
    lines.push('## Clinical context from most recent SOAP note');
    const c = input.clinicalContext;
    if (c.treatmentStartDate) lines.push(`- Treatment started: ${c.treatmentStartDate}`);
    if (c.recentSessionCount) lines.push(`- Recent sessions: ${c.recentSessionCount}`);
    if (c.previousAuthorizationNumber) {
      lines.push(`- Prior auth on file: ${c.previousAuthorizationNumber}`);
    }
    if (c.latestSoapSubjective) {
      lines.push(`- Subjective: ${truncate(c.latestSoapSubjective, 600)}`);
    }
    if (c.latestSoapAssessment) {
      lines.push(`- Assessment: ${truncate(c.latestSoapAssessment, 600)}`);
    }
    if (c.latestSoapPlan) lines.push(`- Plan: ${truncate(c.latestSoapPlan, 600)}`);
    lines.push('');
  }

  lines.push(
    'Draft the letter now. Remember: no placeholders, no fabricated clinical findings, JSON output only.'
  );
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

export async function draftPaLetter(
  input: DraftPaLetterInput
): Promise<DraftPaLetterResult> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
  });

  const textBlock = response.content.find((b: any) => b.type === 'text') as any;
  if (!textBlock?.text) {
    throw new Error('Claude returned no text content for PA letter draft');
  }
  const raw: string = textBlock.text.trim();

  // Strip any defensive markdown fences Claude might emit despite the prompt.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    logger.error('Failed to parse PA letter JSON from Claude', {
      rawLength: raw.length,
      preview: raw.slice(0, 200),
    });
    throw new Error('PA letter generation returned malformed output. Please retry.');
  }

  if (typeof parsed.letter !== 'string' || parsed.letter.length < 100) {
    throw new Error('Generated letter is too short or missing. Please retry.');
  }

  return {
    letter: parsed.letter,
    subject: typeof parsed.subject === 'string' ? parsed.subject : `Prior Authorization Request — ${input.patient.firstName} ${input.patient.lastName}`,
    medicalNecessitySummary:
      typeof parsed.medicalNecessitySummary === 'string'
        ? parsed.medicalNecessitySummary
        : '',
    generatedAt: new Date(),
  };
}

/**
 * Parse a PA approval letter image/PDF via Claude Vision. Returns the
 * structured fields the biller would otherwise type by hand.
 *
 * Accepts a base64-encoded image (PNG/JPG) or PDF page. For multi-page
 * PDFs the caller should pre-split or pass the first page.
 */
export interface ParsedAuthDocument {
  authorizationNumber: string | null;
  payerName: string | null;
  patientName: string | null;
  cptCode: string | null;
  diagnosisCode: string | null;
  authorizedUnits: number | null;
  startDate: string | null; // ISO yyyy-mm-dd
  endDate: string | null;
  notes: string | null;
  /** Claude's own confidence note on what it did/didn't find. Shown as a
   *  disclosure so the biller knows whether to trust the fill. */
  extractionNotes: string;
}

export async function parseAuthDocument(base64Image: string): Promise<ParsedAuthDocument> {
  const client = getAnthropicClient();

  const mediaType = detectMediaType(base64Image);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    system: `You are an expert at reading prior authorization approval letters from health insurance payers. Extract the structured fields a medical biller would need to log the authorization in their billing system.

Rules:
- If a field is not present in the document, return null for that field. NEVER guess or fabricate.
- Dates must be in ISO format: YYYY-MM-DD.
- CPT codes are 5 digits (e.g. "97530"). If multiple are listed, pick the primary one and mention the others in notes.
- ICD-10 codes have a letter + digits (e.g. "F84.0"). Same rule if multiple.
- Authorized units is an integer. Convert "20 sessions" or "20 visits" → 20.
- Include any limitations (per-week caps, prior-auth-only-for-X) in the notes field.
- In extractionNotes, briefly note which fields you extracted confidently vs. fields you couldn't find or were ambiguous — so the biller knows whether to double-check before saving.

Respond with JSON only, matching:
{
  "authorizationNumber": string | null,
  "payerName": string | null,
  "patientName": string | null,
  "cptCode": string | null,
  "diagnosisCode": string | null,
  "authorizedUnits": number | null,
  "startDate": string | null,
  "endDate": string | null,
  "notes": string | null,
  "extractionNotes": string
}

No markdown, no prose outside the JSON.`,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: stripDataUrlPrefix(base64Image),
            },
          },
          {
            type: 'text',
            text: 'Extract the prior authorization fields from this document.',
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b: any) => b.type === 'text') as any;
  if (!textBlock?.text) {
    throw new Error('Claude Vision returned no text for PA document');
  }

  const cleaned = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    logger.error('Failed to parse auth-doc JSON from Claude', {
      preview: cleaned.slice(0, 200),
    });
    throw new Error('Could not parse the authorization document. Try a clearer scan.');
  }
}

function detectMediaType(
  dataUrlOrBase64: string
): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  const lower = dataUrlOrBase64.toLowerCase();
  if (lower.startsWith('data:image/png')) return 'image/png';
  if (lower.startsWith('data:image/gif')) return 'image/gif';
  if (lower.startsWith('data:image/webp')) return 'image/webp';
  // Default to jpeg — works for most fax/scan uploads.
  return 'image/jpeg';
}

function stripDataUrlPrefix(dataUrlOrBase64: string): string {
  const commaIdx = dataUrlOrBase64.indexOf(',');
  if (dataUrlOrBase64.startsWith('data:') && commaIdx !== -1) {
    return dataUrlOrBase64.slice(commaIdx + 1);
  }
  return dataUrlOrBase64;
}
