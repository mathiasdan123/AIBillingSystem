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
 *  Megan's follow-up refinements:
 *  - Plans are constrained to Wonder Kids reality: every session is 45
 *    minutes, individual (1:1); frequency is 1x or 2x weekly; duration
 *    defaults to 6 months (26 weeks). Baked into the prompt AND validated
 *    server-side — the system never invents other session lengths.
 *  - Goals are proposed as SHORT-TERM/LONG-TERM PAIRS: each pair targets one
 *    underlying skill, the short-term goal stepping the long-term one down
 *    (more support, fewer trials, or shorter engaged time). ~5-6 pairs.
 *  - Outline — an AI-drafted parent interview outline (patient history /
 *    referral information / parent concerns as bulleted caregiver questions
 *    drawn from the patient's intake data); the therapist's notes captured
 *    against it ground the subjective portions of the composed write-up.
 *  - Eval code — a suggested OT evaluation CPT complexity code (97165 low /
 *    97166 moderate / 97167 high) with a one-paragraph rationale grounded
 *    ONLY in the entered diagnosis/reason for referral, caregiver concerns,
 *    and documented observations. A suggestion the treating therapist
 *    reviews and decides; not wired into claim creation (follow-up).
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
  /** Always 45 — every Wonder Kids session is 45 minutes. */
  sessionLengthMinutes: number;
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
  /** Links the long-term/short-term goals of one pair (same underlying skill). */
  pairIndex?: number;
}

export interface InterviewQuestion {
  question: string;
  /** The therapist's captured notes/answers — grounds the composed write-up. */
  notes: string;
}

export interface InterviewOutlineSection {
  key: 'patientHistory' | 'referralInformation' | 'parentConcerns';
  title: string;
  questions: InterviewQuestion[];
}

export interface InterviewOutline {
  sections: InterviewOutlineSection[];
  generatedAt?: string;
}

export const OUTLINE_SECTIONS: Array<[InterviewOutlineSection['key'], string]> = [
  ['patientHistory', 'Patient history'],
  ['referralInformation', 'Referral information'],
  ['parentConcerns', 'Parent concerns'],
];

/** OT evaluation CPT complexity codes — the only three the system suggests. */
export const EVAL_CPT_CODES = ['97165', '97166', '97167'] as const;
export type EvalCptCode = (typeof EVAL_CPT_CODES)[number];

export interface EvalCodeSuggestion {
  code: EvalCptCode;
  rationale: string;
  suggestedAt?: string;
}

// Wonder Kids plan-of-care reality (Megan): every session is 45 minutes,
// 1:1; frequency is 1x or 2x weekly; duration defaults to "max date" = 6
// months. Baked into the prompt AND enforced server-side.
export const SESSION_LENGTH_MINUTES = 45;
export const PLAN_FREQUENCIES = [1, 2] as const;
export const DEFAULT_PLAN_DURATION_WEEKS = 26; // 6 months

const MAX_GOAL_PAIRS = 6;
const MAX_OUTLINE_QUESTIONS_PER_SECTION = 10;
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
 * Serialize the therapist's captured answers against the interview outline
 * as question/answer lines. Questions with no notes are omitted — only what
 * the caregiver actually reported can ground the write-up.
 */
function interviewNotesBlock(evaluation: InitialEvaluation): string | null {
  const outline = evaluation.interviewOutline as InterviewOutline | null;
  if (!outline?.sections?.length) return null;
  const lines: string[] = [];
  for (const section of outline.sections) {
    for (const q of section.questions ?? []) {
      const notes = typeof q?.notes === 'string' ? q.notes.trim() : '';
      if (!notes) continue;
      lines.push(`[${section.title}] Q: ${q.question}\nCaregiver response (therapist notes): ${notes}`);
    }
  }
  if (lines.length === 0) return null;
  return `PARENT INTERVIEW OUTLINE — CAREGIVER RESPONSES (captured by the therapist):\n${lines.join('\n')}`;
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
    interviewNotesBlock(evaluation),
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
- If the data includes caregiver responses captured against the parent interview outline, use them to ground the subjective narrative and the caregiver-concerns portions of the report — attribute them as caregiver report, exactly as captured.
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

/**
 * Validate and normalize the AI's plan proposal (also re-run on the
 * therapist's accept-with-edits). Wonder Kids constraints enforced here:
 * frequency 1x or 2x weekly; every session 45 minutes (a missing session
 * length normalizes to 45; any other value is refused — the system never
 * invents other session lengths).
 */
export function parsePlanProposal(raw: any): ProposedPlan {
  const sessionsPerWeek = asPositiveInt(raw?.sessionsPerWeek, 7);
  const durationWeeks = asPositiveInt(raw?.durationWeeks, 104);
  const startDate = asIsoDate(raw?.startDate);
  const endDate = asIsoDate(raw?.endDate);
  const rationale = asNonEmpty(raw?.rationale);
  if (!sessionsPerWeek || !durationWeeks || !startDate || !endDate || !rationale) {
    throw new Error('Plan proposal failed validation');
  }
  if (!(PLAN_FREQUENCIES as readonly number[]).includes(sessionsPerWeek)) {
    throw new Error('Plan proposal failed validation: frequency must be 1x or 2x weekly');
  }
  if (raw?.sessionLengthMinutes != null) {
    const len = asPositiveInt(raw.sessionLengthMinutes, 480);
    if (len !== SESSION_LENGTH_MINUTES) {
      throw new Error(`Plan proposal failed validation: sessions are always ${SESSION_LENGTH_MINUTES} minutes`);
    }
  }
  if (endDate <= startDate) throw new Error('Plan proposal failed validation');
  return {
    sessionsPerWeek,
    sessionLengthMinutes: SESSION_LENGTH_MINUTES,
    durationWeeks,
    startDate,
    endDate,
    rationale,
    status: 'proposed',
  };
}

function addWeeks(isoDate: string, weeks: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
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
  const goal: ProposedGoal = { skillArea, goalText, term, durationWeeks, startDate, endDate, rationale, status: 'proposed' };
  if (raw?.pairIndex != null) {
    const pairIndex = asPositiveInt(Number(raw.pairIndex) + 1, 1000);
    if (pairIndex == null) throw new Error('Goal proposal failed validation');
    goal.pairIndex = pairIndex - 1;
  }
  return goal;
}

/**
 * Validate the AI's goal-pair proposals and flatten them for storage. Each
 * pair targets ONE underlying skill: a long-term goal plus a short-term goal
 * that steps it down (increased support, fewer trials, or shorter engaged
 * time). The term enum is enforced on both halves; a pair missing either
 * half, or whose halves carry the wrong term, fails validation.
 */
export function parseGoalPairs(raw: any): ProposedGoal[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Goal proposal failed validation: expected pairs of goals');
  }
  const goals: ProposedGoal[] = [];
  raw.slice(0, MAX_GOAL_PAIRS).forEach((pair: any, pairIndex: number) => {
    const skillArea = asNonEmpty(pair?.skillArea);
    if (!skillArea || !pair?.longTerm || !pair?.shortTerm) {
      throw new Error('Goal proposal failed validation: each pair needs a skill area, a long-term goal, and a short-term goal');
    }
    // Both halves share the pair's skill area; a term that contradicts its
    // position in the pair is refused rather than silently corrected.
    if (pair.longTerm.term != null && pair.longTerm.term !== 'long_term') {
      throw new Error('Goal proposal failed validation');
    }
    if (pair.shortTerm.term != null && pair.shortTerm.term !== 'short_term') {
      throw new Error('Goal proposal failed validation');
    }
    goals.push(
      parseGoalProposal({ ...pair.longTerm, skillArea, term: 'long_term', pairIndex }),
      parseGoalProposal({ ...pair.shortTerm, skillArea, term: 'short_term', pairIndex }),
    );
  });
  return goals;
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
- Every session is exactly ${SESSION_LENGTH_MINUTES} minutes. Never propose any other session length.
- Frequency is 1 or 2 sessions per week — never more.
- The plan duration is always ${DEFAULT_PLAN_DURATION_WEEKS} weeks (6 months) — the therapist adjusts dates before accepting if needed.
- Propose goals as PAIRS. Each pair targets ONE underlying skill and contains a LONG-TERM goal plus a SHORT-TERM goal that steps the long-term goal down with either increased support (more assistance or cues), fewer trials, or shorter engaged time — same underlying skill in both. Propose 5-6 pairs the documented data supports (fewer well-grounded pairs beat speculative ones).
- Dates are YYYY-MM-DD. The plan and goals start on or after the evaluation date (${evalDate}). Each goal's endDate = startDate + its durationWeeks.
- Short-term goals typically run 8-12 weeks; long-term goals typically run the length of the plan of care.

DOCUMENTED EVALUATION DATA:
${enteredData}
${writeUp ? `\nTHERAPIST-REVIEWED EVALUATION WRITE-UP:\nObservations: ${writeUp.observations}\nAssessment: ${writeUp.assessmentResults}\n` : ''}
Respond with ONLY this JSON:
{
  "plan": {
    "sessionsPerWeek": <1 or 2>,
    "sessionLengthMinutes": ${SESSION_LENGTH_MINUTES},
    "durationWeeks": ${DEFAULT_PLAN_DURATION_WEEKS},
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "rationale": "Why this frequency, grounded in the documented findings."
  },
  "goalPairs": [
    {
      "skillArea": "Underlying skill area (e.g. fine motor control, sensory regulation)",
      "longTerm": {
        "goalText": "The full long-term goal sentence in the exact grammar above.",
        "durationWeeks": <integer>,
        "startDate": "YYYY-MM-DD",
        "endDate": "YYYY-MM-DD",
        "rationale": "Which documented concern/observation/milestone grounds this goal (assessment scores only as supporting evidence)."
      },
      "shortTerm": {
        "goalText": "The short-term goal sentence: the SAME underlying skill stepped down (more support, fewer trials, or shorter engaged time).",
        "durationWeeks": <integer>,
        "startDate": "YYYY-MM-DD",
        "endDate": "YYYY-MM-DD",
        "rationale": "Grounding, plus how this steps the long-term goal down."
      }
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

  // Validate, then normalize the AI's plan to the Wonder Kids default:
  // 45-minute 1:1 sessions at 1x/2x weekly (enforced by parsePlanProposal)
  // over a dated 6-month period. The therapist edits dates/frequency before
  // accepting; the system never proposes anything else.
  const plan = parsePlanProposal(parsed.plan);
  if (plan.durationWeeks !== DEFAULT_PLAN_DURATION_WEEKS) {
    plan.durationWeeks = DEFAULT_PLAN_DURATION_WEEKS;
    plan.endDate = addWeeks(plan.startDate, DEFAULT_PLAN_DURATION_WEEKS);
  }

  if (!Array.isArray(parsed.goalPairs) || parsed.goalPairs.length === 0) {
    throw new Error('Plan/goal proposal failed to produce goals');
  }
  const goals = parseGoalPairs(parsed.goalPairs);

  return { plan, goals };
}

// ==================== AI — PARENT INTERVIEW OUTLINE ====================

/**
 * Intake keys that must never reach the AI prompt: administrative,
 * financial, consent, and credential-adjacent material. The outline is
 * drafted from the clinical/developmental intake content only.
 */
const INTAKE_EXCLUDE_RE = /consent|signature|card|stripe|payment|insurance|token|auth|password|ssn|policy|group/i;

function serializeIntakeEntries(obj: Record<string, unknown>, prefix = '', depth = 0): string[] {
  if (depth > 2) return [];
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (INTAKE_EXCLUDE_RE.test(key)) continue;
    const label = prefix ? `${prefix}.${key}` : key;
    if (value == null) continue;
    if (typeof value === 'string') {
      const s = value.trim();
      if (s) lines.push(`${label}: ${s}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${label}: ${String(value)}`);
    } else if (Array.isArray(value)) {
      const items = value.filter((v) => typeof v === 'string' && v.trim()).map((v) => String(v).trim());
      if (items.length) lines.push(`${label}: ${items.join('; ')}`);
    } else if (typeof value === 'object') {
      lines.push(...serializeIntakeEntries(value as Record<string, unknown>, label, depth + 1));
    }
  }
  return lines;
}

/**
 * Validate and normalize the AI's interview outline. Exactly Megan's three
 * sections, each a non-empty bulleted list of caregiver questions; anything
 * off-shape throws rather than being silently repaired.
 */
export function parseInterviewOutline(raw: any): InterviewOutline {
  if (!Array.isArray(raw?.sections)) throw new Error('Interview outline failed validation');
  const byKey = new Map<string, any>();
  for (const section of raw.sections) {
    if (section?.key) byKey.set(String(section.key), section);
  }
  const sections: InterviewOutlineSection[] = OUTLINE_SECTIONS.map(([key, title]) => {
    const section = byKey.get(key);
    if (!section || !Array.isArray(section.questions) || section.questions.length === 0) {
      throw new Error('Interview outline failed validation');
    }
    const questions: InterviewQuestion[] = section.questions
      .slice(0, MAX_OUTLINE_QUESTIONS_PER_SECTION)
      .map((q: any) => {
        const question = asNonEmpty(typeof q === 'string' ? q : q?.question);
        if (!question) throw new Error('Interview outline failed validation');
        const notes = typeof q?.notes === 'string' ? q.notes : '';
        return { question, notes };
      });
    return { key, title, questions };
  });
  return { sections };
}

/**
 * Draft a parent interview outline from the patient's intake data: Megan's
 * three sections (patient history, referral information, parent concerns),
 * each a bulleted list of caregiver questions tailored to that patient.
 * Fully editable; the therapist's notes captured against it later ground
 * the subjective portions of the composed write-up.
 */
export async function draftInterviewOutline(params: {
  evaluationId: number;
  practiceId: number;
}): Promise<{ outline: InterviewOutline }> {
  assertPhiAiAllowed('parent interview outline drafting');

  const evaluation = await loadScopedEvaluation(params.evaluationId, params.practiceId);
  if (evaluation.status === 'finalized') {
    throw new Error('This evaluation is finalized; the interview outline can no longer be regenerated.');
  }

  const patient = await storage.getPatient(evaluation.patientId);
  if (!patient || patient.practiceId !== params.practiceId) {
    throw new Error('Evaluation not found');
  }

  const intake = ((patient as any).intakeData ?? {}) as Record<string, unknown>;
  const pi = (evaluation.personalInfo ?? {}) as Record<string, unknown>;
  const intakeLines = serializeIntakeEntries(intake);
  const contextBlock = [
    sectionBlock('EVALUATION CONTEXT (entered by the therapist)', [
      labelled('Child name', pi.childName),
      labelled('Date of birth / age', [pi.dateOfBirth, pi.age].filter(Boolean).join(', ')),
      labelled('Referring physician', pi.referringPhysician),
      labelled('Primary diagnosis / reason for referral', pi.primaryDiagnosis),
      labelled('School/daycare', pi.school),
    ]),
    intakeLines.length ? `PATIENT INTAKE DATA (as submitted at intake):\n${intakeLines.join('\n')}` : null,
  ]
    .filter((b): b is string => b !== null)
    .join('\n\n');

  if (!contextBlock.trim()) {
    throw new Error('Not enough intake information to draft an interview outline. Complete the patient intake or enter the personal information section first.');
  }

  const client = getAiClient();
  const prompt = `You are a pediatric occupational therapy clinician preparing a PARENT/CAREGIVER INTERVIEW OUTLINE for an initial evaluation. This is a DRAFT the evaluating therapist will review and edit. The outline has exactly three sections — patient history, referral information, parent concerns — each a bulleted list of questions to ask the caregiver. Follow these rules absolutely:
- Derive every question from the intake content below: follow up on what the family actually reported, probe gaps in areas the intake touches, and tailor wording to this child. Never invent history — a question must ask about something, not assert it; never presuppose a fact that is not in the intake data.
- If an intake area is blank, you may include a plain open question for that section (e.g. birth history), phrased without assuming any particular history.
- Open-ended, caregiver-friendly wording — plain language, no clinical jargon, no abbreviations the family would not know.
- 4-8 questions per section. The therapist's captured answers will become the subjective narrative of the evaluation write-up, so ask for concrete, reportable detail.

${contextBlock}

Respond with ONLY this JSON:
{
  "sections": [
    { "key": "patientHistory", "title": "Patient history", "questions": ["..."] },
    { "key": "referralInformation", "title": "Referral information", "questions": ["..."] },
    { "key": "parentConcerns", "title": "Parent concerns", "questions": ["..."] }
  ]
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
  const outline = parseInterviewOutline(extractJson(text, 'Interview outline'));
  outline.generatedAt = new Date().toISOString();

  return { outline };
}

// ==================== AI — SUGGESTED EVALUATION CPT CODE ====================

/** Validate the AI's evaluation-code suggestion: one of the three OT eval codes plus a rationale. */
export function parseEvalCodeSuggestion(raw: any): EvalCodeSuggestion {
  const code = typeof raw?.code === 'string' ? raw.code.trim() : '';
  const rationale = asNonEmpty(raw?.rationale);
  if (!(EVAL_CPT_CODES as readonly string[]).includes(code) || !rationale) {
    throw new Error('Evaluation code suggestion failed validation');
  }
  return { code: code as EvalCptCode, rationale };
}

/**
 * Serialize ONLY the inputs Megan named for code selection: the entered
 * diagnosis/reason for referral, the caregiver concerns, and the documented
 * clinical observations. Health history and raw assessment text stay out —
 * the suggestion must align with what the written documentation supports.
 */
export function buildEvalCodeDataBlock(evaluation: InitialEvaluation): string {
  const pi = (evaluation.personalInfo ?? {}) as Record<string, unknown>;
  const cc = (evaluation.caregiverConcerns ?? {}) as Record<string, unknown>;
  const blocks = [
    sectionBlock('DIAGNOSIS / REASON FOR REFERRAL (as entered)', [
      labelled('Primary diagnosis / reason for referral', pi.primaryDiagnosis),
      labelled('Referring physician', pi.referringPhysician),
    ]),
    sectionBlock('CAREGIVER REPORT (as entered)', [
      labelled('Primary concerns about development or daily functioning', cc.primaryConcerns),
      labelled('Activities difficult at home or school', cc.difficultActivities),
      labelled('Response to movement, touch, noise, or other sensory experiences', cc.sensoryResponses),
      labelled('Concerns with attention, following directions, transitions, completing tasks', cc.attentionConcerns),
      labelled('Concerns with handwriting, drawing, cutting, dressing, utensil use, other fine-motor tasks', cc.fineMotorConcerns),
      labelled('What they most want OT to help with', cc.otGoalsForChild),
    ]),
    sectionBlock('DOCUMENTED CLINICAL OBSERVATIONS (as entered)', [
      labelled('Objective activities and observations', evaluation.objectiveActivities),
      labelled('Overall skill areas and areas of growth/concern', evaluation.skillAreas),
    ]),
  ];
  return blocks.filter((b): b is string => b !== null).join('\n\n');
}

/**
 * Suggest ONE OT evaluation CPT complexity code — 97165 (low), 97166
 * (moderate), 97167 (high) — with a one-paragraph rationale grounded ONLY
 * in the entered diagnosis/reason for referral, caregiver concerns, and
 * documented observations. A suggestion for accuracy: the treating
 * therapist reviews and makes the final coding decision. NOT wired into
 * claim creation (explicit follow-up).
 */
export async function suggestEvaluationCode(params: {
  evaluationId: number;
  practiceId: number;
}): Promise<{ suggestion: EvalCodeSuggestion }> {
  assertPhiAiAllowed('evaluation code suggestion');

  const evaluation = await loadScopedEvaluation(params.evaluationId, params.practiceId);
  if (evaluation.status === 'finalized') {
    throw new Error('This evaluation is finalized; the code suggestion can no longer be regenerated.');
  }

  const dataBlock = buildEvalCodeDataBlock(evaluation);
  if (!dataBlock.trim()) {
    throw new Error('Not enough entered information to suggest an evaluation code. Enter the diagnosis/referral, caregiver concerns, and observations first.');
  }

  const client = getAiClient();
  const prompt = `You are assisting a pediatric occupational therapist with BILLING ACCURACY for an initial evaluation. Suggest exactly ONE occupational therapy evaluation CPT code:
- 97165 — OT evaluation, low complexity
- 97166 — OT evaluation, moderate complexity
- 97167 — OT evaluation, high complexity

Rules — follow absolutely:
- Ground the choice ONLY in the documented data below: the entered diagnosis/reason for referral, the caregiver report, and the documented clinical observations. Never assume findings, comorbidities, performance deficits, or history that are not documented.
- CPT complexity for these codes turns on the documented occupational profile and history, the number of performance deficits documented, and the clinical decision-making the documentation reflects. If the documentation is thin, suggest the LOWER code — the suggestion must align with the written documentation, not with what might be clinically true.
- This is a suggestion for documentation accuracy. The treating therapist reviews it and makes the final coding decision.
- One paragraph of rationale, citing only documented items.

${dataBlock}

Respond with ONLY this JSON:
{
  "code": "97165" | "97166" | "97167",
  "rationale": "One paragraph grounded only in the documented data above."
}`;

  const response = await client.messages.create({
    model: process.env.AI_SOAP_MODEL || 'claude-sonnet-4-5',
    max_tokens: 1000,
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  const suggestion = parseEvalCodeSuggestion(extractJson(text, 'Evaluation code suggestion'));
  suggestion.suggestedAt = new Date().toISOString();

  return { suggestion };
}
