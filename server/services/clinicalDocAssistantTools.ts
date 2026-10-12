/**
 * Shared data layer for the clinical-documentation assistant tools:
 * Initial Evaluations (PR #377/#382) and Progress Notes v2 (PR #381).
 *
 * Both assistant surfaces — the in-app Blanche dispatcher
 * (server/routes/ai-assistant.ts) and the MCP server
 * (server/mcp/tools/clinical.ts) — call THESE functions, so the two
 * surfaces return byte-identical shapes and share one set of tenant
 * guards. Pattern follows bulkEligibilityService / underpaymentReviewService:
 * logic lives in a service so the MCP layer never imports the route module.
 *
 * Tenant isolation: every function takes practiceId and fails with a plain
 * "not found" Error for cross-tenant ids — the same message as a genuinely
 * missing row, so an out-of-practice id cannot be probed for existence.
 *
 * Deliberate scope limit (clinical sign-off stays in the app): these tools
 * READ evaluations/progress notes and can START a draft evaluation. There
 * are intentionally NO assistant tools to accept proposed plans/goals,
 * finalize an evaluation or progress note, or enter a goal progress % —
 * those are the treating therapist's clinical sign-off decisions and belong
 * in the UI where the full record is visible (see blancheToolParity.test.ts).
 */

import { storage } from '../storage';
import {
  getProgressNoteCadence,
  SESSIONS_PER_PROGRESS_NOTE,
  MAX_DAYS_BETWEEN_PROGRESS_NOTES,
  type ProgressNoteGoalEntry,
} from './progressNoteService';
import type { InitialEvaluation, Patient, ProgressNote } from '@shared/schema';

/**
 * Keep narrative text chat-sized. 800 chars per section is enough for an
 * assistant to summarize or quote from; the full text lives in the app.
 * (Same idea as the 600-char trim on get_prior_session_notes — evaluation
 * write-ups run longer, so the budget is a bit larger.)
 */
const SECTION_TRIM = 800;
const trim = (s: unknown): unknown =>
  typeof s === 'string' && s.length > SECTION_TRIM ? `${s.slice(0, SECTION_TRIM)}…` : s;

/** Patient lookup scoped to the practice. Throws the same "not found" for a
 * missing id and a cross-tenant id. */
async function requirePracticePatient(patientId: number, practiceId: number): Promise<Patient> {
  if (!Number.isFinite(patientId)) {
    throw new Error('patientId is required and must be a number');
  }
  const patient = await storage.getPatient(patientId);
  if (!patient || (patient as any).practiceId !== practiceId) {
    throw new Error(`Patient ${patientId} not found`);
  }
  return patient;
}

function patientLabel(patient: Patient) {
  return { id: patient.id, name: `${patient.firstName} ${patient.lastName}`.trim() };
}

// ==================== INITIAL EVALUATIONS ====================

function evaluationListRow(e: InitialEvaluation) {
  return {
    evaluationId: e.id,
    evaluationDate: e.evaluationDate,
    status: e.status, // draft | composed | finalized
    // The treatment plan the accepted proposals landed in (null until the
    // therapist accepts the plan of care in the app).
    treatmentPlanId: e.treatmentPlanId,
    evalCodeFinal: e.evalCodeFinal,
    composedAt: e.composedAt,
    proposedAt: e.proposedAt,
    finalizedAt: e.finalizedAt,
    createdAt: e.createdAt,
  };
}

/** get_patient_evaluations — list a patient's initial evaluations. */
export async function listPatientEvaluationsForAssistant(patientId: number, practiceId: number) {
  const patient = await requirePracticePatient(patientId, practiceId);
  const evaluations = await storage.getPatientInitialEvaluations(patientId, practiceId);
  return {
    patient: patientLabel(patient),
    evaluationCount: evaluations.length,
    evaluations: evaluations.map(evaluationListRow),
    message:
      evaluations.length === 0
        ? `No initial evaluations on file for ${patient.firstName}.`
        : `Found ${evaluations.length} initial evaluation${evaluations.length === 1 ? '' : 's'} for ${patient.firstName}.`,
  };
}

/** get_initial_evaluation — one evaluation's full content. */
export async function getEvaluationForAssistant(evaluationId: number, practiceId: number) {
  if (!Number.isFinite(evaluationId)) {
    throw new Error('evaluationId is required and must be a number');
  }
  // Practice-scoped read: a cross-tenant id returns undefined → "not found".
  const evaluation = await storage.getInitialEvaluation(evaluationId, practiceId);
  if (!evaluation) throw new Error(`Evaluation ${evaluationId} not found`);
  const patient = await storage.getPatient(evaluation.patientId);

  const writeUp = evaluation.aiWriteUp as Record<string, unknown> | null;
  const proposedGoals = (evaluation.proposedGoals ?? []) as Array<Record<string, unknown>>;

  return {
    evaluationId: evaluation.id,
    patient: patient ? patientLabel(patient) : { id: evaluation.patientId, name: null },
    evaluationDate: evaluation.evaluationDate,
    status: evaluation.status, // draft | composed | finalized
    // Structured input sections (therapist-entered / prefilled from intake).
    sections: {
      personalInfo: evaluation.personalInfo,
      healthHistory: evaluation.healthHistory,
      caregiverConcerns: evaluation.caregiverConcerns,
      subjectiveComments: trim(evaluation.subjectiveComments),
      objectiveActivities: trim(evaluation.objectiveActivities),
      assessmentResults: trim(evaluation.assessmentResults),
      skillAreas: trim(evaluation.skillAreas),
    },
    interviewOutline: evaluation.interviewOutline,
    // AI step 1 — the composed write-up (therapist-editable until finalize).
    writeUp: writeUp
      ? Object.fromEntries(Object.entries(writeUp).map(([k, v]) => [k, trim(v)]))
      : null,
    // AI step 2 — proposals plus the therapist's decisions. Each carries
    // status proposed|accepted|rejected; accepted goals carry acceptedGoalId.
    proposedPlan: evaluation.proposedPlan,
    proposedGoals: proposedGoals.map((g) => ({ ...g, rationale: trim(g.rationale) })),
    evalCode: {
      suggestion: evaluation.evalCodeSuggestion, // {code, rationale, suggestedAt} | null
      final: evaluation.evalCodeFinal, // therapist's decision: 97165|97166|97167 | null
    },
    treatmentPlanId: evaluation.treatmentPlanId,
    composedAt: evaluation.composedAt,
    proposedAt: evaluation.proposedAt,
    finalizedAt: evaluation.finalizedAt,
  };
}

/**
 * create_initial_evaluation — start a draft evaluation, prefilled from the
 * patient record exactly like POST /api/patients/:patientId/evaluations
 * (server/routes/evaluations.ts). Kept in lockstep with that route.
 */
export async function createDraftInitialEvaluationForAssistant(params: {
  patientId: number;
  practiceId: number;
  therapistId: string;
  evaluationDate?: string;
}) {
  const { patientId, practiceId, therapistId } = params;
  const patient = await requirePracticePatient(patientId, practiceId);

  if (params.evaluationDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(params.evaluationDate)) {
    throw new Error('evaluationDate must be YYYY-MM-DD');
  }

  // Prefill section 1 from the existing patient record — all editable in the app.
  const dob = (patient as any).dateOfBirth || null;
  const age = dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
  const intake = ((patient as any).intakeData ?? {}) as Record<string, any>;
  const personalInfo = {
    childName: `${patient.firstName} ${patient.lastName}`.trim(),
    dateOfBirth: dob,
    age: age != null ? String(age) : '',
    caregiverPresent: '',
    referringPhysician: intake.referringPhysician || intake.referringProvider || '',
    primaryDiagnosis: intake.primaryDiagnosis || intake.diagnosis || '',
    school: intake.school || intake.schoolName || '',
    gradeClassroom: intake.grade || '',
  };

  const evaluation = await storage.createInitialEvaluation({
    practiceId,
    patientId,
    therapistId,
    evaluationDate: params.evaluationDate || new Date().toISOString().slice(0, 10),
    status: 'draft',
    personalInfo,
    healthHistory: {},
    caregiverConcerns: {},
  });

  return {
    created: true,
    evaluation: evaluationListRow(evaluation),
    patient: patientLabel(patient),
    personalInfo,
    message:
      `Draft initial evaluation #${evaluation.id} created for ${patient.firstName} (section 1 prefilled from the patient record). ` +
      'The therapist completes the sections, composes the write-up, and reviews every AI proposal in the app — ' +
      'accepting goals/plans and finalizing are done there, not via assistant tools.',
  };
}

// ==================== PROGRESS NOTES ====================

function progressNoteListRow(n: ProgressNote) {
  return {
    noteId: n.id,
    windowStart: n.windowStart,
    windowEnd: n.windowEnd,
    status: n.status, // draft | finalized
    sessionsReviewed: n.sessionsReviewed,
    extensionRequested: n.extensionRequested,
    finalizedAt: n.finalizedAt,
    createdAt: n.createdAt,
  };
}

/** get_patient_progress_notes — list a patient's formal progress notes. */
export async function listPatientProgressNotesForAssistant(patientId: number, practiceId: number) {
  const patient = await requirePracticePatient(patientId, practiceId);
  const notes = await storage.getProgressNotesForPatient(patientId, practiceId);
  return {
    patient: patientLabel(patient),
    noteCount: notes.length,
    notes: notes.map(progressNoteListRow),
    message:
      notes.length === 0
        ? `No formal progress notes on file for ${patient.firstName}.`
        : `Found ${notes.length} progress note${notes.length === 1 ? '' : 's'} for ${patient.firstName}.`,
  };
}

/** get_progress_note — one note: goal entries, narratives, extension info. */
export async function getProgressNoteForAssistant(noteId: number, practiceId: number) {
  if (!Number.isFinite(noteId)) {
    throw new Error('noteId is required and must be a number');
  }
  // Practice-scoped read: a cross-tenant id returns undefined → "not found".
  const note = await storage.getProgressNote(noteId, practiceId);
  if (!note) throw new Error(`Progress note ${noteId} not found`);
  const patient = await storage.getPatient(note.patientId);

  const entries = (note.goalEntries ?? []) as ProgressNoteGoalEntry[];
  return {
    noteId: note.id,
    patient: patient ? patientLabel(patient) : { id: note.patientId, name: null },
    treatmentPlanId: note.treatmentPlanId,
    status: note.status, // draft | finalized
    window: { start: note.windowStart, end: note.windowEnd },
    sessionsReviewed: note.sessionsReviewed,
    // One entry per treatment goal. progressPercent is the THERAPIST-ENTERED
    // clinical judgment (never auto-computed); null means not yet entered.
    goalEntries: entries.map((e) => ({
      ...e,
      interventions: trim(e.interventions),
      assistanceLevels: trim(e.assistanceLevels),
      currentAbility: trim(e.currentAbility),
    })),
    narratives: {
      presentLevel: trim(note.presentLevel),
      annualGoals: trim(note.annualGoals),
      recommendations: trim(note.recommendations),
    },
    extension: {
      requested: note.extensionRequested,
      newEndDate: note.extensionNewEndDate,
      rationale: trim(note.extensionRationale),
      appliedAt: note.extensionAppliedAt,
    },
    goalProgressSyncedAt: note.goalProgressSyncedAt,
    generatedAt: note.generatedAt,
    finalizedAt: note.finalizedAt,
  };
}

/** get_progress_note_cadence — read-time due-ness for a patient. */
export async function getProgressNoteCadenceForAssistant(patientId: number, practiceId: number) {
  const patient = await requirePracticePatient(patientId, practiceId);
  const cadence = await getProgressNoteCadence(patientId, practiceId);
  return {
    patient: patientLabel(patient),
    cadence,
    policy: {
      sessionsPerProgressNote: SESSIONS_PER_PROGRESS_NOTE,
      maxDaysBetweenProgressNotes: MAX_DAYS_BETWEEN_PROGRESS_NOTES,
      rule: 'A progress note is due every 10 completed sessions or 90 days, whichever comes first, counted from the later of the plan start and the last finalized note.',
    },
    message: cadence.due
      ? `A progress note is DUE for ${patient.firstName} (tripped by ${cadence.reason === 'sessions' ? `${cadence.completedSessionsSinceAnchor} completed sessions` : `${cadence.daysSinceAnchor} days`} since ${cadence.anchorDate}).`
      : cadence.anchorDate
        ? `Not yet due for ${patient.firstName}: ${cadence.sessionsUntilDue} session${cadence.sessionsUntilDue === 1 ? '' : 's'} or ${cadence.daysUntilDue} day${cadence.daysUntilDue === 1 ? '' : 's'} remaining, whichever comes first.`
        : `No cadence anchor for ${patient.firstName} yet (no active plan, finalized note, or completed session to count from).`,
  };
}
