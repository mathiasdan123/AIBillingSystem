/**
 * Treatment Plans Routes
 *
 * Handles:
 * - /api/patients/:id/treatment-plans - CRUD for patient treatment plans
 * - /api/treatment-plans/:id - Get/update individual treatment plan
 * - /api/treatment-plans/:id/goals - CRUD for goals within a plan
 * - /api/treatment-plans/:id/goals/:goalId/progress - Add progress entry
 * - /api/treatment-plans/:id/progress-summary - Aggregate progress across all goals
 * - /api/soap-notes/:id/goal-progress - Link goal progress to SOAP notes
 */

import { Router } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

const router = Router();

// ==================== TREATMENT PLAN CRUD ====================

// GET /api/patients/:id/treatment-plans - List treatment plans for a patient
router.get('/patients/:id/treatment-plans', isAuthenticated, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    if (isNaN(patientId)) {
      return res.status(400).json({ message: 'Invalid patient ID' });
    }
    const plans = await storage.getPatientTreatmentPlans(patientId);
    res.json(plans);
  } catch (error) {
    logger.error('Error fetching patient treatment plans', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch treatment plans' });
  }
});

// POST /api/patients/:id/treatment-plans - Create a treatment plan
router.post('/patients/:id/treatment-plans', isAuthenticated, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    if (isNaN(patientId)) {
      return res.status(400).json({ message: 'Invalid patient ID' });
    }

    const userId = req.user?.claims?.sub;
    const user = await storage.getUser(userId);
    if (!user?.practiceId) {
      return res.status(400).json({ message: 'User not associated with a practice' });
    }

    const plan = await storage.createTreatmentPlan({
      ...req.body,
      patientId,
      practiceId: user.practiceId,
      therapistId: req.body.therapistId || userId,
    });

    res.status(201).json(plan);
  } catch (error) {
    logger.error('Error creating treatment plan', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create treatment plan' });
  }
});

// GET /api/treatment-plans/:id - Get a single treatment plan with details
router.get('/treatment-plans/:id', isAuthenticated, async (req: any, res) => {
  try {
    const planId = parseInt(req.params.id);
    if (isNaN(planId)) {
      return res.status(400).json({ message: 'Invalid plan ID' });
    }

    const details = await storage.getTreatmentPlanWithDetails(planId);
    if (!details) {
      return res.status(404).json({ message: 'Treatment plan not found' });
    }

    res.json(details);
  } catch (error) {
    logger.error('Error fetching treatment plan', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch treatment plan' });
  }
});

// PUT /api/treatment-plans/:id - Update a treatment plan
router.put('/treatment-plans/:id', isAuthenticated, async (req: any, res) => {
  try {
    const planId = parseInt(req.params.id);
    if (isNaN(planId)) {
      return res.status(400).json({ message: 'Invalid plan ID' });
    }

    const updated = await storage.updateTreatmentPlan(planId, req.body);
    if (!updated) {
      return res.status(404).json({ message: 'Treatment plan not found' });
    }

    res.json(updated);
  } catch (error) {
    logger.error('Error updating treatment plan', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update treatment plan' });
  }
});

// ==================== GOALS CRUD ====================

// GET /api/treatment-plans/:id/goals - List goals for a treatment plan
router.get('/treatment-plans/:id/goals', isAuthenticated, async (req: any, res) => {
  try {
    const planId = parseInt(req.params.id);
    if (isNaN(planId)) {
      return res.status(400).json({ message: 'Invalid plan ID' });
    }

    const goals = await storage.getTreatmentGoals(planId);
    res.json(goals);
  } catch (error) {
    logger.error('Error fetching treatment goals', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch goals' });
  }
});

// POST /api/treatment-plans/:id/goals - Create a goal
router.post('/treatment-plans/:id/goals', isAuthenticated, async (req: any, res) => {
  try {
    const planId = parseInt(req.params.id);
    if (isNaN(planId)) {
      return res.status(400).json({ message: 'Invalid plan ID' });
    }

    const plan = await storage.getTreatmentPlan(planId);
    if (!plan) {
      return res.status(404).json({ message: 'Treatment plan not found' });
    }

    // Auto-determine goal number
    const existingGoals = await storage.getTreatmentGoals(planId);
    const goalNumber = req.body.goalNumber || existingGoals.length + 1;

    const goal = await storage.createTreatmentGoal({
      ...req.body,
      treatmentPlanId: planId,
      patientId: plan.patientId,
      practiceId: plan.practiceId,
      goalNumber,
    });

    res.status(201).json(goal);
  } catch (error) {
    logger.error('Error creating treatment goal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create goal' });
  }
});

// PUT /api/treatment-plans/:id/goals/:goalId - Update a goal
router.put('/treatment-plans/:id/goals/:goalId', isAuthenticated, async (req: any, res) => {
  try {
    const goalId = parseInt(req.params.goalId);
    if (isNaN(goalId)) {
      return res.status(400).json({ message: 'Invalid goal ID' });
    }

    const updates: any = { ...req.body };
    if (req.body.status === 'achieved' && !req.body.achievedAt) {
      updates.achievedAt = new Date();
    }

    const updated = await storage.updateTreatmentGoal(goalId, updates);
    if (!updated) {
      return res.status(404).json({ message: 'Goal not found' });
    }

    res.json(updated);
  } catch (error) {
    logger.error('Error updating treatment goal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update goal' });
  }
});

// DELETE /api/treatment-plans/:id/goals/:goalId - Delete a goal
router.delete('/treatment-plans/:id/goals/:goalId', isAuthenticated, async (req: any, res) => {
  try {
    const goalId = parseInt(req.params.goalId);
    if (isNaN(goalId)) {
      return res.status(400).json({ message: 'Invalid goal ID' });
    }

    await storage.deleteTreatmentGoal(goalId);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting treatment goal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete goal' });
  }
});

// ==================== GOAL PROGRESS ====================

// POST /api/treatment-plans/:id/goals/:goalId/progress - Add progress entry
router.post('/treatment-plans/:id/goals/:goalId/progress', isAuthenticated, async (req: any, res) => {
  try {
    const goalId = parseInt(req.params.goalId);
    if (isNaN(goalId)) {
      return res.status(400).json({ message: 'Invalid goal ID' });
    }

    const userId = req.user?.claims?.sub;

    const progressNote = await storage.createGoalProgressNote({
      goalId,
      therapistId: userId,
      notes: req.body.notes || '',
      progressRating: req.body.progressRating || null,
      sessionId: req.body.sessionId || null,
      interventionsUsed: req.body.interventionsUsed || null,
      homeworkAssigned: req.body.homeworkAssigned || null,
      nextSessionFocus: req.body.nextSessionFocus || null,
    });

    res.status(201).json(progressNote);
  } catch (error) {
    logger.error('Error creating goal progress note', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create progress note' });
  }
});

// GET /api/treatment-plans/:id/goals/:goalId/progress - Get progress history for a goal
router.get('/treatment-plans/:id/goals/:goalId/progress', isAuthenticated, async (req: any, res) => {
  try {
    const goalId = parseInt(req.params.goalId);
    if (isNaN(goalId)) {
      return res.status(400).json({ message: 'Invalid goal ID' });
    }

    const notes = await storage.getGoalProgressNotes(goalId);
    res.json(notes);
  } catch (error) {
    logger.error('Error fetching goal progress notes', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch progress notes' });
  }
});

// GET /api/treatment-plans/:id/progress-summary - Aggregate progress across all goals
router.get('/treatment-plans/:id/progress-summary', isAuthenticated, async (req: any, res) => {
  try {
    const planId = parseInt(req.params.id);
    if (isNaN(planId)) {
      return res.status(400).json({ message: 'Invalid plan ID' });
    }

    const plan = await storage.getTreatmentPlan(planId);
    if (!plan) {
      return res.status(404).json({ message: 'Treatment plan not found' });
    }

    const goals = await storage.getTreatmentGoals(planId);

    const goalSummaries = await Promise.all(
      goals.map(async (goal) => {
        const progressNotes = await storage.getGoalProgressNotes(goal.id);
        const soapProgressEntries = await storage.getSoapNoteGoalProgressByGoal(goal.id);
        return {
          goalId: goal.id,
          goalNumber: goal.goalNumber,
          description: goal.description,
          status: goal.status,
          progressPercentage: goal.progressPercentage || 0,
          targetDate: goal.targetDate,
          totalProgressNotes: progressNotes.length,
          totalSoapLinks: soapProgressEntries.length,
          latestProgressNote: progressNotes.length > 0 ? progressNotes[0] : null,
        };
      })
    );

    const totalGoals = goals.length;
    const achievedGoals = goals.filter(g => g.status === 'achieved').length;
    const inProgressGoals = goals.filter(g => g.status === 'in_progress').length;
    const averageProgress = totalGoals > 0
      ? Math.round(goals.reduce((sum, g) => sum + (g.progressPercentage || 0), 0) / totalGoals)
      : 0;

    res.json({
      planId,
      planStatus: plan.status,
      totalGoals,
      achievedGoals,
      inProgressGoals,
      averageProgress,
      goals: goalSummaries,
    });
  } catch (error) {
    logger.error('Error fetching progress summary', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch progress summary' });
  }
});

// ==================== SOAP NOTE GOAL PROGRESS LINKING ====================

// POST /api/soap-notes/:id/goal-progress - Link goal progress to a SOAP note
router.post('/soap-notes/:id/goal-progress', isAuthenticated, async (req: any, res) => {
  try {
    const soapNoteId = parseInt(req.params.id);
    if (isNaN(soapNoteId)) {
      return res.status(400).json({ message: 'Invalid SOAP note ID' });
    }

    const { goalProgressEntries } = req.body;
    if (!Array.isArray(goalProgressEntries) || goalProgressEntries.length === 0) {
      return res.status(400).json({ message: 'goalProgressEntries array is required' });
    }

    const results = [];
    for (const entry of goalProgressEntries) {
      if (!entry.goalId) continue;
      const progress = await storage.createSoapNoteGoalProgress({
        soapNoteId,
        goalId: entry.goalId,
        progressNote: entry.progressNote || null,
        progressPercentage: entry.progressPercentage != null ? entry.progressPercentage : null,
      });
      results.push(progress);
    }

    res.status(201).json(results);
  } catch (error) {
    logger.error('Error linking goal progress to SOAP note', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to link goal progress' });
  }
});

// GET /api/soap-notes/:id/goal-progress - Get goal progress linked to a SOAP note
router.get('/soap-notes/:id/goal-progress', isAuthenticated, async (req: any, res) => {
  try {
    const soapNoteId = parseInt(req.params.id);
    if (isNaN(soapNoteId)) {
      return res.status(400).json({ message: 'Invalid SOAP note ID' });
    }

    const entries = await storage.getSoapNoteGoalProgressBySoapNote(soapNoteId);
    res.json(entries);
  } catch (error) {
    logger.error('Error fetching SOAP note goal progress', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch goal progress' });
  }
});

export default router;
