/**
 * Progress Notes service (Wonder Kids pilot — Megan's clinical spec).
 *
 * Two jobs:
 *
 *  1. CADENCE — a progress note is due every 10 completed sessions or 90
 *     days, whichever comes first, counted from the later of the treatment
 *     plan's start date and the last FINALIZED progress note. Computed at
 *     read time per patient (no scheduler jobs).
 *
 *  2. AI DRAFTING — drafts the per-goal commentary (interventions utilized,
 *     assistance levels required, current ability), the Present Level of
 *     Functioning narrative, annual goals, and recommendations. Pattern
 *     copied from progressReportService: assertPhiAiAllowed guard,
 *     createAiClient/isAiConfigured, JSON-only parse that fails loudly.
 *     Grounded ONLY in: signed SOAP notes in the window, the goal records,
 *     per-activity assist data where present, and therapist-entered inputs.
 *     Thin data ⇒ a modest draft, never a padded one.
 *
 * PROGRESS % IS PURE THERAPIST JUDGMENT (assistance level + trials vs the
 * goal's criteria — Megan's explicit answer). The AI never estimates,
 * computes, or outputs a progress percentage; the note stores only the
 * therapist-entered figure per goal.
 */
import { storage } from '../storage';
import { assertPhiAiAllowed } from '../utils/phiAiGuard';
import { createAiClient, isAiConfigured } from './aiProvider';
import { getActivityProgress } from './activityProgressService';
import logger from './logger';
import type { ProgressNote, TreatmentGoal } from '@shared/schema';

// ==================== CADENCE ====================

export const SESSIONS_PER_PROGRESS_NOTE = 10;
export const MAX_DAYS_BETWEEN_PROGRESS_NOTES = 90;

export interface ProgressNoteCadence {
  due: boolean;
  /** What tripped due-ness: 'sessions' | 'days' | null (not due). */
  reason: 'sessions' | 'days' | null;
  /** The date counting starts from (later of plan start / last finalized
   * note; falls back to the first completed session for legacy patients). */
  anchorDate: string | null;
  completedSessionsSinceAnchor: number;
  daysSinceAnchor: number | null;
  sessionsUntilDue: number | null;
  daysUntilDue: number | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toIsoDate(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string' && DATE_RE.test(value)) return value;
  const d = new Date(value as any);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.UTC(
    Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)),
  );
  return Math.floor((to - from) / 86400000);
}

/**
 * Pure cadence math, separated for testing. `anchorDate` is the later of
 * plan start / last finalized note (already resolved by the caller).
 */
export function computeCadence(params: {
  today: string;
  anchorDate: string | null;
  completedSessionsSinceAnchor: number;
}): ProgressNoteCadence {
  const { today, anchorDate, completedSessionsSinceAnchor } = params;
  if (!anchorDate) {
    // Nothing to count from — no plan, no finalized note, no sessions yet.
    return {
      due: false,
      reason: null,
      anchorDate: null,
      completedSessionsSinceAnchor,
      daysSinceAnchor: null,
      sessionsUntilDue: null,
      daysUntilDue: null,
    };
  }
  const daysSinceAnchor = Math.max(0, daysBetween(anchorDate, today));
  const sessionsDue = completedSessionsSinceAnchor >= SESSIONS_PER_PROGRESS_NOTE;
  const daysDue = daysSinceAnchor >= MAX_DAYS_BETWEEN_PROGRESS_NOTES;
  return {
    due: sessionsDue || daysDue,
    // "whichever comes first": sessions tripping takes display precedence.
    reason: sessionsDue ? 'sessions' : daysDue ? 'days' : null,
    anchorDate,
    completedSessionsSinceAnchor,
    daysSinceAnchor,
    sessionsUntilDue: sessionsDue ? 0 : SESSIONS_PER_PROGRESS_NOTE - completedSessionsSinceAnchor,
    daysUntilDue: daysDue ? 0 : MAX_DAYS_BETWEEN_PROGRESS_NOTES - daysSinceAnchor,
  };
}

/**
 * Resolve a patient's cadence from live data. The anchor is the LATER of the
 * active plan's start date and the last finalized progress note's date; a
 * legacy patient with neither anchors on their first completed session.
 */
export async function getProgressNoteCadence(
  patientId: number,
  practiceId: number,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<ProgressNoteCadence> {
  const plan = await storage.getActiveTreatmentPlan(patientId);
  const lastNote = await storage.getLastFinalizedProgressNote(patientId, practiceId);

  const candidates = [
    toIsoDate(plan?.startDate),
    toIsoDate(lastNote?.windowEnd ?? lastNote?.finalizedAt),
  ].filter((d): d is string => d !== null);

  let anchorDate = candidates.length ? candidates.sort().at(-1)! : null;
  if (!anchorDate) {
    anchorDate = await storage.getFirstCompletedSessionDate(patientId, practiceId);
  }

  const completedSessionsSinceAnchor = anchorDate
    ? await storage.countCompletedSessionsSince(patientId, practiceId, anchorDate)
    : 0;

  return computeCadence({ today, anchorDate, completedSessionsSinceAnchor });
}

// ==================== GOAL ENTRIES ====================

export interface ProgressNoteGoalEntry {
  goalId: number;
  goalText: string;
  /** short_term | long_term | null for legacy goals without the metadata. */
  goalTerm: string | null;
  durationWeeks: number | null;
  startDate: string | null;
  endDate: string | null;
  /** THERAPIST-ENTERED, 0-100, null until the therapist records it. */
  progressPercent: number | null;
  interventions: string;
  assistanceLevels: string;
  currentAbility: string;
}

/**
 * One entry per treatment goal, carrying the goal-table columns from the
 * goal records. Legacy goals (pre-#377) have null term/duration/start —
 * carried through as null, rendered as "not recorded", never invented.
 */
export function buildGoalEntries(goals: TreatmentGoal[]): ProgressNoteGoalEntry[] {
  return goals.map((g) => ({
    goalId: g.id,
    goalText: g.description,
    goalTerm: g.goalTerm ?? null,
    durationWeeks: g.durationWeeks ?? null,
    startDate: toIsoDate(g.startDate),
    endDate: toIsoDate(g.targetDate),
    progressPercent: null,
    interventions: '',
    assistanceLevels: '',
    currentAbility: '',
  }));
}

// ==================== AI DRAFTING ====================

export interface ProgressNoteDraftSections {
  goalCommentary: Array<{
    goalId: number;
    interventions: string;
    assistanceLevels: string;
    currentAbility: string;
  }>;
  presentLevel: string;
  annualGoals: string;
  recommendations: string;
}

/** Style anchor from Megan's real (de-identified) Present Level prose. */
const PRESENT_LEVEL_STYLE_ANCHOR =
  'Patient benefits from minimal verbal cues to follow and attend to the transition routine. ' +
  'He requires initial set-up (OT facilitates quadrupod grasp) on writing supplement to prevent the use of a fisted, gross grasp. ' +
  'Such assistance is secondary to decreased fine motor strength, coordination, and endurance.';

const trim = (s: unknown, n = 500) =>
  typeof s === 'string' && s.length > n ? s.slice(0, n) + '…' : ((s as string) ?? '');

function termLabel(term: string | null): string {
  if (term === 'short_term') return 'Short Term';
  if (term === 'long_term') return 'Long Term';
  return 'not recorded';
}

export async function generateProgressNoteDraft(params: {
  noteId: number;
  practiceId: number;
}): Promise<{ draft: ProgressNoteDraftSections; meta: { sessionsReviewed: number; from: string; to: string } }> {
  assertPhiAiAllowed('progress note generation');

  const note = await storage.getProgressNote(params.noteId, params.practiceId);
  if (!note) throw new Error('Progress note not found');
  if (note.status === 'finalized') {
    throw new Error('This progress note is finalized and can no longer be regenerated.');
  }
  if (!note.windowStart || !note.windowEnd) {
    throw new Error('Progress note is missing its reporting window');
  }

  const entries = (note.goalEntries ?? []) as ProgressNoteGoalEntry[];
  if (entries.length === 0) {
    throw new Error('This note has no treatment goals to review. Add goals to the treatment plan first.');
  }

  const from = toIsoDate(note.windowStart)!;
  const to = toIsoDate(note.windowEnd)!;

  const signedNotes = await storage.getSignedSoapNotesInRange(note.patientId, params.practiceId, from, to);
  if (signedNotes.length === 0) {
    throw new Error('No signed session notes in this reporting window to ground the draft.');
  }

  const client = isAiConfigured()
    ? createAiClient({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY })
    : null;
  if (!client) throw new Error('Progress note drafting is unavailable: AI is not configured');

  const sessionsBlock = signedNotes
    .map((n: any, i: number) => {
      const when = toIsoDate(n.sessionDate ?? n.therapistSignedAt) ?? '';
      const parts = [
        `Session ${i + 1} (${when}):`,
        n.objective ? `Objective: ${trim(n.objective)}` : null,
        n.assessment ? `Assessment: ${trim(n.assessment)}` : null,
      ].filter(Boolean);
      return parts.join('\n');
    })
    .join('\n\n');

  const goalsBlock = entries
    .map((e, i) => {
      const lines = [
        `Goal ${i + 1} (id ${e.goalId}): ${e.goalText}`,
        `  Term: ${termLabel(e.goalTerm)} | Duration: ${e.durationWeeks != null ? `${e.durationWeeks} weeks` : 'not recorded'} | Start: ${e.startDate ?? 'not recorded'} | Target end: ${e.endDate ?? 'not recorded'}`,
      ];
      if (e.progressPercent != null) {
        lines.push(`  Therapist-entered progress: ${e.progressPercent}% (the therapist's clinical judgment — report it verbatim if referenced, never adjust it)`);
      }
      return lines.join('\n');
    })
    .join('\n');

  // Per-activity assist levels recorded on signed notes in the window.
  const activitySeries = await getActivityProgress(note.patientId).catch(() => []);
  const activityBlock = activitySeries
    .map((a) => {
      const inWindow = a.points.filter((p) => {
        const d = p.date.slice(0, 10);
        return d >= from && d <= to;
      });
      if (inWindow.length === 0) return null;
      const pts = inWindow.map((p) => `${p.date.slice(0, 10)}: ${p.level}`).join('; ');
      return `- ${a.activityName}: ${pts}`;
    })
    .filter((s): s is string => s !== null)
    .join('\n');

  const prompt = `You are a pediatric occupational therapy clinician drafting a formal PROGRESS NOTE covering ${from} to ${to}. The treating therapist reviews, edits, and approves every word — this is a DRAFT. Follow these rules absolutely:
- Use ONLY the documented data below: the signed session notes, the goal records, the recorded per-activity assistance levels, and the therapist-entered inputs. Never invent progress, measurements, trials, abilities, or observations that are not present.
- PROGRESS PERCENTAGES ARE THE THERAPIST'S CLINICAL JUDGMENT, NOT YOURS. Never state, estimate, or imply a numeric progress percentage except a therapist-entered figure provided below, repeated verbatim.
- If the documented data for a goal is thin, write a modest, honest commentary (what was documented, nothing more) rather than padding.
- Dense, specific clinical prose in the style of this anchor (specific observed abilities, assistance levels, and the clinical reasoning connecting them): "${PRESENT_LEVEL_STYLE_ANCHOR}"
- No filler ("doing well"), no overstated causation, no emojis or decorative formatting.
- This practice offers 45-minute individual (1:1) sessions at 1x or 2x weekly ONLY. Recommendations must stay within that service model and must not change frequency or duration unless the documented data indicates it.

TREATMENT GOALS UNDER REVIEW (every goal must be addressed):
${goalsBlock}

SIGNED SESSION NOTES IN WINDOW (${signedNotes.length}):
${sessionsBlock}

RECORDED PER-ACTIVITY ASSISTANCE LEVELS IN WINDOW:
${activityBlock || '(none recorded)'}

Respond with ONLY this JSON (one goalCommentary entry per goal, using the goal ids above):
{
  "goalCommentary": [
    {
      "goalId": <goal id>,
      "interventions": "Interventions utilized to target this goal, drawn only from the documented sessions.",
      "assistanceLevels": "Assistance levels required, exactly as documented (cue types, physical assistance, set-up).",
      "currentAbility": "Current ability on this goal's task as the documented sessions support — no invented trials or measurements."
    }
  ],
  "presentLevel": "Present Level of Functioning narrative synthesizing the period: observed abilities, assistance levels required, and the clinical reasoning connecting them, grounded only in the documented sessions.",
  "annualGoals": "Brief numbered list (plain text, '1. ...' per line) of the continuing goals, restating the documented treatment goals — do not write new goals.",
  "recommendations": "Recommended frequency/duration/1:1 within the 45-minute 1x-2x weekly model, and why continued skilled therapy is indicated, grounded only in the documented barriers and assistance needs."
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
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn('Progress note draft returned unparseable output');
    throw new Error('Progress note draft failed to produce a result');
  }
  const parsed = JSON.parse(jsonMatch[0]);

  for (const k of ['presentLevel', 'annualGoals', 'recommendations'] as const) {
    if (typeof parsed[k] !== 'string' || !parsed[k].trim()) {
      throw new Error('Progress note draft failed to produce a result');
    }
  }
  if (!Array.isArray(parsed.goalCommentary)) {
    throw new Error('Progress note draft failed to produce a result');
  }
  const byGoalId = new Map<number, any>();
  for (const c of parsed.goalCommentary) {
    if (typeof c?.goalId === 'number') byGoalId.set(c.goalId, c);
  }
  // EVERY goal must be reviewed — a draft that skips one fails loudly
  // rather than shipping a note with silent gaps.
  const goalCommentary = entries.map((e) => {
    const c = byGoalId.get(e.goalId);
    const ok =
      c &&
      ['interventions', 'assistanceLevels', 'currentAbility'].every(
        (k) => typeof c[k] === 'string' && c[k].trim(),
      );
    if (!ok) {
      throw new Error('Progress note draft failed to produce a result');
    }
    return {
      goalId: e.goalId,
      interventions: c.interventions,
      assistanceLevels: c.assistanceLevels,
      currentAbility: c.currentAbility,
    };
  });

  return {
    draft: {
      goalCommentary,
      presentLevel: parsed.presentLevel,
      annualGoals: parsed.annualGoals,
      recommendations: parsed.recommendations,
    },
    meta: { sessionsReviewed: signedNotes.length, from, to },
  };
}
