/**
 * Claim Follow-Up Routes
 *
 * Handles:
 * - GET    /api/follow-ups          - List follow-ups with filters
 * - GET    /api/follow-ups/summary  - Summary counts by status/priority
 * - POST   /api/follow-ups/generate - Generate follow-ups for aging/denied claims
 * - PATCH  /api/follow-ups/:id      - Update a follow-up (status, notes, assignee,
 *                                     priority, dueDate YYYY-MM-DD|null, snoozedUntil null)
 * - POST   /api/follow-ups/:id/complete - Mark complete (records who)
 * - POST   /api/follow-ups/:id/snooze   - Hide from the open queue until a date
 * - POST   /api/follow-ups/:id/dismiss  - Dismiss a follow-up
 *
 * Every write is scoped to the caller's practice (the service's WHERE carries
 * practiceId), so an id from another practice is a 404, never a cross-tenant
 * edit.
 */

import { Router, type Response } from 'express';
import { isAuthenticated } from '../replitAuth';
import {
  generateFollowUps,
  getFollowUps,
  updateFollowUp,
  getFollowUpSummary,
  dismissFollowUp,
  completeFollowUp,
  snoozeFollowUp,
  type FollowUpUpdates,
} from '../services/claimFollowUpService';
import { parseDateOnly } from '../utils/dateOnly';
import { getBusinessTimeZone, zonedInstant } from '../utils/timezone';
import logger from '../services/logger';

const router = Router();

const FOLLOW_UP_STATUSES = ['pending', 'in_progress', 'completed', 'dismissed'] as const;
const FOLLOW_UP_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The signed-in user's id, for completedBy. */
const currentUserId = (req: any): string | null =>
  req.user?.claims?.sub ?? req.user?.id ?? null;

/**
 * Parse a YYYY-MM-DD body value into the UTC-midnight Date the dueDate
 * column stores (date-only semantics: see shared/schema.ts). Returns
 * undefined for "not supplied", null for an explicit clear, or an error
 * object for a malformed value.
 */
function parseDueDateInput(value: unknown): Date | null | undefined | { error: string } {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return { error: 'dueDate must be a YYYY-MM-DD string or null' };
  const parsed = DATE_ONLY.test(value) ? parseDateOnly(value) : null;
  if (!parsed) return { error: 'dueDate must be a valid YYYY-MM-DD date' };
  return parsed;
}

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

  if (userRole === 'admin' && req.isPlatformAdmin) {
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
 * Update status, notes, assignment, priority, due date (YYYY-MM-DD or null),
 * or clear a snooze (snoozedUntil: null).
 */
router.patch('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid follow-up ID' });
    }

    const practiceId = getAuthorizedPracticeId(req);
    const { status, notes, assignedTo, priority, dueDate, snoozedUntil } = req.body ?? {};

    if (status !== undefined && !FOLLOW_UP_STATUSES.includes(status)) {
      return res.status(400).json({ message: `status must be one of ${FOLLOW_UP_STATUSES.join(', ')}` });
    }
    if (priority !== undefined && !FOLLOW_UP_PRIORITIES.includes(priority)) {
      return res.status(400).json({ message: `priority must be one of ${FOLLOW_UP_PRIORITIES.join(', ')}` });
    }
    const due = parseDueDateInput(dueDate);
    if (due && typeof due === 'object' && 'error' in due) {
      return res.status(400).json({ message: due.error });
    }
    // Only un-snoozing goes through PATCH; setting a snooze uses /snooze so
    // the date is resolved in the practice timezone in one place.
    if (snoozedUntil !== undefined && snoozedUntil !== null) {
      return res.status(400).json({ message: 'Use POST /:id/snooze to snooze; PATCH accepts snoozedUntil: null only' });
    }

    const updates: FollowUpUpdates = { status, notes, assignedTo, priority };
    if (due !== undefined) updates.dueDate = due as Date | null;
    if (snoozedUntil === null) updates.snoozedUntil = null;
    if (status === 'completed') updates.completedBy = currentUserId(req);

    const updated = await updateFollowUp(id, practiceId, updates);

    if (!updated) {
      return res.status(404).json({ message: 'Follow-up not found' });
    }

    logger.info('Follow-up updated', { followUpId: id, practiceId, fields: Object.keys(req.body ?? {}) });
    res.json(updated);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to update follow-up', error);
  }
});

/**
 * POST /api/follow-ups/:id/complete
 * Mark a follow-up complete; records the signed-in user as completedBy.
 */
router.post('/:id/complete', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid follow-up ID' });
    }
    const practiceId = getAuthorizedPracticeId(req);
    const completed = await completeFollowUp(id, practiceId, currentUserId(req));
    if (!completed) {
      return res.status(404).json({ message: 'Follow-up not found' });
    }
    logger.info('Follow-up completed', { followUpId: id, practiceId });
    res.json(completed);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to complete follow-up', error);
  }
});

/**
 * POST /api/follow-ups/:id/snooze
 * Body: { until: 'YYYY-MM-DD' } or { days: 1..90 }.
 * Hides the item from the open queue until the start of that day in the
 * practice timezone. The day must be after today.
 */
router.post('/:id/snooze', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid follow-up ID' });
    }
    const practiceId = getAuthorizedPracticeId(req);
    const { until, days } = req.body ?? {};

    let day: string;
    if (typeof until === 'string') {
      if (!DATE_ONLY.test(until) || !parseDateOnly(until)) {
        return res.status(400).json({ message: 'until must be a valid YYYY-MM-DD date' });
      }
      day = until;
    } else if (Number.isInteger(days) && days >= 1 && days <= 90) {
      day = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', {
        timeZone: getBusinessTimeZone(),
      });
    } else {
      return res.status(400).json({ message: 'Provide until (YYYY-MM-DD) or days (1-90)' });
    }

    const untilInstant = zonedInstant(day, '00:00');
    if (untilInstant.getTime() <= Date.now()) {
      return res.status(400).json({ message: 'Snooze date must be after today' });
    }

    const snoozed = await snoozeFollowUp(id, practiceId, untilInstant);
    if (!snoozed) {
      return res.status(404).json({ message: 'Follow-up not found' });
    }
    logger.info('Follow-up snoozed', { followUpId: id, practiceId, until: day });
    res.json(snoozed);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to snooze follow-up', error);
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
