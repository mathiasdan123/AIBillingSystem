/**
 * Pre-sign documentation check (clinician feedback, Kelli / Wonder Kids OT).
 *
 * Reviews a drafted SOAP note for the elements payers look for — skilled
 * intervention, patient response, goal linkage, functional relevance,
 * assistance/cueing specificity, and skilled-therapist involvement — and
 * returns a pass/warn checklist plus TARGETED QUESTIONS for the therapist.
 *
 * The cardinal rule mirrors the platform's compliance charter: when something
 * is missing, ASK the therapist — never fill the gap with invented content.
 * This service therefore has no fallback generation: if AI is unavailable,
 * it fails loudly rather than rubber-stamping a note.
 */
import { storage } from '../storage';
import { assertPhiAiAllowed } from '../utils/phiAiGuard';
import { createAiClient, isAiConfigured } from './aiProvider';
import logger from './logger';

export interface DocCheckItem {
  /** One of the fixed check categories below. */
  item: string;
  status: 'pass' | 'warn';
  /** One sentence: what supports the pass, or what exactly is unclear. */
  detail: string;
}

export interface DocCheckResult {
  checks: DocCheckItem[];
  /** Targeted questions for the therapist, one per gap. Empty when all pass. */
  questions: string[];
}

export const DOC_CHECK_CATEGORIES = [
  'Skilled intervention documented',
  'Patient response documented',
  'Connection to an active goal',
  'Functional relevance documented',
  'Assistance/cueing specificity',
  'Skilled therapist involvement supported',
] as const;

export interface SoapDocCheckInput {
  patientId: number;
  practiceId?: number;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  /** Optional per-activity therapist narratives, for context. */
  activityDetails?: Array<{ name: string; response?: string }>;
}

export async function runSoapDocCheck(input: SoapDocCheckInput): Promise<DocCheckResult> {
  assertPhiAiAllowed('SOAP documentation check');

  const patient = await storage.getPatient(input.patientId);
  if (!patient) throw new Error('Patient not found');
  if (input.practiceId != null && (patient as any).practiceId !== input.practiceId) {
    throw new Error('Patient not found');
  }

  // Active goals ground the "connection to an active goal" check in the
  // chart's real goals rather than the model's imagination.
  let goals: any[] = [];
  try {
    const plan = await storage.getActiveTreatmentPlan(input.patientId);
    if (plan) goals = await storage.getTreatmentGoals(plan.id);
  } catch {
    // No plan — the goal check will warn, which is the correct outcome.
  }

  const client = isAiConfigured() ? createAiClient({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY }) : null;
  if (!client) {
    throw new Error('Documentation check unavailable: AI is not configured');
  }

  const prompt = `You are a pediatric therapy documentation reviewer. Review this DRAFT SOAP note strictly against the checklist. You are a reviewer, NOT a writer: never supply missing content, never suggest wording that adds facts, never assume anything not written in the note. When an element is missing or unclear, mark it "warn" and pose one targeted question the therapist can answer from memory of the session.

ACTIVE TREATMENT GOALS ON FILE:
${goals.length > 0 ? goals.map((g: any) => `- ${g.description} (status: ${g.status})`).join('\n') : '(none on file — the goal-connection check must warn and the question should ask which goal this session addressed)'}

${input.activityDetails?.some(a => a.response) ? `THERAPIST'S PER-ACTIVITY ACCOUNTS (session input, for context):\n${input.activityDetails.filter(a => a.response).map(a => `- ${a.name}: "${a.response}"`).join('\n')}\n` : ''}
DRAFT NOTE:
SUBJECTIVE: ${input.subjective}
OBJECTIVE: ${input.objective}
ASSESSMENT: ${input.assessment}
PLAN: ${input.plan}

CHECKLIST — evaluate exactly these six, in this order:
${DOC_CHECK_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Category guidance:
1. Skilled intervention: does the note name what the therapist actually DID (techniques, grading, cueing), not just activities the child played?
2. Patient response: is there a documented response/change to the intervention (before → after), not just participation?
3. Goal connection: does the note tie the session to one of the ACTIVE GOALS ON FILE above (or, if none on file, explicitly state the goal area)?
4. Functional relevance: does the note connect performance to daily function/participation?
5. Assistance/cueing: are assistance levels or cue types stated specifically enough to reproduce (e.g. "moderate verbal cues"), for the key activities?
6. Skilled involvement: would a reviewer see why a skilled therapist (not a parent or aide) was required?

Respond with ONLY this JSON:
{
  "checks": [ { "item": "<category verbatim>", "status": "pass"|"warn", "detail": "<one sentence>" } ],
  "questions": [ "<one targeted question per warn — asks the therapist for the missing fact; never proposes an answer>" ]
}`;

  const response = await client.messages.create({
    model: process.env.AI_SOAP_MODEL || 'claude-sonnet-5',
    max_tokens: 1200,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn('Doc check returned unparseable output');
    throw new Error('Documentation check failed to produce a result');
  }
  const parsed = JSON.parse(jsonMatch[0]);

  // Harden the shape: exactly the six known categories, statuses coerced,
  // questions as strings. Anything malformed becomes a warn, not a silent pass.
  const byItem = new Map(
    (Array.isArray(parsed.checks) ? parsed.checks : [])
      .filter((c: any) => c && typeof c.item === 'string')
      .map((c: any) => [c.item, c]),
  );
  const checks: DocCheckItem[] = DOC_CHECK_CATEGORIES.map((category) => {
    const c: any = byItem.get(category);
    return {
      item: category,
      status: c?.status === 'pass' ? 'pass' : 'warn',
      detail:
        typeof c?.detail === 'string' && c.detail.trim()
          ? c.detail.trim()
          : 'The reviewer could not evaluate this element.',
    };
  });
  const questions: string[] = (Array.isArray(parsed.questions) ? parsed.questions : [])
    .filter((q: any) => typeof q === 'string' && q.trim())
    .map((q: string) => q.trim())
    .slice(0, 8);

  return { checks, questions };
}
