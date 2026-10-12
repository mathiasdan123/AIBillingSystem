/**
 * MCP tools for clinical documentation: Initial Evaluations and formal
 * Progress Notes (Wonder Kids pilot). Mirrors the in-app Blanche tools of
 * the same names — both surfaces call server/services/clinicalDocAssistantTools.ts,
 * so shapes and tenant guards are identical (PARITY_TOOLS in
 * server/__tests__/blancheToolParity.test.ts).
 *
 * All six tools return patient-linked clinical records → containsPhi=true
 * (gated by practices.mcp_phi_enabled via withAudit).
 *
 * Deliberately NOT exposed on any assistant surface: accepting proposed
 * plans/goals, finalizing an evaluation or progress note, and entering a
 * goal progress %. Those are the treating therapist's clinical sign-off
 * and happen in the app, where the full record is visible.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  listPatientEvaluationsForAssistant,
  getEvaluationForAssistant,
  createDraftInitialEvaluationForAssistant,
  listPatientProgressNotesForAssistant,
  getProgressNoteForAssistant,
  getProgressNoteCadenceForAssistant,
} from '../../services/clinicalDocAssistantTools';
import { withAudit } from '../audit';
import { withMcpMutationGate } from '../confirmation';
import type { McpPracticeContext } from '../types';

export function registerClinicalDocTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  // ── get_patient_evaluations ───────────────────────────────────────────
  const getPatientEvaluations = withAudit(
    'get_patient_evaluations',
    'initial_evaluation',
    true,
    async (input: { patientId: number }) =>
      listPatientEvaluationsForAssistant(input.patientId, context.practiceId),
  );

  server.tool(
    'get_patient_evaluations',
    'List a patient\'s initial evaluations: id, evaluation date, lifecycle status (draft -> composed -> finalized), linked treatment plan id, and the final evaluation CPT code if chosen. Use get_initial_evaluation for the full content of one. Contains PHI.',
    { patientId: z.number().describe('Patient ID') },
    (input) => getPatientEvaluations(input, context),
  );

  // ── get_initial_evaluation ────────────────────────────────────────────
  const getInitialEvaluation = withAudit(
    'get_initial_evaluation',
    'initial_evaluation',
    true,
    async (input: { evaluationId: number }) =>
      getEvaluationForAssistant(input.evaluationId, context.practiceId),
  );

  server.tool(
    'get_initial_evaluation',
    'Get one initial evaluation\'s content: the structured input sections (personal info, health history, caregiver concerns, free-text findings), the parent-interview outline, the AI-composed write-up, the proposed plan of care and goal pairs with the therapist\'s accept/reject decisions, and the evaluation CPT code suggestion plus the therapist\'s final choice (97165/97166/97167). Long text sections are trimmed for chat. Read-only: accepting proposals and finalizing happen in the TherapyBill app. Contains PHI.',
    { evaluationId: z.number().describe('Initial evaluation ID') },
    (input) => getInitialEvaluation(input, context),
  );

  // ── create_initial_evaluation (mutation) ──────────────────────────────
  const createInitialEvaluation = withAudit(
    'create_initial_evaluation',
    'initial_evaluation',
    true,
    withMcpMutationGate(async (input: { patientId: number; evaluationDate?: string }) =>
      createDraftInitialEvaluationForAssistant({
        patientId: input.patientId,
        practiceId: context.practiceId,
        therapistId: context.userId,
        evaluationDate: input.evaluationDate,
      }),
    ),
  );

  server.tool(
    'create_initial_evaluation',
    'Start a DRAFT initial evaluation for a patient, with section 1 (personal info) prefilled from the patient record — the same prefill the app\'s New Evaluation button does. This writes a draft row; the therapist completes the sections, composes the write-up, and reviews every AI proposal in the app. No assistant tool can accept goals/plans or finalize the evaluation — that clinical sign-off is app-only. Contains PHI.',
    {
      patientId: z.number().describe('Patient ID to start the evaluation for'),
      evaluationDate: z
        .string()
        .optional()
        .describe('Evaluation date (YYYY-MM-DD, defaults to today)'),
    },
    (input) => createInitialEvaluation(input, context),
  );

  // ── get_patient_progress_notes ────────────────────────────────────────
  const getPatientProgressNotes = withAudit(
    'get_patient_progress_notes',
    'progress_note',
    true,
    async (input: { patientId: number }) =>
      listPatientProgressNotesForAssistant(input.patientId, context.practiceId),
  );

  server.tool(
    'get_patient_progress_notes',
    'List a patient\'s formal progress notes (the every-10-sessions/90-days goal-review notes, not per-session SOAP notes): id, reporting window, lifecycle status (draft -> finalized), sessions reviewed, and whether a plan extension was requested. Use get_progress_note for one note\'s content. Contains PHI.',
    { patientId: z.number().describe('Patient ID') },
    (input) => getPatientProgressNotes(input, context),
  );

  // ── get_progress_note ─────────────────────────────────────────────────
  const getProgressNote = withAudit(
    'get_progress_note',
    'progress_note',
    true,
    async (input: { noteId: number }) =>
      getProgressNoteForAssistant(input.noteId, context.practiceId),
  );

  server.tool(
    'get_progress_note',
    'Get one formal progress note: the per-goal entries (interventions utilized, assistance levels, current ability, and the therapist-entered progress % — null until the therapist enters it; it is pure clinical judgment, never computed), the narrative sections (present level of functioning, annual goals, recommendations), and plan-extension info (requested, new end date, written rationale). Read-only: editing, entering progress %, and finalizing happen in the TherapyBill app. Contains PHI.',
    { noteId: z.number().describe('Progress note ID') },
    (input) => getProgressNote(input, context),
  );

  // ── get_progress_note_cadence ─────────────────────────────────────────
  const getProgressNoteCadence = withAudit(
    'get_progress_note_cadence',
    'progress_note',
    true,
    async (input: { patientId: number }) =>
      getProgressNoteCadenceForAssistant(input.patientId, context.practiceId),
  );

  server.tool(
    'get_progress_note_cadence',
    'Is a formal progress note due for this patient? Computes the cadence (due every 10 completed sessions or 90 days, whichever comes first, from the later of plan start and last finalized note): due now or not, what tripped it, sessions/days since the anchor, and sessions/days remaining until due. Contains PHI.',
    { patientId: z.number().describe('Patient ID') },
    (input) => getProgressNoteCadence(input, context),
  );
}
