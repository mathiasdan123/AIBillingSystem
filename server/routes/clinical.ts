/**
 * Clinical Routes - Treatment Plans, Goals, Objectives, Interventions, Progress Notes, Outcome Measures
 *
 * Handles:
 * - /api/treatment-plans/* - Treatment plan CRUD (list, stats, needs-review, get, create, update, sign)
 * - /api/treatment-plans/:planId/goals/* - Treatment goals
 * - /api/goals/* - Goal CRUD, progress notes
 * - /api/goals/:goalId/objectives/* - Objectives
 * - /api/objectives/* - Objective CRUD
 * - /api/treatment-plans/:planId/interventions/* - Interventions
 * - /api/interventions/* - Intervention CRUD
 * - /api/outcome-measures/templates/* - Outcome measure templates
 * - /api/outcome-measures/assessments/* - Patient assessments
 * - /api/outcome-measures/stats - Outcome measure stats
 * - /api/assessment-schedules/* - Assessment scheduling
 * - /api/sessions/:sessionId/progress-notes - Session progress notes
 * - /api/patients/:id/progress-notes/* - Patient progress notes
 */

import { Router } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

const router = Router();

// Helper to get authorized practiceId
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
  if (userRole === 'admin') return requestedPracticeId || userPracticeId || 1;
  if (!userPracticeId) throw new Error('User not assigned to a practice.');
  if (requestedPracticeId && requestedPracticeId !== userPracticeId) return userPracticeId;
  return requestedPracticeId || userPracticeId;
};

// ==================== TREATMENT PLANS ====================

router.get('/treatment-plans', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
      therapistId: req.query.therapistId as string | undefined,
      status: req.query.status as string | undefined,
    };
    const plans = await storage.getTreatmentPlans(practiceId, filters);
    res.json(plans);
  } catch (error) {
    logger.error('Error fetching treatment plans', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch treatment plans' });
  }
});

router.get('/treatment-plans/stats', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const stats = await storage.getTreatmentPlanStats(practiceId);
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching treatment plan stats', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch treatment plan stats' });
  }
});

router.get('/treatment-plans/needs-review', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const daysAhead = parseInt(req.query.daysAhead as string) || 7;
    const plans = await storage.getPlansNeedingReview(practiceId, daysAhead);
    res.json(plans);
  } catch (error) {
    logger.error('Error fetching plans needing review', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch plans needing review' });
  }
});

router.get('/treatment-plans/:id', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const planDetails = await storage.getTreatmentPlanWithDetails(id);
    if (!planDetails) return res.status(404).json({ message: 'Treatment plan not found' });
    res.json(planDetails);
  } catch (error) {
    logger.error('Error fetching treatment plan', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch treatment plan' });
  }
});

router.post('/treatment-plans', isAuthenticated, async (req: any, res) => {
  try {
    const plan = await storage.createTreatmentPlan(req.body);
    res.status(201).json(plan);
  } catch (error) {
    logger.error('Error creating treatment plan', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create treatment plan' });
  }
});

router.patch('/treatment-plans/:id', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const plan = await storage.updateTreatmentPlan(id, req.body);
    if (!plan) return res.status(404).json({ message: 'Treatment plan not found' });
    res.json(plan);
  } catch (error) {
    logger.error('Error updating treatment plan', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update treatment plan' });
  }
});

router.post('/treatment-plans/:id/patient-sign', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const { signature } = req.body;
    const plan = await storage.updateTreatmentPlan(id, { patientSignature: signature, patientSignedAt: new Date() });
    if (!plan) return res.status(404).json({ message: 'Treatment plan not found' });
    res.json(plan);
  } catch (error) {
    logger.error('Error signing treatment plan', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to sign treatment plan' });
  }
});

router.post('/treatment-plans/:id/therapist-sign', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const { signature } = req.body;
    const plan = await storage.updateTreatmentPlan(id, { therapistSignature: signature, therapistSignedAt: new Date() });
    if (!plan) return res.status(404).json({ message: 'Treatment plan not found' });
    res.json(plan);
  } catch (error) {
    logger.error('Error signing treatment plan', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to sign treatment plan' });
  }
});

// ==================== TREATMENT GOALS ====================

router.get('/treatment-plans/:planId/goals', isAuthenticated, async (req: any, res) => {
  try {
    const planId = parseInt(req.params.planId);
    const goals = await storage.getTreatmentGoals(planId);
    res.json(goals);
  } catch (error) {
    logger.error('Error fetching treatment goals', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch treatment goals' });
  }
});

router.post('/treatment-plans/:planId/goals', isAuthenticated, async (req: any, res) => {
  try {
    const planId = parseInt(req.params.planId);
    const goal = await storage.createTreatmentGoal({ ...req.body, treatmentPlanId: planId });
    res.status(201).json(goal);
  } catch (error) {
    logger.error('Error creating treatment goal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create treatment goal' });
  }
});

router.get('/goals/:id', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const goal = await storage.getTreatmentGoal(id);
    if (!goal) return res.status(404).json({ message: 'Goal not found' });
    const objectives = await storage.getTreatmentObjectives(id);
    const progressNotes = await storage.getGoalProgressNotes(id);
    res.json({ ...goal, objectives, progressNotes });
  } catch (error) {
    logger.error('Error fetching goal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch goal' });
  }
});

router.patch('/goals/:id', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const updates = { ...req.body };
    if (updates.status === 'achieved' && !updates.achievedAt) updates.achievedAt = new Date();
    const goal = await storage.updateTreatmentGoal(id, updates);
    if (!goal) return res.status(404).json({ message: 'Goal not found' });
    res.json(goal);
  } catch (error) {
    logger.error('Error updating goal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update goal' });
  }
});

router.delete('/goals/:id', isAuthenticated, async (req: any, res) => {
  try {
    await storage.deleteTreatmentGoal(parseInt(req.params.id));
    res.json({ message: 'Goal deleted' });
  } catch (error) {
    logger.error('Error deleting goal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete goal' });
  }
});

// ==================== TREATMENT OBJECTIVES ====================

router.get('/goals/:goalId/objectives', isAuthenticated, async (req: any, res) => {
  try {
    const objectives = await storage.getTreatmentObjectives(parseInt(req.params.goalId));
    res.json(objectives);
  } catch (error) {
    logger.error('Error fetching objectives', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch objectives' });
  }
});

router.post('/goals/:goalId/objectives', isAuthenticated, async (req: any, res) => {
  try {
    const goalId = parseInt(req.params.goalId);
    const goal = await storage.getTreatmentGoal(goalId);
    if (!goal) return res.status(404).json({ message: 'Goal not found' });
    const objective = await storage.createTreatmentObjective({ ...req.body, goalId, treatmentPlanId: goal.treatmentPlanId });
    res.status(201).json(objective);
  } catch (error) {
    logger.error('Error creating objective', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create objective' });
  }
});

router.patch('/objectives/:id', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const updates = { ...req.body };
    if (updates.status === 'achieved' && !updates.achievedAt) updates.achievedAt = new Date();
    const objective = await storage.updateTreatmentObjective(id, updates);
    if (!objective) return res.status(404).json({ message: 'Objective not found' });
    res.json(objective);
  } catch (error) {
    logger.error('Error updating objective', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update objective' });
  }
});

router.delete('/objectives/:id', isAuthenticated, async (req: any, res) => {
  try {
    await storage.deleteTreatmentObjective(parseInt(req.params.id));
    res.json({ message: 'Objective deleted' });
  } catch (error) {
    logger.error('Error deleting objective', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete objective' });
  }
});

// ==================== TREATMENT INTERVENTIONS ====================

router.get('/treatment-plans/:planId/interventions', isAuthenticated, async (req: any, res) => {
  try {
    const interventions = await storage.getTreatmentInterventions(parseInt(req.params.planId));
    res.json(interventions);
  } catch (error) {
    logger.error('Error fetching interventions', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch interventions' });
  }
});

router.post('/treatment-plans/:planId/interventions', isAuthenticated, async (req: any, res) => {
  try {
    const intervention = await storage.createTreatmentIntervention({ ...req.body, treatmentPlanId: parseInt(req.params.planId) });
    res.status(201).json(intervention);
  } catch (error) {
    logger.error('Error creating intervention', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create intervention' });
  }
});

router.patch('/interventions/:id', isAuthenticated, async (req: any, res) => {
  try {
    const intervention = await storage.updateTreatmentIntervention(parseInt(req.params.id), req.body);
    if (!intervention) return res.status(404).json({ message: 'Intervention not found' });
    res.json(intervention);
  } catch (error) {
    logger.error('Error updating intervention', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update intervention' });
  }
});

router.delete('/interventions/:id', isAuthenticated, async (req: any, res) => {
  try {
    await storage.deleteTreatmentIntervention(parseInt(req.params.id));
    res.json({ message: 'Intervention deleted' });
  } catch (error) {
    logger.error('Error deleting intervention', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete intervention' });
  }
});

// ==================== GOAL PROGRESS NOTES ====================

router.get('/goals/:goalId/progress', isAuthenticated, async (req: any, res) => {
  try {
    const notes = await storage.getGoalProgressNotes(parseInt(req.params.goalId));
    res.json(notes);
  } catch (error) {
    logger.error('Error fetching progress notes', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch progress notes' });
  }
});

router.post('/goals/:goalId/progress', isAuthenticated, async (req: any, res) => {
  try {
    const note = await storage.createGoalProgressNote({ ...req.body, goalId: parseInt(req.params.goalId), therapistId: req.user?.id });
    res.status(201).json(note);
  } catch (error) {
    logger.error('Error creating progress note', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create progress note' });
  }
});

router.get('/sessions/:sessionId/progress-notes', isAuthenticated, async (req: any, res) => {
  try {
    const notes = await storage.getSessionProgressNotes(parseInt(req.params.sessionId));
    res.json(notes);
  } catch (error) {
    logger.error('Error fetching session progress notes', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch session progress notes' });
  }
});

// ==================== OUTCOME MEASURE TEMPLATES ====================

router.get('/outcome-measures/templates', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
    const templates = await storage.getOutcomeMeasureTemplates(practiceId);
    res.json(templates);
  } catch (error) {
    logger.error('Error fetching outcome measure templates', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch outcome measure templates' });
  }
});

router.get('/outcome-measures/templates/category/:category', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
    const templates = await storage.getTemplatesByCategory(req.params.category, practiceId);
    res.json(templates);
  } catch (error) {
    logger.error('Error fetching templates by category', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch templates' });
  }
});

router.get('/outcome-measures/templates/:id', isAuthenticated, async (req: any, res) => {
  try {
    const template = await storage.getOutcomeMeasureTemplate(parseInt(req.params.id));
    if (!template) return res.status(404).json({ message: 'Template not found' });
    res.json(template);
  } catch (error) {
    logger.error('Error fetching outcome measure template', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch template' });
  }
});

router.post('/outcome-measures/templates', isAuthenticated, async (req: any, res) => {
  try {
    const template = await storage.createOutcomeMeasureTemplate(req.body);
    res.status(201).json(template);
  } catch (error) {
    logger.error('Error creating outcome measure template', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create template' });
  }
});

router.patch('/outcome-measures/templates/:id', isAuthenticated, async (req: any, res) => {
  try {
    const template = await storage.updateOutcomeMeasureTemplate(parseInt(req.params.id), req.body);
    if (!template) return res.status(404).json({ message: 'Template not found' });
    res.json(template);
  } catch (error) {
    logger.error('Error updating outcome measure template', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update template' });
  }
});

// ==================== PATIENT ASSESSMENTS ====================

router.get('/outcome-measures/assessments', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      templateId: req.query.templateId ? parseInt(req.query.templateId as string) : undefined,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      assessmentType: req.query.assessmentType as string | undefined,
    };
    const assessments = await storage.getPracticeAssessments(practiceId, filters);
    res.json(assessments);
  } catch (error) {
    logger.error('Error fetching assessments', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch assessments' });
  }
});

router.get('/outcome-measures/stats', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const templateId = req.query.templateId ? parseInt(req.query.templateId as string) : undefined;
    const stats = await storage.getOutcomeMeasureStats(practiceId, templateId);
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching outcome measure stats', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
});

router.get('/outcome-measures/assessments/:id', isAuthenticated, async (req: any, res) => {
  try {
    const assessment = await storage.getPatientAssessment(parseInt(req.params.id));
    if (!assessment) return res.status(404).json({ message: 'Assessment not found' });
    const template = await storage.getOutcomeMeasureTemplate(assessment.templateId);
    res.json({ assessment, template });
  } catch (error) {
    logger.error('Error fetching assessment', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch assessment' });
  }
});

router.post('/outcome-measures/assessments', isAuthenticated, async (req: any, res) => {
  try {
    const { templateId, patientId, responses, ...rest } = req.body;
    const template = await storage.getOutcomeMeasureTemplate(templateId);
    if (!template) return res.status(404).json({ message: 'Template not found' });

    let totalScore = 0;
    if (template.scoringMethod === 'sum') {
      totalScore = responses.reduce((sum: number, r: any) => sum + (r.value || 0), 0);
    } else if (template.scoringMethod === 'average') {
      totalScore = Math.round(responses.reduce((sum: number, r: any) => sum + (r.value || 0), 0) / responses.length);
    }

    let severity = 'unknown';
    let interpretation = '';
    if (template.scoringRanges && Array.isArray(template.scoringRanges)) {
      for (const range of template.scoringRanges as any[]) {
        if (totalScore >= range.min && totalScore <= range.max) {
          severity = range.severity;
          interpretation = range.interpretation || '';
          break;
        }
      }
    }

    const assessment = await storage.createPatientAssessment({
      templateId, patientId, responses, totalScore, severity, interpretation,
      status: 'completed', completedAt: new Date(), ...rest,
    });

    res.status(201).json(assessment);
  } catch (error) {
    logger.error('Error creating assessment', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create assessment' });
  }
});

router.patch('/outcome-measures/assessments/:id', isAuthenticated, async (req: any, res) => {
  try {
    const assessment = await storage.updatePatientAssessment(parseInt(req.params.id), req.body);
    if (!assessment) return res.status(404).json({ message: 'Assessment not found' });
    res.json(assessment);
  } catch (error) {
    logger.error('Error updating assessment', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update assessment' });
  }
});

// ==================== ASSESSMENT SCHEDULES ====================

router.post('/assessment-schedules', isAuthenticated, async (req: any, res) => {
  try {
    const { frequency, dayOfWeek, dayOfMonth, ...rest } = req.body;
    const now = new Date();
    let nextDueAt = new Date();

    if (frequency === 'weekly' && dayOfWeek !== undefined) {
      const daysUntilNext = (dayOfWeek - now.getDay() + 7) % 7 || 7;
      nextDueAt.setDate(now.getDate() + daysUntilNext);
    } else if (frequency === 'bi-weekly' && dayOfWeek !== undefined) {
      const daysUntilNext = (dayOfWeek - now.getDay() + 7) % 7 || 7;
      nextDueAt.setDate(now.getDate() + daysUntilNext + 7);
    } else if (frequency === 'monthly' && dayOfMonth !== undefined) {
      nextDueAt.setMonth(now.getMonth() + 1);
      nextDueAt.setDate(Math.min(dayOfMonth, new Date(nextDueAt.getFullYear(), nextDueAt.getMonth() + 1, 0).getDate()));
    } else {
      nextDueAt.setDate(now.getDate() + 7);
    }

    const schedule = await storage.createAssessmentSchedule({ frequency, dayOfWeek, dayOfMonth, nextDueAt, ...rest });
    res.status(201).json(schedule);
  } catch (error) {
    logger.error('Error creating assessment schedule', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create assessment schedule' });
  }
});

router.patch('/assessment-schedules/:id', isAuthenticated, async (req: any, res) => {
  try {
    const schedule = await storage.updateAssessmentSchedule(parseInt(req.params.id), req.body);
    if (!schedule) return res.status(404).json({ message: 'Schedule not found' });
    res.json(schedule);
  } catch (error) {
    logger.error('Error updating assessment schedule', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update assessment schedule' });
  }
});

router.delete('/assessment-schedules/:id', isAuthenticated, async (req: any, res) => {
  try {
    await storage.deleteAssessmentSchedule(parseInt(req.params.id));
    res.json({ message: 'Schedule deleted' });
  } catch (error) {
    logger.error('Error deleting assessment schedule', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete assessment schedule' });
  }
});

router.get('/assessment-schedules/due', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const dueSchedules = await storage.getDueAssessments(practiceId);
    res.json(dueSchedules);
  } catch (error) {
    logger.error('Error fetching due assessments', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch due assessments' });
  }
});

// ==================== PATIENT PROGRESS NOTES ====================

router.post('/patients/:id/progress-notes', isAuthenticated, async (req: any, res) => {
  try {
    const user = req.user;
    const patientId = parseInt(req.params.id);
    const patient = await storage.getPatient(patientId);
    if (!patient) return res.status(404).json({ message: 'Patient not found' });

    const { sessionId, sessionDate, summary, goalsDiscussed, homework, nextSessionFocus, autoGenerate } = req.body;
    let finalSummary = summary;

    if (autoGenerate && sessionId && process.env.OPENAI_API_KEY) {
      try {
        const soapNote = await storage.getSoapNoteBySession(sessionId);
        if (soapNote) {
          const OpenAI = (await import('openai')).default;
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `You are a helpful therapy assistant. Generate a patient-friendly progress note summary from a clinical SOAP note.
The summary should:
- Be written in plain, warm language that a patient can understand
- Avoid clinical jargon
- Focus on progress, activities done, and next steps
- Be encouraging but honest
- Be 2-4 paragraphs
- NOT include any private clinical assessments or diagnostic reasoning

Also extract:
1. Goals discussed (as a JSON array of short strings)
2. Homework/home exercises (if any)
3. Next session focus (if mentioned)

Return JSON: { "summary": "...", "goalsDiscussed": ["..."], "homework": "..." or null, "nextSessionFocus": "..." or null }`
              },
              {
                role: 'user',
                content: `SOAP Note:\nSubjective: ${soapNote.subjective}\nObjective: ${soapNote.objective}\nAssessment: ${soapNote.assessment}\nPlan: ${soapNote.plan}\n${soapNote.homeProgram ? `Home Program: ${soapNote.homeProgram}` : ''}`
              }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.7,
          });

          const generated = JSON.parse(completion.choices[0].message.content || '{}');
          finalSummary = generated.summary || summary;

          const note = await storage.createPatientProgressNote({
            patientId, practiceId: patient.practiceId,
            sessionId: sessionId || null,
            sessionDate: sessionDate || new Date().toISOString().split('T')[0],
            therapistName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Therapist',
            summary: finalSummary,
            goalsDiscussed: generated.goalsDiscussed || goalsDiscussed || [],
            homework: generated.homework || homework || null,
            nextSessionFocus: generated.nextSessionFocus || nextSessionFocus || null,
            sharedAt: null, sharedBy: null,
          });

          return res.json(note);
        }
      } catch (aiError) {
        logger.error('Error auto-generating progress note', { error: aiError instanceof Error ? aiError.message : String(aiError) });
      }
    }

    const note = await storage.createPatientProgressNote({
      patientId, practiceId: patient.practiceId,
      sessionId: sessionId || null,
      sessionDate: sessionDate || new Date().toISOString().split('T')[0],
      therapistName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Therapist',
      summary: finalSummary || '',
      goalsDiscussed: goalsDiscussed || [],
      homework: homework || null,
      nextSessionFocus: nextSessionFocus || null,
      sharedAt: null, sharedBy: null,
    });

    res.json(note);
  } catch (error) {
    logger.error('Error creating progress note', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create progress note' });
  }
});

router.get('/patients/:id/progress-notes', isAuthenticated, async (req: any, res) => {
  try {
    const notes = await storage.getPatientProgressNotes(parseInt(req.params.id));
    res.json(notes);
  } catch (error) {
    logger.error('Error fetching progress notes', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch progress notes' });
  }
});

router.put('/patients/:id/progress-notes/:noteId/share', isAuthenticated, async (req: any, res) => {
  try {
    const noteId = parseInt(req.params.noteId);
    const note = await storage.getPatientProgressNote(noteId);
    if (!note || note.patientId !== parseInt(req.params.id)) {
      return res.status(404).json({ message: 'Progress note not found' });
    }
    const updated = await storage.sharePatientProgressNote(noteId, req.user.id);
    res.json(updated);
  } catch (error) {
    logger.error('Error sharing progress note', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to share progress note' });
  }
});

router.put('/patients/:id/progress-notes/:noteId/unshare', isAuthenticated, async (req: any, res) => {
  try {
    const noteId = parseInt(req.params.noteId);
    const note = await storage.getPatientProgressNote(noteId);
    if (!note || note.patientId !== parseInt(req.params.id)) {
      return res.status(404).json({ message: 'Progress note not found' });
    }
    const updated = await storage.unsharePatientProgressNote(noteId);
    res.json(updated);
  } catch (error) {
    logger.error('Error unsharing progress note', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to unshare progress note' });
  }
});

export default router;
