/**
 * Initial Evaluation AI service (Wonder Kids pilot — Megan).
 *
 * Two AI assists, both DRAFTS the therapist reviews, edits and approves:
 *
 *  Step 1 — compose: turn the therapist's structured eval sections into a
 *  formal SOAP-style evaluation write-up. Anti-fabrication charter: use ONLY
 *  the entered data — never invent observations, scores, or history; a blank
 *  section is reported as not assessed, not filled in.
 *
 *  Step 2 — propose: draft a plan of care (sessions/week over a dated
 *  period) and treatment goals in the practice's exact goal grammar. Goals
 *  are grounded in parent concerns / reason for referral + the documented
 *  clinical observations + developmental milestones, with assessment scores
 *  only as supporting rationale. Everything is returned as PROPOSALS — the
 *  therapist accepts/edits/rejects each one, and only accepted items are
 *  written into the existing treatment_plans / treatment_goals model.
 *
 * Pattern copied from progressReportService: assertPhiAiAllowed guard,
 * createAiClient/isAiConfigured (Bedrock in prod handles the BAA),
 * JSON-only response parsing that fails loudly rather than fabricating.
 */
import { storage } from '../storage';
import { assertPhiAiAllowed } from '../utils/phiAiGuard';
import { createAiClient, isAiConfigured } from './aiProvider';
import logger from './logger';
import type { InitialEvaluation } from '@shared/schema';

export interface EvaluationWriteUp {
  patientHistory: string;
  reasonForEvaluation: string;
  observations: string;
  assessmentResults: string;
  proposedPlanOfCare: string;
  goals: string;
}

export const WRITE_UP_SECTIONS = [
  'patientHistory',
  'reasonForEvaluation',
  'observations',
  'assessmentResults',
  'proposedPlanOfCare',
  'goals',
] as const;

export interface ProposedPlan {
  sessionsPerWeek: number;
  durationWeeks: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  rationale: string;
  status: 'proposed' | 'accepted' | 'rejected';
}

export interface ProposedGoal {
  skillArea: string;
  goalText: string;
  term: 'short_term' | 'long_term';
  durationWeeks: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  rationale: string;
  status: 'proposed' | 'accepted' | 'rejected';
  acceptedGoalId?: number;
}

const MAX_GOALS = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Megan's exact goal grammar + her three style anchors (few-shot). */
export const GOAL_GRAMMAR =
  'Patient will improve (UNDERLYING SKILL AREA) as evidenced by (SPECIFIC TASK PERFORMANCE) with (ASSISTANCE LEVELS) in x/x trials to improve independence with (FUNCTIONAL SKILL).';

export const GOAL_STYLE_ANCHORS = [
  'Patient will increase sensory regulation by engaging in a structured vestibular or proprioceptive activity (swinging, crawling, or heavy work) for at least 3 minutes, resulting in a calmer affect and smoother transition to the next task, in 4 out of 5 sessions.',
  'Patient will don ankle socks, once properly oriented (right-side out), with minimal verbal and/or tactile cues, in 4 out of 5 trials, to improve independence with dressing and self-care skills.',
  'Within 6 months, Patient will demonstrate improved fine motor control by maintaining a functional tripod or quadrupod grasp on a writing utensil, during a 3-minute pre-writing or coloring activity, with minimal verbal and visual cues, in 3/4 trials.',
];

function labelled(label: string, value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return `${label}: ${s}`;
}

function sectionBlock(title: string, fields: Array<string | null>): string | null {
  const present = fields.filter((f): f is string => f !== null);
  if (present.length === 0) return null;
  return `${title}:\n${present.join('\n')}`;
}

/**
 * Serialize ONLY the entered eval data into the prompt. Blank fields are
 * omitted entirely so the model cannot "complete" them; the prompt charter
 * tells it to report missing areas as not assessed.
 */
export function buildEnteredDataBlock(evaluation: InitialEvaluation): string {
  const pi = (evaluation.personalInfo ?? {}) as Record<string, unknown>;
  const hh = (evaluation.healthHistory ?? {}) as Record<string, unknown>;
  const cc = (evaluation.caregiverConcerns ?? {}) as Record<string, unknown>;

  const blocks = [
    sectionBlock('PERSONAL INFORMATION', [
      labelled('Child name', pi.childName),
      labelled('Date of birth / age', [pi.dateOfBirth, pi.age].filter(Boolean).join(', ')),
      labelled('Date of evaluation', evaluation.evaluationDate),
      labelled('Parent/caregiver present', pi.caregiverPresent),
      labelled('Referring physician', pi.referringPhysician),
      labelled('Primary diagnosis / reason for referral', pi.primaryDiagnosis),
      labelled('School/daycare', pi.school),
      labelled('Grade/classroom', pi.gradeClassroom),
    ]),
    sectionBlock('HEALTH HISTORY (as entered by the therapist)', [
      labelled('Medical/developmental history', hh.medicalHistory),
      labelled('Birth history', hh.birthHistory),
      labelled('Developmental milestones', hh.developmentalMilestones),
      labelled('Relevant diagnoses', hh.diagnoses),
      labelled('Current medications', hh.medications),
      labelled('Allergies', hh.allergies),
      labelled('Vision/hearing concerns', hh.visionHearing),
      labelled('Previous/current therapies', hh.previousTherapies),
      labelled('Hospitalizations, surgeries, or injuries', hh.hospitalizations),
      labelled('Sleep, feeding, toileting, or other daily-function areas', hh.dailyFunction),
      labelled('Other pertinent health information', hh.other),
    ]),
    sectionBlock('PARENT/CAREGIVER INTERVIEW (as reported)', [
      labelled('Primary concerns about development or daily functioning', cc.primaryConcerns),
      labelled('Activities difficult at home or school', cc.difficultActivities),
      labelled('Response to movement, touch, noise, or other sensory experiences', cc.sensoryResponses),
      labelled('Concerns with attention, following directions, transitions, completing tasks', cc.attentionConcerns),
      labelled('Concerns with handwriting, drawing, cutting, dressing, utensil use, other fine-motor tasks', cc.fineMotorConcerns),
      labelled('Activities the child enjoys or does well', cc.enjoysAndStrengths),
      labelled('What they most want OT to help with', cc.otGoalsForChild),
    ]),
    sectionBlock('SUBJECTIVE COMMENTS (patient and parents)', [
      labelled('Comments', evaluation.subjectiveComments),
    ]),
    sectionBlock('OBJECTIVE ACTIVITIES (what was done; observed ability/skills/deficits)', [
      labelled('Activities and observations', evaluation.objectiveActivities),
    ]),
    sectionBlock('ASSESSMENT RESULTS AND EXPLANATION (as entered)', [
      labelled('Results', evaluation.assessmentResults),
    ]),
    sectionBlock('OVERALL SKILL AREAS AND AREAS OF GROWTH/CONCERN', [
      labelled('Skill areas', evaluation.skillAreas),
    ]),
  ];

  return blocks.filter((b): b is string => b !== null).join('\n\n');
}

function hasComposableContent(evaluation: InitialEvaluation): boolean {
  const cc = (evaluation.caregiverConcerns ?? {}) as Record<string, unknown>;
  const hh = (evaluation.healthHistory ?? {}) as Record<string, unknown>;
  const anyText = (obj: Record<string, unknown>) =>
    Object.values(obj).some((v) => typeof v === 'string' && v.trim().length > 0);
  return Boolean(
    (evaluation.objectiveActivities && evaluation.objectiveActivities.trim()) ||
      (evaluation.assessmentResults && evaluation.assessmentResults.trim()) ||
      (evaluation.subjectiveComments && evaluation.subjectiveComments.trim()) ||
      (evaluation.skillAreas && evaluation.skillAreas.trim()) ||
      anyText(cc) ||
      anyText(hh),
  );
}

async function loadScopedEvaluation(evaluationId: number, practiceId: number): Promise<InitialEvaluation> {
  const evaluation = await storage.getInitialEvaluation(evaluationId, practiceId);
  // Storage scopes by practiceId, so a cross-practice id is simply not found.
  if (!evaluation) throw new Error('Evaluation not found');
  return evaluation;
}

function getAiClient() {
  const client = isAiConfigured()
    ? createAiClient({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY })
    : null;
  if (!client) throw new Error('Evaluation drafting is unavailable: AI is not configured');
  return client;
}

function extractJson(text: string, context: string): any {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn(`${context} returned unparseable output`);
    throw new Error(`${context} failed to produce a result`);
  }
  return JSON.parse(jsonMatch[0]);
}

// ==================== AI STEP 1 — COMPOSE WRITE-UP ====================

export async function composeEvaluationWriteUp(params: {
  evaluationId: number;
  practiceId: number;
}): Promise<{ writeUp: EvaluationWriteUp }> {
  assertPhiAiAllowed('evaluation write-up composition');

  const evaluation = await loadScopedEvaluation(params.evaluationId, params.practiceId);
  if (evaluation.status === 'finalized') {
    throw new Error('This evaluation is finalized and can no longer be recomposed.');
  }
  if (!hasComposableContent(evaluation)) {
    throw new Error('Not enough entered information to compose a write-up. Fill in the evaluation sections first.');
  }

  const client = getAiClient();
  const enteredData = buildEnteredDataBlock(evaluation);

  const prompt = `You are a pediatric occupational therapy clinician composing a formal INITIAL EVALUATION report (SOAP-style) from the therapist's structured evaluation notes below. This is a DRAFT the evaluating therapist will review, edit, and approve — accuracy over polish. Follow these rules absolutely:
- Use ONLY the entered data below. Never invent observations, standardized test scores, medical history, milestones, quotes, or any detail not present in the data.
- If an area was not entered, state plainly that it was not assessed or not reported — do not fill it in.
- Report assessment results exactly as entered; do not add scores, percentiles, or interpretations beyond what the therapist wrote.
- Professional clinical prose. No filler, no overstated causation, no emojis or decorative formatting.
- The proposed plan of care in this report is a narrative recommendation grounded in the documented findings; do not state a session frequency or duration unless the therapist entered one.

THERAPIST-ENTERED EVALUATION DATA:
${enteredData}

Respond with ONLY this JSON:
{
  "patientHistory": "Patient history narrative drawn from the entered personal information and health history.",
  "reasonForEvaluation": "Reason for referral/evaluation, grounded in the entered referral information and parent/caregiver concerns.",
  "observations": "Observations and clinical judgments from the documented eval-session activities — what was done and the observed ability, skills, and deficits.",
  "assessmentResults": "Assessment results and explanation, restating only the entered results.",
  "proposedPlanOfCare": "Narrative plan-of-care recommendation grounded in the documented findings.",
  "goals": "Narrative summary of the areas treatment goals should address, grounded in the documented concerns and observations."
}`;

  const response = await client.messages.create({
    model: process.env.AI_SOAP_MODEL || 'claude-sonnet-4-5',
    max_tokens: 3000,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  const parsed = extractJson(text, 'Evaluation write-up');

  for (const k of WRITE_UP_SECTIONS) {
    if (typeof parsed[k] !== 'string' || !parsed[k].trim()) {
      throw new Error('Evaluation write-up failed to produce a result');
    }
  }

  const writeUp: EvaluationWriteUp = {
    patientHistory: parsed.patientHistory,
    reasonForEvaluation: parsed.reasonForEvaluation,
    observations: parsed.observations,
    assessmentResults: parsed.assessmentResults,
    proposedPlanOfCare: parsed.proposedPlanOfCare,
    goals: parsed.goals,
  };

  return { writeUp };
}

// ==================== AI STEP 2 — PROPOSE PLAN + GOALS ====================

function asPositiveInt(value: unknown, max: number): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < 1 || i > max) return null;
  return i;
}

function asIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : value;
}

function asNonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s ? s : null;
}

/** Validate and normalize the AI's plan proposal. Throws on anything off-shape. */
export function parsePlanProposal(raw: any): ProposedPlan {
  const sessionsPerWeek = asPositiveInt(raw?.sessionsPerWeek, 7);
  const durationWeeks = asPositiveInt(raw?.durationWeeks, 104);
  const startDate = asIsoDate(raw?.startDate);
  const endDate = asIsoDate(raw?.endDate);
  const rationale = asNonEmpty(raw?.rationale);
  if (!sessionsPerWeek || !durationWeeks || !startDate || !endDate || !rationale) {
    throw new Error('Plan proposal failed validation');
  }
  if (endDate <= startDate) throw new Error('Plan proposal failed validation');
  return { sessionsPerWeek, durationWeeks, startDate, endDate, rationale, status: 'proposed' };
}

/** Validate and normalize one proposed goal. Throws on anything off-shape. */
export function parseGoalProposal(raw: any): ProposedGoal {
  const skillArea = asNonEmpty(raw?.skillArea);
  const goalText = asNonEmpty(raw?.goalText);
  const term = raw?.term === 'short_term' || raw?.term === 'long_term' ? raw.term : null;
  const durationWeeks = asPositiveInt(raw?.durationWeeks, 104);
  const startDate = asIsoDate(raw?.startDate);
  const endDate = asIsoDate(raw?.endDate);
  const rationale = asNonEmpty(raw?.rationale);
  if (!skillArea || !goalText || !term || !durationWeeks || !startDate || !endDate || !rationale) {
    throw new Error('Goal proposal failed validation');
  }
  if (endDate <= startDate) throw new Error('Goal proposal failed validation');
  return { skillArea, goalText, term, durationWeeks, startDate, endDate, rationale, status: 'proposed' };
}

export async function proposePlanAndGoals(params: {
  evaluationId: number;
  practiceId: number;
}): Promise<{ plan: ProposedPlan; goals: ProposedGoal[] }> {
  assertPhiAiAllowed('evaluation plan/goal proposal');

  const evaluation = await loadScopedEvaluation(params.evaluationId, params.practiceId);
  if (evaluation.status === 'finalized') {
    throw new Error('This evaluation is finalized; proposals can no longer be regenerated.');
  }
  if (!hasComposableContent(evaluation)) {
    throw new Error('Not enough entered information to propose a plan and goals. Fill in the evaluation sections first.');
  }

  const client = getAiClient();
  const enteredData = buildEnteredDataBlock(evaluation);
  const writeUp = evaluation.aiWriteUp as EvaluationWriteUp | null;
  const evalDate = evaluation.evaluationDate || new Date().toISOString().slice(0, 10);

  const prompt = `You are a pediatric occupational therapy clinician drafting a PROPOSED plan of care and treatment goals from an initial evaluation. Every item you produce is a PROPOSAL — the evaluating therapist accepts, edits, or rejects each one and makes every final clinical decision. Follow these rules absolutely:
- Ground every goal in the parent/caregiver concerns and reason for referral, the documented clinical observations, and the documented developmental milestones. Use assessment scores ONLY as supporting rationale, never as the sole basis for a goal.
- Use ONLY the documented data below. Never invent observations, scores, history, or deficits that are not present.
- Propose only goals the documented data supports. Fewer well-grounded goals beat many speculative ones.
- Write every goal in EXACTLY this grammar:
  "${GOAL_GRAMMAR}"
- Style anchors — match this voice and specificity:
  1. "${GOAL_STYLE_ANCHORS[0]}"
  2. "${GOAL_STYLE_ANCHORS[1]}"
  3. "${GOAL_STYLE_ANCHORS[2]}"
- All sessions are individual (1:1) — this practice does not run group sessions. Do not propose a group format or group size.
- Dates are YYYY-MM-DD. The plan and goals start on or after the evaluation date (${evalDate}). Each goal's endDate = startDate + its durationWeeks.
- Short-term goals typically run 8-12 weeks; long-term goals typically run the length of the plan of care.

DOCUMENTED EVALUATION DATA:
${enteredData}
${writeUp ? `\nTHERAPIST-REVIEWED EVALUATION WRITE-UP:\nObservations: ${writeUp.observations}\nAssessment: ${writeUp.assessmentResults}\n` : ''}
Respond with ONLY this JSON:
{
  "plan": {
    "sessionsPerWeek": <integer 1-7>,
    "durationWeeks": <integer>,
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "rationale": "Why this frequency and duration, grounded in the documented findings."
  },
  "goals": [
    {
      "skillArea": "Underlying skill area (e.g. fine motor control, sensory regulation)",
      "goalText": "The full goal sentence in the exact grammar above.",
      "term": "short_term" | "long_term",
      "durationWeeks": <integer>,
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "rationale": "Which documented concern/observation/milestone grounds this goal (assessment scores only as supporting evidence)."
    }
  ]
}`;

  const response = await client.messages.create({
    model: process.env.AI_SOAP_MODEL || 'claude-sonnet-4-5',
    max_tokens: 4000,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  const parsed = extractJson(text, 'Plan/goal proposal');

  const plan = parsePlanProposal(parsed.plan);
  if (!Array.isArray(parsed.goals) || parsed.goals.length === 0) {
    throw new Error('Plan/goal proposal failed to produce goals');
  }
  const goals = parsed.goals.slice(0, MAX_GOALS).map(parseGoalProposal);

  return { plan, goals };
}
