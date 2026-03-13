/**
 * Claim Follow-Up Routes
 *
 * Handles:
 * - GET    /api/follow-ups          - List follow-ups with filters
 * - GET    /api/follow-ups/summary  - Summary counts by status/priority
 * - POST   /api/follow-ups/generate - Generate follow-ups for aging/denied claims
 * - PATCH  /api/follow-ups/:id      - Update a follow-up
 * - POST   /api/follow-ups/:id/dismiss - Dismiss a follow-up
 */

import { Router, type Response } from 'express';
import { isAuthenticated } from '../replitAuth';
import {
  generateFollowUps,
  getFollowUps,
  updateFollowUp,
  getFollowUpSummary,
  dismissFollowUp,
} from '../services/claimFollowUpService';
import logger from '../services/logger';

const router = Router();

// Helper to get authorized practiceId from request
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) {
    return req.authorizedPracticeId;
  }
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;

  if (userRole === 'admin') {
    return requestedPracticeId || userPracticeId || 1;
  }

  if (!userPracticeId) {
    throw new Error('User not assigned to a practice. Contact administrator.');
  }

  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    return userPracticeId;
  }

  return requestedPracticeId || userPracticeId;
};

// Safe error response
const safeErrorResponse = (res: Response, statusCode: number, publicMessage: string, error?: any) => {
  if (error) {
    logger.error(publicMessage, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return res.status(statusCode).json({ message: publicMessage });
};

/**
 * GET /api/follow-ups
 * List follow-ups with optional filters: status, priority, followUpType, assignedTo
 */
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters: Record<string, string> = {};
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.priority) filters.priority = req.query.priority as string;
    if (req.query.followUpType) filters.followUpType = req.query.followUpType as string;
    if (req.query.assignedTo) filters.assignedTo = req.query.assignedTo as string;

    const followUps = await getFollowUps(practiceId, filters);
    res.json(followUps);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch follow-ups', error);
  }
});

/**
 * GET /api/follow-ups/summary
 * Returns counts by status and priority.
 */
router.get('/summary', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const summary = await getFollowUpSummary(practiceId);
    res.json(summary);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch follow-up summary', error);
  }
});

/**
 * POST /api/follow-ups/generate
 * Scan claims and generate follow-up tasks for aging/denied claims.
 */
router.post('/generate', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const followUps = await generateFollowUps(practiceId);
    res.json({
      message: `Generated ${followUps.length} follow-up tasks`,
      followUps,
    });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to generate follow-ups', error);
  }
});

/**
 * PATCH /api/follow-ups/:id
 * Update status, notes, assignment, or priority.
 */
router.patch('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid follow-up ID' });
    }

    const practiceId = getAuthorizedPracticeId(req);
    const { status, notes, assignedTo, priority } = req.body;

    const updated = await updateFollowUp(id, practiceId, {
      status,
      notes,
      assignedTo,
      priority,
    });

    if (!updated) {
      return res.status(404).json({ message: 'Follow-up not found' });
    }

    res.json(updated);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to update follow-up', error);
  }
});

/**
 * POST /api/follow-ups/:id/dismiss
 * Mark a follow-up as dismissed.
 */
router.post('/:id/dismiss', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid follow-up ID' });
    }

    const practiceId = getAuthorizedPracticeId(req);
    const dismissed = await dismissFollowUp(id, practiceId);

    if (!dismissed) {
      return res.status(404).json({ message: 'Follow-up not found' });
    }

    res.json(dismissed);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to dismiss follow-up', error);
  }
});

export default router;
