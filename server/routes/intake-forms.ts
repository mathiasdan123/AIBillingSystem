/**
 * Intake Forms Routes
 *
 * Handles:
 * - /api/intake-forms/templates - Template CRUD
 * - /api/intake-forms/submissions - Submission management
 * - /api/intake-forms/submissions/:id/review - Mark as reviewed
 * - /api/intake-forms/pending - Pending submissions
 */

import { Router } from 'express';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import {
  createTemplate,
  getTemplates,
  getTemplate,
  updateTemplate,
  submitForm,
  getSubmissions,
  getSubmission,
  markReviewed,
  getPendingSubmissions,
} from '../services/intakeFormService';

const router = Router();

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

// ==================== Template Routes ====================

// GET /api/intake-forms/templates - list active templates for practice
router.get('/templates', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const templates = await getTemplates(practiceId);
    res.json(templates);
  } catch (error) {
    logger.error('Error fetching intake form templates', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch intake form templates' });
  }
});

// GET /api/intake-forms/templates/:id - get single template
router.get('/templates/:id', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    const template = await getTemplate(id, practiceId);
    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }
    res.json(template);
  } catch (error) {
    logger.error('Error fetching intake form template', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch intake form template' });
  }
});

// POST /api/intake-forms/templates - create template
router.post('/templates', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const template = await createTemplate(practiceId, req.body);
    res.status(201).json(template);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('required')) {
      return res.status(400).json({ message });
    }
    logger.error('Error creating intake form template', { error: message });
    res.status(500).json({ message: 'Failed to create intake form template' });
  }
});

// PUT /api/intake-forms/templates/:id - update template
router.put('/templates/:id', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    const template = await updateTemplate(id, practiceId, req.body);
    res.json(template);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('not found')) {
      return res.status(404).json({ message });
    }
    logger.error('Error updating intake form template', { error: message });
    res.status(500).json({ message: 'Failed to update intake form template' });
  }
});

// ==================== Submission Routes ====================

// GET /api/intake-forms/submissions - list submissions with optional filters
router.get('/submissions', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters: Record<string, unknown> = {};
    if (req.query.patientId) filters.patientId = parseInt(req.query.patientId as string);
    if (req.query.status) filters.status = req.query.status;
    if (req.query.templateId) filters.templateId = parseInt(req.query.templateId as string);
    const submissions = await getSubmissions(practiceId, filters);
    res.json(submissions);
  } catch (error) {
    logger.error('Error fetching intake form submissions', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch intake form submissions' });
  }
});

// GET /api/intake-forms/pending - pending submissions
router.get('/pending', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const submissions = await getPendingSubmissions(practiceId);
    res.json(submissions);
  } catch (error) {
    logger.error('Error fetching pending intake form submissions', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch pending submissions' });
  }
});

// GET /api/intake-forms/submissions/:id - single submission
router.get('/submissions/:id', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    const submission = await getSubmission(id, practiceId);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    res.json(submission);
  } catch (error) {
    logger.error('Error fetching intake form submission', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch intake form submission' });
  }
});

// POST /api/intake-forms/submissions - submit a form
router.post('/submissions', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { templateId, patientId, responses } = req.body;

    if (!templateId || !patientId || !responses) {
      return res.status(400).json({ message: 'templateId, patientId, and responses are required' });
    }

    const submission = await submitForm(templateId, practiceId, patientId, responses);
    res.status(201).json(submission);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('not found')) {
      return res.status(404).json({ message });
    }
    if (message.includes('Missing required fields')) {
      return res.status(400).json({ message });
    }
    logger.error('Error submitting intake form', { error: message });
    res.status(500).json({ message: 'Failed to submit intake form' });
  }
});

// POST /api/intake-forms/submissions/:id/review - mark submission as reviewed
router.post('/submissions/:id/review', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    const userId = req.user?.id || req.userId;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const submission = await markReviewed(id, practiceId, userId);
    res.json(submission);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('not found')) {
      return res.status(404).json({ message });
    }
    if (message.includes('already reviewed')) {
      return res.status(400).json({ message });
    }
    logger.error('Error reviewing intake form submission', { error: message });
    res.status(500).json({ message: 'Failed to review intake form submission' });
  }
});

export default router;
