/**
 * Answer weaving (clinician feedback, Kelli / Wonder Kids OT — round two).
 *
 * The documentation check asks targeted questions about gaps ("what type of
 * cues did you provide?"). Instead of hand-editing the note, the therapist
 * types the answer under the question and this service incorporates EXACTLY
 * that fact into the right SOAP section.
 *
 * Weaving rules mirror the platform's compliance charter:
 *  - The therapist's answer is the ONLY new information. No elaboration.
 *  - Everything else in the note stays as-is (minimal-diff edit, not a
 *    rewrite).
 *  - Facts land in the clinically correct section (cues/assistance →
 *    Objective; interpretation/necessity → Assessment; caregiver-reported →
 *    Subjective).
 *  - No fallback: if AI is unavailable, fail loudly — never fake a weave.
 */
import { storage } from '../storage';
import { assertPhiAiAllowed } from '../utils/phiAiGuard';
import { createAiClient, isAiConfigured } from './aiProvider';
import logger from './logger';

export interface WeaveAnswer {
  question: string;
  answer: string;
}

export interface WeaveInput {
  patientId: number;
  practiceId?: number;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  answers: WeaveAnswer[];
}

export interface WeaveResult {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  /** Human-readable summary of what changed, per section touched. */
  changes: Array<{ section: 'subjective' | 'objective' | 'assessment' | 'plan'; summary: string }>;
}

export async function weaveAnswersIntoNote(input: WeaveInput): Promise<WeaveResult> {
  assertPhiAiAllowed('SOAP answer weaving');

  const patient = await storage.getPatient(input.patientId);
  if (!patient) throw new Error('Patient not found');
  if (input.practiceId != null && (patient as any).practiceId !== input.practiceId) {
    throw new Error('Patient not found');
  }

  const answers = (input.answers ?? [])
    .filter((a) => a && typeof a.question === 'string' && typeof a.answer === 'string' && a.answer.trim())
    .map((a) => ({ question: a.question.trim().slice(0, 500), answer: a.answer.trim().slice(0, 1000) }));
  if (answers.length === 0) throw new Error('No answers provided');

  const client = isAiConfigured()
    ? createAiClient({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY })
    : null;
  if (!client) throw new Error('Answer weaving unavailable: AI is not configured');

  const prompt = `You are a pediatric therapy documentation editor performing a MINIMAL-DIFF edit. The therapist answered specific questions about gaps in this draft SOAP note. Incorporate each answer into the note.

HARD RULES:
1. The therapist's answers are the ONLY new information. Do not elaborate on
   them, quantify them, or add anything they did not state.
2. Every sentence not required to change stays EXACTLY as written — same
   wording, same order. This is an edit, not a rewrite.
3. Place each fact in the clinically correct section: assistance/cueing and
   observed performance → Objective; clinical interpretation and
   necessity/function connections → Assessment; caregiver/patient-reported
   information → Subjective; plan-of-care changes → Plan.
4. Keep the note's clinical voice: concise prose, no filler, "patient"
   suffices, no invented numbers.
5. If an answer is unusable (off-topic, empty of clinical content), skip it
   and note that in "changes" with section "assessment" and a summary
   beginning "SKIPPED:".

DRAFT NOTE:
SUBJECTIVE: ${input.subjective}
OBJECTIVE: ${input.objective}
ASSESSMENT: ${input.assessment}
PLAN: ${input.plan}

THERAPIST'S ANSWERS:
${answers.map((a, i) => `${i + 1}. Q: ${a.question}\n   A: ${a.answer}`).join('\n')}

Respond with ONLY this JSON:
{
  "subjective": "<full revised section>",
  "objective": "<full revised section>",
  "assessment": "<full revised section>",
  "plan": "<full revised section>",
  "changes": [ { "section": "subjective"|"objective"|"assessment"|"plan", "summary": "<one sentence: what was added and where>" } ]
}`;

  const response = await client.messages.create({
    model: process.env.AI_SOAP_MODEL || 'claude-sonnet-5',
    max_tokens: 3000,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn('Answer weave returned unparseable output');
    throw new Error('Answer weaving failed to produce a result');
  }
  const parsed = JSON.parse(jsonMatch[0]);

  // Every section must come back as non-empty text — a dropped section is a
  // failed weave, not a partial success.
  for (const key of ['subjective', 'objective', 'assessment', 'plan'] as const) {
    if (typeof parsed[key] !== 'string' || !parsed[key].trim()) {
      throw new Error('Answer weaving failed to produce a result');
    }
  }

  const changes = (Array.isArray(parsed.changes) ? parsed.changes : [])
    .filter(
      (c: any) =>
        c &&
        ['subjective', 'objective', 'assessment', 'plan'].includes(c.section) &&
        typeof c.summary === 'string' &&
        c.summary.trim(),
    )
    .map((c: any) => ({ section: c.section, summary: c.summary.trim() }))
    .slice(0, 12);

  return {
    subjective: parsed.subjective,
    objective: parsed.objective,
    assessment: parsed.assessment,
    plan: parsed.plan,
    changes,
  };
}
