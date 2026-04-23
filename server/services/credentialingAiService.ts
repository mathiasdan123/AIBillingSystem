/**
 * Credentialing AI Service
 *
 * Two AI-powered helpers that sit on top of the existing credentialing
 * and payer-enrollment data:
 *
 *   draftCredentialingPacketLetter — cover letter + document checklist
 *     the practice submits when enrolling a provider with a payer.
 *   draftCredentialingApplication — cover letter + prefilled Q&A the
 *     biller pastes into the payer's credentialing application portal.
 *
 * Both pull from the same practice + provider data. Both are editable
 * text; nothing is auto-submitted.
 */

import Anthropic from '@anthropic-ai/sdk';
import logger from './logger';

export interface CredentialingDraftInput {
  practice: {
    name: string;
    npi?: string | null;
    taxId?: string | null;
    address?: string | null;
    phone?: string | null;
    specialty?: string | null;
    professionalLicense?: string | null;
    caqhProfileId?: string | null;
    ownerName?: string | null;
    ownerTitle?: string | null;
  };
  provider: {
    firstName: string;
    lastName: string;
    credentials?: string | null;
    npiNumber?: string | null;
    licenseNumber?: string | null;
    taxonomyCode?: string | null;
  };
  payer: { name: string; contact?: string | null };
  notes?: string | null;
}

export interface CredentialingPacketResult {
  coverLetter: string;
  documentChecklist: Array<{
    item: string;
    description: string;
    alreadyOnFile: boolean;
  }>;
  summary: string;
  generatedAt: Date;
}

export interface CredentialingApplicationResult {
  coverLetter: string;
  prefilledAnswers: Array<{
    question: string;
    answer: string;
    source: 'provider' | 'practice' | 'composed';
  }>;
  summary: string;
  generatedAt: Date;
}

let anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured. AI credentialing drafts unavailable.');
  }
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

function buildPacketSystemPrompt(): string {
  return `You are an expert credentialing specialist at a pediatric therapy practice (OT / PT / SLP / Mental Health). You help billers assemble the packet a practice submits to a health insurance payer when onboarding a new provider.

## What you produce

A cover letter (250-350 words) plus a document checklist. The letter is concise, professional, addressed to the payer's provider enrollment department. The checklist tells the biller exactly which supporting documents to attach.

## Rules

1. No fabrication. Only reference data the biller provided. If a field is missing, say "on file" or "included with submission" rather than inventing.
2. Professional, concise tone. Payer enrollment departments process hundreds of these; brevity with completeness wins.
3. Standard packet docs: completed credentialing application, NPI confirmation, W9, current malpractice/COI, state professional license, CAQH profile + attestation, CV/resume, practice tax ID verification, diploma/certification. Call out which are likely already on file (NPI doc, W9, tax ID, CAQH) vs. which need active collection (current COI, license, CV, diploma).
4. Use "accuracy" framing, not "optimization" — platform compliance policy.

## Output

JSON matching exactly:
{
  "coverLetter": "<full letter body>",
  "documentChecklist": [
    { "item": "<short name>", "description": "<what + why>", "alreadyOnFile": true|false }
  ],
  "summary": "<2-3 sentences for the biller>"
}

No markdown fences, no prose outside JSON.`;
}

function buildApplicationSystemPrompt(): string {
  return `You are an expert credentialing specialist drafting the written portion of a provider credentialing application to a health insurance payer.

## What you produce

Cover letter (200-300 words) introducing the provider + requesting credentialing, plus Q&A pairs covering the common questions a payer's credentialing application asks (since portals vary but question categories don't).

## Rules

1. No fabrication. When information is missing, answer "To be provided" or "[Provider to complete]" — never invent.
2. Cover common categories: full legal name, NPI, state license + expiration, specialty + taxonomy, practice name/tax ID/address, CAQH profile, malpractice insurance carrier + policy (answer "To be provided" if unknown), disciplinary history (answer "None to disclose" unless noted otherwise), board certifications.
3. Mark source for each Q&A: 'provider' (from provider record), 'practice' (from practice record), or 'composed' (synthesized from input).
4. Professional tone. Signer is practice.ownerName if available.

## Output

JSON matching exactly:
{
  "coverLetter": "<full letter body>",
  "prefilledAnswers": [
    { "question": "<standard app question>", "answer": "<the answer>", "source": "provider"|"practice"|"composed" }
  ],
  "summary": "<2-3 sentences>"
}

No markdown fences, no prose outside JSON.`;
}

function buildUserPrompt(input: CredentialingDraftInput, mode: 'packet' | 'application'): string {
  const lines: string[] = [];
  lines.push(
    `Draft a credentialing ${
      mode === 'packet' ? 'PACKET cover letter + document checklist' : 'APPLICATION cover letter + Q&A'
    } using the data below.`
  );
  lines.push('');
  lines.push('## Practice');
  lines.push(`- Name: ${input.practice.name}`);
  if (input.practice.npi) lines.push(`- NPI: ${input.practice.npi}`);
  if (input.practice.taxId) lines.push(`- Tax ID: ${input.practice.taxId}`);
  if (input.practice.address) lines.push(`- Address: ${input.practice.address}`);
  if (input.practice.phone) lines.push(`- Phone: ${input.practice.phone}`);
  if (input.practice.specialty) lines.push(`- Specialty: ${input.practice.specialty}`);
  if (input.practice.professionalLicense) lines.push(`- Practice professional license: ${input.practice.professionalLicense}`);
  if (input.practice.caqhProfileId) lines.push(`- Practice CAQH profile: ${input.practice.caqhProfileId}`);
  if (input.practice.ownerName) {
    lines.push(
      `- Authorized signer: ${input.practice.ownerName}${input.practice.ownerTitle ? `, ${input.practice.ownerTitle}` : ''}`
    );
  }
  lines.push('');
  lines.push('## Provider being credentialed');
  lines.push(
    `- Name: ${input.provider.firstName} ${input.provider.lastName}${input.provider.credentials ? `, ${input.provider.credentials}` : ''}`
  );
  if (input.provider.npiNumber) lines.push(`- NPI: ${input.provider.npiNumber}`);
  if (input.provider.licenseNumber) lines.push(`- License: ${input.provider.licenseNumber}`);
  if (input.provider.taxonomyCode) lines.push(`- Taxonomy code: ${input.provider.taxonomyCode}`);
  lines.push('');
  lines.push('## Target payer');
  lines.push(`- Payer: ${input.payer.name}`);
  if (input.payer.contact) lines.push(`- Known contact: ${input.payer.contact}`);
  lines.push('');
  if (input.notes) {
    lines.push('## Additional notes from biller');
    lines.push(input.notes);
    lines.push('');
  }
  lines.push(`Generate the ${mode} now. JSON only, no fabrication.`);
  return lines.join('\n');
}

async function callClaudeJson(system: string, user: string): Promise<any> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2500,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const textBlock = response.content.find((b: any) => b.type === 'text') as any;
  if (!textBlock?.text) throw new Error('Claude returned no text');
  const cleaned = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    logger.error('Credentialing AI: failed to parse JSON', { preview: cleaned.slice(0, 200) });
    throw new Error('AI output was malformed. Please retry.');
  }
}

export async function draftCredentialingPacketLetter(
  input: CredentialingDraftInput
): Promise<CredentialingPacketResult> {
  const parsed = await callClaudeJson(buildPacketSystemPrompt(), buildUserPrompt(input, 'packet'));
  if (typeof parsed.coverLetter !== 'string' || !Array.isArray(parsed.documentChecklist)) {
    throw new Error('AI packet output missing required fields');
  }
  return {
    coverLetter: parsed.coverLetter,
    documentChecklist: parsed.documentChecklist,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    generatedAt: new Date(),
  };
}

export async function draftCredentialingApplication(
  input: CredentialingDraftInput
): Promise<CredentialingApplicationResult> {
  const parsed = await callClaudeJson(
    buildApplicationSystemPrompt(),
    buildUserPrompt(input, 'application')
  );
  if (typeof parsed.coverLetter !== 'string' || !Array.isArray(parsed.prefilledAnswers)) {
    throw new Error('AI application output missing required fields');
  }
  return {
    coverLetter: parsed.coverLetter,
    prefilledAnswers: parsed.prefilledAnswers,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    generatedAt: new Date(),
  };
}
