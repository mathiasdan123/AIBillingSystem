/**
 * Initial Evaluation Routes
 *
 * Handles:
 * - /api/patients/:patientId/evaluations  - list/create evaluations for a patient
 * - /api/evaluations/:id                  - get/update one evaluation
 * - /api/evaluations/:id/compose          - AI step 1: compose the SOAP-style write-up (draft)
 * - /api/evaluations/:id/write-up         - save the therapist-edited write-up
 * - /api/evaluations/:id/propose          - AI step 2: propose plan of care + goals (proposals)
 * - /api/evaluations/:id/plan/decision    - accept (with edits) or reject the proposed plan
 * - /api/evaluations/:id/goals/:index/decision - accept (with edits) or reject one proposed goal
 * - /api/evaluations/:id/finalize         - lock the evaluation
 *
 * Every route resolves the caller's practice via getUserPracticeContext
 * (fails closed — no practice, no access) and reads evaluations through
 * practice-scoped storage, so cross-tenant ids 404.
 *
 * The AI drafts; the therapist reviews, edits, and approves. Accepted
 * proposals are written into the EXISTING treatment_plans/treatment_goals
 * model so the Progress tab charts them — nothing clinical happens without
 * an explicit accept from the therapist.
 */

import { Router, type Response } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { getUserPracticeContext, type PracticeContext } from '../services/practiceContext';
import {
  composeEvaluationWriteUp,
  proposePlanAndGoals,
  parsePlanProposal,
  parseGoalProposal,
  WRITE_UP_SECTIONS,
  type EvaluationWriteUp,
  type ProposedGoal,
  type ProposedPlan,
} from '../services/initialEvaluationService';
import logger from '../services/logger';

const router = Router();

async function requireContext(req: any, res: Response): Promise<PracticeContext | null> {
  const context = await getUserPracticeContext(req);
  if (!context) {
    res.status(403).json({ message: 'No practice context' });
    return null;
  }
  return context;
}

async function loadEvaluation(req: any, res: Response, context: PracticeContext) {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ message: 'Invalid evaluation ID' });
    return null;
  }
  const evaluation = await storage.getInitialEvaluation(id, context.practiceId);
  if (!evaluation) {
    res.status(404).json({ message: 'Evaluation not found' });
    return null;
  }
  return evaluation;
}

const SECTION_FIELDS = [
  'evaluationDate',
  'personalInfo',
  'healthHistory',
  'caregiverConcerns',
  'subjectiveComments',
  'objectiveActivities',
  'assessmentResults',
  'skillAreas',
] as const;

function pickSectionUpdates(body: any): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const field of SECTION_FIELDS) {
    if (body[field] !== undefined) updates[field] = body[field];
  }
  return updates;
}

// ==================== LIST / CREATE ====================

// GET /api/patients/:patientId/evaluations
router.get('/patients/:patientId/evaluations', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const patientId = parseInt(req.params.patientId);
    if (isNaN(patientId)) return res.status(400).json({ message: 'Invalid patient ID' });

    const evaluations = await storage.getPatientInitialEvaluations(patientId, context.practiceId);
    res.json(evaluations);
  } catch (error) {
    logger.error('Error fetching evaluations', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch evaluations' });
  }
});

// POST /api/patients/:patientId/evaluations - create a draft, prefilled from the patient record
router.post('/patients/:patientId/evaluations', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const patientId = parseInt(req.params.patientId);
    if (isNaN(patientId)) return res.status(400).json({ message: 'Invalid patient ID' });

    const patient = await storage.getPatient(patientId);
    if (!patient || patient.practiceId !== context.practiceId) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Prefill section 1 from the existing patient record — all editable.
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
      ...(req.body?.personalInfo ?? {}),
    };

    const evaluation = await storage.createInitialEvaluation({
      practiceId: context.practiceId,
      patientId,
      therapistId: context.userId,
      evaluationDate: req.body?.evaluationDate || new Date().toISOString().slice(0, 10),
      status: 'draft',
      personalInfo,
      healthHistory: req.body?.healthHistory ?? {},
      caregiverConcerns: req.body?.caregiverConcerns ?? {},
    });

    res.status(201).json(evaluation);
  } catch (error) {
    logger.error('Error creating evaluation', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create evaluation' });
  }
});

// ==================== READ / UPDATE ====================

// GET /api/evaluations/:id
router.get('/evaluations/:id', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const evaluation = await loadEvaluation(req, res, context);
    if (!evaluation) return;
    res.json(evaluation);
  } catch (error) {
    logger.error('Error fetching evaluation', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch evaluation' });
  }
});

// PATCH /api/evaluations/:id - save the input sections (not after finalize)
router.patch('/evaluations/:id', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const evaluation = await loadEvaluation(req, res, context);
    if (!evaluation) return;
    if (evaluation.status === 'finalized') {
      return res.status(409).json({ message: 'Evaluation is finalized and can no longer be edited' });
    }

    const updates = pickSectionUpdates(req.body ?? {});
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No editable fields in request' });
    }
    const updated = await storage.updateInitialEvaluation(evaluation.id, context.practiceId, updates);
    res.json(updated);
  } catch (error) {
    logger.error('Error updating evaluation', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update evaluation' });
  }
});

// ==================== AI STEP 1 — COMPOSE ====================

// POST /api/evaluations/:id/compose
router.post('/evaluations/:id/compose', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const evaluation = await loadEvaluation(req, res, context);
    if (!evaluation) return;

    const { writeUp } = await composeEvaluationWriteUp({
      evaluationId: evaluation.id,
      practiceId: context.practiceId,
    });

    const updated = await storage.updateInitialEvaluation(evaluation.id, context.practiceId, {
      aiWriteUp: writeUp,
      composedAt: new Date(),
      status: 'composed',
    });
    res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Error composing evaluation write-up', { error: message });
    res.status(message.includes('not found') ? 404 : 422).json({ message });
  }
});

// PATCH /api/evaluations/:id/write-up - save the therapist's edits to the draft
router.patch('/evaluations/:id/write-up', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const evaluation = await loadEvaluation(req, res, context);
    if (!evaluation) return;
    if (evaluation.status === 'finalized') {
      return res.status(409).json({ message: 'Evaluation is finalized and can no longer be edited' });
    }
    if (!evaluation.aiWriteUp) {
      return res.status(409).json({ message: 'Compose the write-up before editing it' });
    }

    const current = evaluation.aiWriteUp as EvaluationWriteUp;
    const next: EvaluationWriteUp = { ...current };
    for (const section of WRITE_UP_SECTIONS) {
      const value = req.body?.[section];
      if (value !== undefined) {
        if (typeof value !== 'string' || !value.trim()) {
          return res.status(400).json({ message: `Write-up section "${section}" must be non-empty text` });
        }
        next[section] = value;
      }
    }

    const updated = await storage.updateInitialEvaluation(evaluation.id, context.practiceId, {
      aiWriteUp: next,
    });
    res.json(updated);
  } catch (error) {
    logger.error('Error saving write-up edits', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to save write-up' });
  }
});

// ==================== AI STEP 2 — PROPOSE PLAN + GOALS ====================

// POST /api/evaluations/:id/propose
router.post('/evaluations/:id/propose', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const evaluation = await loadEvaluation(req, res, context);
    if (!evaluation) return;

    const { plan, goals } = await proposePlanAndGoals({
      evaluationId: evaluation.id,
      practiceId: context.practiceId,
    });

    const updated = await storage.updateInitialEvaluation(evaluation.id, context.practiceId, {
      proposedPlan: plan,
      proposedGoals: goals,
      proposedAt: new Date(),
    });
    res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Error proposing plan/goals', { error: message });
    res.status(message.includes('not found') ? 404 : 422).json({ message });
  }
});

// POST /api/evaluations/:id/plan/decision { action: 'accept'|'reject', edits? }
// Accepting creates a plan in the EXISTING treatment_plans model.
router.post('/evaluations/:id/plan/decision', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const evaluation = await loadEvaluation(req, res, context);
    if (!evaluation) return;

    const { action, edits } = req.body ?? {};
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ message: "action must be 'accept' or 'reject'" });
    }
    const proposedPlan = evaluation.proposedPlan as ProposedPlan | null;
    if (!proposedPlan) {
      return res.status(409).json({ message: 'No proposed plan to decide on' });
    }
    if (evaluation.treatmentPlanId) {
      return res.status(409).json({ message: 'The plan of care has already been accepted' });
    }

    if (action === 'reject') {
      const updated = await storage.updateInitialEvaluation(evaluation.id, context.practiceId, {
        proposedPlan: { ...proposedPlan, status: 'rejected' },
      });
      return res.json(updated);
    }

    // Accept — the therapist's edits override the proposal; re-validate the result.
    const plan = parsePlanProposal({ ...proposedPlan, ...(edits ?? {}) });
    const personalInfo = (evaluation.personalInfo ?? {}) as Record<string, any>;
    const treatmentPlan = await storage.createTreatmentPlan({
      patientId: evaluation.patientId,
      practiceId: context.practiceId,
      therapistId: evaluation.therapistId || context.userId,
      title: `Initial Evaluation Plan of Care — ${evaluation.evaluationDate ?? plan.startDate}`,
      diagnosis: personalInfo.primaryDiagnosis || null,
      // All Wonder Kids sessions are individual — no group option exists.
      treatmentModality: 'Individual (1:1)',
      frequency: `${plan.sessionsPerWeek}x/week`,
      estimatedDuration: `${plan.durationWeeks} weeks`,
      status: 'active',
      startDate: plan.startDate,
      targetEndDate: plan.endDate,
      notes: `Accepted from initial evaluation #${evaluation.id}. ${plan.rationale}`,
    });

    const updated = await storage.updateInitialEvaluation(evaluation.id, context.practiceId, {
      proposedPlan: { ...plan, status: 'accepted' },
      treatmentPlanId: treatmentPlan.id,
    });
    res.json({ evaluation: updated, treatmentPlan });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Error deciding on proposed plan', { error: message });
    res.status(message.includes('validation') ? 400 : 500).json({ message: message.includes('validation') ? message : 'Failed to record plan decision' });
  }
});

// POST /api/evaluations/:id/goals/:index/decision { action: 'accept'|'reject', edits? }
// Accepting writes the goal into the EXISTING treatment_goals model (progress
// starts at 0) so the Progress tab charts it via soap_note_goal_progress.
router.post('/evaluations/:id/goals/:index/decision', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const evaluation = await loadEvaluation(req, res, context);
    if (!evaluation) return;

    const { action, edits } = req.body ?? {};
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ message: "action must be 'accept' or 'reject'" });
    }
    const goals = (evaluation.proposedGoals ?? []) as ProposedGoal[];
    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0 || index >= goals.length) {
      return res.status(404).json({ message: 'Proposed goal not found' });
    }
    if (goals[index].status === 'accepted') {
      return res.status(409).json({ message: 'This goal has already been accepted' });
    }

    if (action === 'reject') {
      const nextGoals = goals.map((g, i) => (i === index ? { ...g, status: 'rejected' as const } : g));
      const updated = await storage.updateInitialEvaluation(evaluation.id, context.practiceId, {
        proposedGoals: nextGoals,
      });
      return res.json(updated);
    }

    if (!evaluation.treatmentPlanId) {
      return res.status(409).json({ message: 'Accept the plan of care first — accepted goals are filed under it' });
    }

    // Accept — therapist edits override, then re-validate.
    const goal = parseGoalProposal({ ...goals[index], ...(edits ?? {}) });
    const existingGoals = await storage.getTreatmentGoals(evaluation.treatmentPlanId);
    const created = await storage.createTreatmentGoal({
      treatmentPlanId: evaluation.treatmentPlanId,
      patientId: evaluation.patientId,
      practiceId: context.practiceId,
      goalNumber: existingGoals.length + 1,
      category: goal.skillArea,
      description: goal.goalText,
      targetDate: goal.endDate,
      status: 'in_progress',
      progressPercentage: 0,
      goalTerm: goal.term,
      durationWeeks: goal.durationWeeks,
      startDate: goal.startDate,
    });

    const nextGoals = goals.map((g, i) =>
      i === index ? { ...goal, status: 'accepted' as const, acceptedGoalId: created.id } : g,
    );
    const updated = await storage.updateInitialEvaluation(evaluation.id, context.practiceId, {
      proposedGoals: nextGoals,
    });
    res.json({ evaluation: updated, goal: created });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Error deciding on proposed goal', { error: message });
    res.status(message.includes('validation') ? 400 : 500).json({ message: message.includes('validation') ? message : 'Failed to record goal decision' });
  }
});

// ==================== FINALIZE ====================

// POST /api/evaluations/:id/finalize
router.post('/evaluations/:id/finalize', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const evaluation = await loadEvaluation(req, res, context);
    if (!evaluation) return;
    if (evaluation.status === 'finalized') {
      return res.status(409).json({ message: 'Evaluation is already finalized' });
    }
    if (!evaluation.aiWriteUp) {
      return res.status(409).json({ message: 'Compose and review the write-up before finalizing' });
    }

    const updated = await storage.updateInitialEvaluation(evaluation.id, context.practiceId, {
      status: 'finalized',
      finalizedAt: new Date(),
    });
    res.json(updated);
  } catch (error) {
    logger.error('Error finalizing evaluation', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to finalize evaluation' });
  }
});

export default router;
