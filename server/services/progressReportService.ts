/**
 * AI progress-report drafter (prototype, clinician request — Megan).
 *
 * Reviews a patient's signed SOAP notes and goal progress across a date range
 * and drafts a clinical PROGRESS SUMMARY (distinct from the per-session SOAP
 * note and from the patient-friendly summary). The therapist reviews and edits
 * before it is used — this only produces a draft.
 *
 * Same anti-fabrication charter as SOAP generation: it summarizes ONLY the
 * documented sessions and recorded goal progress, never invents measurements
 * or progress, and fails loudly rather than faking a report.
 */
import { storage } from '../storage';
import { assertPhiAiAllowed } from '../utils/phiAiGuard';
import { createAiClient, isAiConfigured } from './aiProvider';
import { getPatientProgress } from './patientProgressService';
import logger from './logger';

export interface ProgressReport {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export interface ProgressReportResult {
  report: ProgressReport;
  meta: { sessionsReviewed: number; from: string; to: string };
}

export async function generateProgressReport(params: {
  patientId: number;
  practiceId?: number;
  from: string;
  to: string;
}): Promise<ProgressReportResult> {
  assertPhiAiAllowed('progress report generation');

  const patient = await storage.getPatient(params.patientId);
  if (!patient) throw new Error('Patient not found');
  if (params.practiceId != null && (patient as any).practiceId !== params.practiceId) {
    throw new Error('Patient not found');
  }

  // Signed notes in range (pull a generous recent window, then filter).
  const recent = await storage.getRecentSoapNotesForPatient(
    params.patientId,
    (patient as any).practiceId,
    50,
  );
  const inRange = (recent ?? []).filter((n: any) => {
    const when = n.therapistSignedAt ?? n.createdAt;
    if (!when) return false;
    const d = new Date(when).toISOString().slice(0, 10);
    return d >= params.from && d <= params.to;
  });

  if (inRange.length === 0) {
    throw new Error('No signed notes in this date range to summarize.');
  }

  const progress = await getPatientProgress(params.patientId);

  const client = isAiConfigured()
    ? createAiClient({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY })
    : null;
  if (!client) throw new Error('Progress report is unavailable: AI is not configured');

  const trim = (s: any, n = 400) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '…' : s ?? '');
  const sessionsBlock = inRange
    .map((n: any, i: number) => {
      const when = new Date(n.therapistSignedAt ?? n.createdAt).toISOString().slice(0, 10);
      return `Session ${i + 1} (${when}):\nObjective: ${trim(n.objective)}\nAssessment: ${trim(n.assessment)}`;
    })
    .join('\n\n');

  const goalsBlock = progress.goals.length
    ? progress.goals
        .map((g) => {
          const first = g.points[0]?.value;
          const last = g.points[g.points.length - 1]?.value;
          return `- ${g.description}: ${first}% → ${last}% (${g.points.length} datapoints)`;
        })
        .join('\n')
    : '(no recorded goal-progress data)';

  const prompt = `You are a pediatric therapy clinician drafting a PROGRESS SUMMARY across multiple sessions. This is NOT a single-session note — it synthesizes the period. Follow these rules absolutely:
- Use ONLY the documented sessions and recorded goal progress below. Invent nothing: no measurements, trials, or progress not present in the data.
- Progress claims must be grounded in the recorded goal percentages or explicit session-to-session observations. If the data does not support a claim, do not make it.
- Concise clinical prose. No filler ("doing well"), no overstated causation, no emojis or decorative formatting.
- If the data is thin, write a modest summary rather than padding.

DATE RANGE: ${params.from} to ${params.to}
SESSIONS DOCUMENTED (${inRange.length}):
${sessionsBlock}

RECORDED GOAL PROGRESS (start → latest):
${goalsBlock}

Respond with ONLY this JSON:
{
  "subjective": "Caregiver/patient-reported themes across the period, only if the sessions recorded them; otherwise state that formal caregiver report was limited.",
  "objective": "What was worked on across the period and observed performance/assistance trends, grounded in the sessions. Reference goal-progress figures where provided.",
  "assessment": "Clinical interpretation of progress toward each goal over the period, tied to the recorded data. State continued barriers and why skilled therapy remains indicated, ONLY as the documented observations support.",
  "plan": "Continuation or changes to the plan of care going forward, based on the period's trend. Do not change frequency or duration unless the data explicitly indicates it."
}`;

  const response = await client.messages.create({
    model: process.env.AI_SOAP_MODEL || 'claude-sonnet-4-5',
    max_tokens: 2000,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn('Progress report returned unparseable output');
    throw new Error('Progress report failed to produce a result');
  }
  const parsed = JSON.parse(jsonMatch[0]);
  for (const k of ['subjective', 'objective', 'assessment', 'plan'] as const) {
    if (typeof parsed[k] !== 'string' || !parsed[k].trim()) {
      throw new Error('Progress report failed to produce a result');
    }
  }

  return {
    report: {
      subjective: parsed.subjective,
      objective: parsed.objective,
      assessment: parsed.assessment,
      plan: parsed.plan,
    },
    meta: { sessionsReviewed: inRange.length, from: params.from, to: params.to },
  };
}
