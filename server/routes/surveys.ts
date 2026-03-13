/**
 * Survey Routes
 *
 * Handles:
 * - /api/surveys/templates - Survey template CRUD
 * - /api/surveys/assign - Assign surveys to patients
 * - /api/surveys/responses - View survey responses
 * - /api/surveys/patient/:id/history - Patient assessment history with score trends
 * - /api/patient-portal/surveys - Patient portal survey endpoints
 */

import { Router } from 'express';
import { db } from '../db';
import { eq, and, desc, inArray, isNull } from 'drizzle-orm';
import {
  surveyTemplates,
  surveyAssignments,
  surveyResponses,
  patients,
} from '@shared/schema';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';
import logger from '../services/logger';

const router = Router();

// ==================== PHQ-9 and GAD-7 Built-in Templates ====================

const PHQ9_QUESTIONS = [
  { id: "phq9_1", text: "Little interest or pleasure in doing things", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
  { id: "phq9_2", text: "Feeling down, depressed, or hopeless", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
  { id: "phq9_3", text: "Trouble falling or staying asleep, or sleeping too much", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
  { id: "phq9_4", text: "Feeling tired or having little energy", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
  { id: "phq9_5", text: "Poor appetite or overeating", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
  { id: "phq9_6", text: "Feeling bad about yourself — or that you are a failure or have let yourself or your family down", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
  { id: "phq9_7", text: "Trouble concentrating on things, such as reading the newspaper or watching television", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
  { id: "phq9_8", text: "Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
  { id: "phq9_9", text: "Thoughts that you would be better off dead or of hurting yourself in some way", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
];

const GAD7_QUESTIONS = [
  { id: "gad7_1", text: "Feeling nervous, anxious, or on edge", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
  { id: "gad7_2", text: "Not being able to stop or control worrying", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
  { id: "gad7_3", text: "Worrying too much about different things", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
  { id: "gad7_4", text: "Trouble relaxing", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
  { id: "gad7_5", text: "Being so restless that it's hard to sit still", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
  { id: "gad7_6", text: "Becoming easily annoyed or irritable", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
  { id: "gad7_7", text: "Feeling afraid as if something awful might happen", type: "scale" as const, options: ["Not at all", "Several days", "More than half the days", "Nearly every day"], required: true },
];

// ==================== Scoring Logic ====================

function scorePHQ9(responses: Array<{ questionId: string; answer: number }>): { totalScore: number; severity: string } {
  const totalScore = responses.reduce((sum, r) => sum + (typeof r.answer === 'number' ? r.answer : 0), 0);
  let severity: string;
  if (totalScore <= 4) severity = "minimal";
  else if (totalScore <= 9) severity = "mild";
  else if (totalScore <= 14) severity = "moderate";
  else if (totalScore <= 19) severity = "moderately_severe";
  else severity = "severe";
  return { totalScore, severity };
}

function scoreGAD7(responses: Array<{ questionId: string; answer: number }>): { totalScore: number; severity: string } {
  const totalScore = responses.reduce((sum, r) => sum + (typeof r.answer === 'number' ? r.answer : 0), 0);
  let severity: string;
  if (totalScore <= 4) severity = "minimal";
  else if (totalScore <= 9) severity = "mild";
  else if (totalScore <= 14) severity = "moderate";
  else severity = "severe";
  return { totalScore, severity };
}

function scoreStandardized(type: string, responses: Array<{ questionId: string; answer: number }>): { totalScore: number | null; severity: string | null } {
  switch (type) {
    case 'phq9': return scorePHQ9(responses);
    case 'gad7': return scoreGAD7(responses);
    default: return { totalScore: null, severity: null };
  }
}

// Helper to get authorized practiceId from request
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
  if (userRole === 'admin') return requestedPracticeId || userPracticeId || 1;
  if (!userPracticeId) throw new Error('User not assigned to a practice.');
  return requestedPracticeId && requestedPracticeId !== userPracticeId ? userPracticeId : (requestedPracticeId || userPracticeId);
};

// Helper: get patient from portal token
const getPatientFromPortalToken = async (req: any): Promise<{ patient: any; access: any } | null> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  const access = await storage.getPatientPortalByToken(token);
  if (!access) return null;
  const patient = await storage.getPatient(access.patientId);
  if (!patient) return null;
  return { patient, access };
};

// Ensure built-in templates exist for a practice
async function ensureBuiltInTemplates(practiceId: number) {
  const { db: database } = await import('../db');

  // Check if built-in templates already exist for this practice
  const existing = await database.select().from(surveyTemplates)
    .where(and(
      eq(surveyTemplates.practiceId, practiceId),
      eq(surveyTemplates.isBuiltIn, true),
    ));

  const existingTypes = new Set(existing.map((t: any) => t.type));
  const toInsert: Array<{
    practiceId: number;
    name: string;
    description: string;
    type: string;
    questions: typeof PHQ9_QUESTIONS | typeof GAD7_QUESTIONS;
    isActive: boolean;
    isBuiltIn: boolean;
  }> = [];

  if (!existingTypes.has('phq9')) {
    toInsert.push({
      practiceId,
      name: "PHQ-9 (Patient Health Questionnaire)",
      description: "A 9-item questionnaire for screening, diagnosing, monitoring and measuring the severity of depression. Score range: 0-27.",
      type: "phq9",
      questions: PHQ9_QUESTIONS,
      isActive: true,
      isBuiltIn: true,
    });
  }

  if (!existingTypes.has('gad7')) {
    toInsert.push({
      practiceId,
      name: "GAD-7 (Generalized Anxiety Disorder)",
      description: "A 7-item questionnaire for screening and measuring the severity of generalized anxiety disorder. Score range: 0-21.",
      type: "gad7",
      questions: GAD7_QUESTIONS,
      isActive: true,
      isBuiltIn: true,
    });
  }

  if (toInsert.length > 0) {
    await database.insert(surveyTemplates).values(toInsert);
  }
}

// ==================== Therapist-facing Routes ====================

// GET /api/surveys/templates - list templates for practice
router.get('/templates', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    await ensureBuiltInTemplates(practiceId);

    const { db: database } = await import('../db');
    const templates = await database.select().from(surveyTemplates)
      .where(eq(surveyTemplates.practiceId, practiceId))
      .orderBy(desc(surveyTemplates.createdAt));

    res.json(templates);
  } catch (error) {
    logger.error('Error fetching survey templates', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch survey templates' });
  }
});

// POST /api/surveys/templates - create custom survey template
router.post('/templates', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { name, description, type, questions } = req.body;

    if (!name || !questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ message: 'Name and at least one question are required' });
    }

    const { db: database } = await import('../db');
    const [template] = await database.insert(surveyTemplates).values({
      practiceId,
      name,
      description: description || null,
      type: type || 'custom',
      questions,
      isActive: true,
      isBuiltIn: false,
    }).returning();

    res.status(201).json(template);
  } catch (error) {
    logger.error('Error creating survey template', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create survey template' });
  }
});

// POST /api/surveys/assign - assign survey to patient(s)
router.post('/assign', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const userId = req.user?.id || req.userId;
    const { surveyTemplateId, patientIds, dueDate } = req.body;

    if (!surveyTemplateId || !patientIds || !Array.isArray(patientIds) || patientIds.length === 0) {
      return res.status(400).json({ message: 'Template ID and at least one patient ID are required' });
    }

    const { db: database } = await import('../db');

    // Verify template exists
    const [template] = await database.select().from(surveyTemplates)
      .where(and(eq(surveyTemplates.id, surveyTemplateId), eq(surveyTemplates.practiceId, practiceId)));

    if (!template) {
      return res.status(404).json({ message: 'Survey template not found' });
    }

    const assignments = await database.insert(surveyAssignments).values(
      patientIds.map((patientId: number) => ({
        surveyTemplateId,
        patientId,
        practiceId,
        assignedBy: userId,
        dueDate: dueDate ? new Date(dueDate) : null,
        status: 'pending',
      }))
    ).returning();

    res.status(201).json(assignments);
  } catch (error) {
    logger.error('Error assigning survey', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to assign survey' });
  }
});

// GET /api/surveys/responses - list responses with filters
router.get('/responses', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { patientId, templateId } = req.query;

    const { db: database } = await import('../db');

    let conditions = [eq(surveyResponses.practiceId, practiceId)];
    if (patientId) conditions.push(eq(surveyResponses.patientId, parseInt(patientId as string)));
    if (templateId) conditions.push(eq(surveyResponses.surveyTemplateId, parseInt(templateId as string)));

    const responses = await database.select({
      response: surveyResponses,
      templateName: surveyTemplates.name,
      templateType: surveyTemplates.type,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
    })
      .from(surveyResponses)
      .leftJoin(surveyTemplates, eq(surveyResponses.surveyTemplateId, surveyTemplates.id))
      .leftJoin(patients, eq(surveyResponses.patientId, patients.id))
      .where(and(...conditions))
      .orderBy(desc(surveyResponses.completedAt));

    const formatted = responses.map((r: any) => ({
      ...r.response,
      templateName: r.templateName,
      templateType: r.templateType,
      patientName: `${r.patientFirstName || ''} ${r.patientLastName || ''}`.trim(),
    }));

    res.json(formatted);
  } catch (error) {
    logger.error('Error fetching survey responses', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch survey responses' });
  }
});

// GET /api/surveys/patient/:id/history - patient assessment history with score trends
router.get('/patient/:id/history', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const patientId = parseInt(req.params.id);

    const { db: database } = await import('../db');
    const history = await database.select({
      response: surveyResponses,
      templateName: surveyTemplates.name,
      templateType: surveyTemplates.type,
    })
      .from(surveyResponses)
      .leftJoin(surveyTemplates, eq(surveyResponses.surveyTemplateId, surveyTemplates.id))
      .where(and(
        eq(surveyResponses.patientId, patientId),
        eq(surveyResponses.practiceId, practiceId),
      ))
      .orderBy(desc(surveyResponses.completedAt));

    // Group by template type for trend data
    const byType: Record<string, Array<{
      id: number;
      score: number | null;
      severity: string | null;
      completedAt: string | null;
      templateName: string | null;
    }>> = {};

    for (const item of history) {
      const type = item.templateType || 'custom';
      if (!byType[type]) byType[type] = [];
      byType[type].push({
        id: item.response.id,
        score: item.response.totalScore,
        severity: item.response.severity,
        completedAt: item.response.completedAt?.toISOString() || null,
        templateName: item.templateName,
      });
    }

    res.json({
      history: history.map((h: any) => ({
        ...h.response,
        templateName: h.templateName,
        templateType: h.templateType,
      })),
      trends: byType,
    });
  } catch (error) {
    logger.error('Error fetching patient survey history', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch survey history' });
  }
});

// GET /api/surveys/assignments - list assignments for the practice
router.get('/assignments', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { status } = req.query;

    const { db: database } = await import('../db');
    let conditions = [eq(surveyAssignments.practiceId, practiceId)];
    if (status) conditions.push(eq(surveyAssignments.status, status as string));

    const assignments = await database.select({
      assignment: surveyAssignments,
      templateName: surveyTemplates.name,
      templateType: surveyTemplates.type,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
    })
      .from(surveyAssignments)
      .leftJoin(surveyTemplates, eq(surveyAssignments.surveyTemplateId, surveyTemplates.id))
      .leftJoin(patients, eq(surveyAssignments.patientId, patients.id))
      .where(and(...conditions))
      .orderBy(desc(surveyAssignments.createdAt));

    const formatted = assignments.map((a: any) => ({
      ...a.assignment,
      templateName: a.templateName,
      templateType: a.templateType,
      patientName: `${a.patientFirstName || ''} ${a.patientLastName || ''}`.trim(),
    }));

    res.json(formatted);
  } catch (error) {
    logger.error('Error fetching survey assignments', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch survey assignments' });
  }
});

// ==================== Patient Portal Routes ====================

// GET /api/patient-portal/surveys - pending surveys for logged-in patient
router.get('/patient-portal/surveys', async (req: any, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient } = auth;
    const { db: database } = await import('../db');

    // Get pending assignments with template details
    const pendingAssignments = await database.select({
      assignment: surveyAssignments,
      template: surveyTemplates,
    })
      .from(surveyAssignments)
      .leftJoin(surveyTemplates, eq(surveyAssignments.surveyTemplateId, surveyTemplates.id))
      .where(and(
        eq(surveyAssignments.patientId, patient.id),
        eq(surveyAssignments.status, 'pending'),
      ))
      .orderBy(desc(surveyAssignments.createdAt));

    // Get completed responses
    const completedResponses = await database.select({
      response: surveyResponses,
      templateName: surveyTemplates.name,
      templateType: surveyTemplates.type,
    })
      .from(surveyResponses)
      .leftJoin(surveyTemplates, eq(surveyResponses.surveyTemplateId, surveyTemplates.id))
      .where(eq(surveyResponses.patientId, patient.id))
      .orderBy(desc(surveyResponses.completedAt));

    res.json({
      pending: pendingAssignments.map((a: any) => ({
        assignmentId: a.assignment.id,
        template: a.template,
        dueDate: a.assignment.dueDate,
        createdAt: a.assignment.createdAt,
      })),
      completed: completedResponses.map((r: any) => ({
        ...r.response,
        templateName: r.templateName,
        templateType: r.templateType,
      })),
    });
  } catch (error) {
    logger.error('Error fetching patient surveys', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch surveys' });
  }
});

// POST /api/patient-portal/surveys/:id/respond - submit survey response
router.post('/patient-portal/surveys/:id/respond', async (req: any, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient } = auth;
    const assignmentId = parseInt(req.params.id);
    const { responses: responseData } = req.body;

    if (!responseData || !Array.isArray(responseData)) {
      return res.status(400).json({ message: 'Responses array is required' });
    }

    const { db: database } = await import('../db');

    // Get the assignment
    const [assignment] = await database.select()
      .from(surveyAssignments)
      .where(and(
        eq(surveyAssignments.id, assignmentId),
        eq(surveyAssignments.patientId, patient.id),
        eq(surveyAssignments.status, 'pending'),
      ));

    if (!assignment) {
      return res.status(404).json({ message: 'Survey assignment not found or already completed' });
    }

    // Get the template for scoring
    const [template] = await database.select()
      .from(surveyTemplates)
      .where(eq(surveyTemplates.id, assignment.surveyTemplateId));

    if (!template) {
      return res.status(404).json({ message: 'Survey template not found' });
    }

    // Score standardized assessments
    const { totalScore, severity } = scoreStandardized(template.type, responseData);

    // Create response
    const [response] = await database.insert(surveyResponses).values({
      surveyTemplateId: assignment.surveyTemplateId,
      assignmentId: assignment.id,
      patientId: patient.id,
      practiceId: assignment.practiceId,
      assignedBy: assignment.assignedBy,
      responses: responseData,
      totalScore,
      severity,
      completedAt: new Date(),
    }).returning();

    // Update assignment status
    await database.update(surveyAssignments)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(surveyAssignments.id, assignmentId));

    res.status(201).json({
      ...response,
      templateName: template.name,
      templateType: template.type,
    });
  } catch (error) {
    logger.error('Error submitting survey response', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to submit survey response' });
  }
});

export default router;
