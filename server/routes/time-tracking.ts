/**
 * Time Tracking Routes
 *
 * Handles:
 * - POST   /api/time-tracking/start         - Start a timer
 * - POST   /api/time-tracking/:id/stop      - Stop a running timer
 * - POST   /api/time-tracking/manual        - Create a manual time entry
 * - GET    /api/time-tracking               - List time entries (with filters)
 * - GET    /api/time-tracking/active        - Get active (running) timers
 * - GET    /api/time-tracking/summary       - Get time summary for practice
 * - PATCH  /api/time-tracking/:id           - Update a time entry
 * - DELETE /api/time-tracking/:id           - Delete a time entry
 */

import { Router } from 'express';
import { isAuthenticated } from '../replitAuth';
import * as timeTrackingService from '../services/timeTrackingService';
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

/**
 * POST /api/time-tracking/start
 * Start a new timer for the authenticated user.
 */
router.post('/start', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const practiceId = getAuthorizedPracticeId(req);
    const { activityType, patientId, appointmentId } = req.body;

    if (!activityType) {
      return res.status(400).json({ message: 'activityType is required' });
    }

    const entry = await timeTrackingService.startTimer(
      userId,
      practiceId,
      activityType,
      patientId || undefined,
      appointmentId || undefined,
    );

    res.status(201).json(entry);
  } catch (error: any) {
    logger.error('Error starting timer', { error: error.message });
    const status = error.message.includes('active timer') ? 409 : 400;
    res.status(status).json({ message: error.message });
  }
});

/**
 * POST /api/time-tracking/:id/stop
 * Stop a running timer.
 */
router.post('/:id/stop', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const entryId = parseInt(req.params.id);
    if (isNaN(entryId)) {
      return res.status(400).json({ message: 'Invalid entry ID' });
    }

    const { notes } = req.body;

    const entry = await timeTrackingService.stopTimer(entryId, userId, notes);
    res.json(entry);
  } catch (error: any) {
    logger.error('Error stopping timer', { error: error.message });
    const status = error.message.includes('not found') ? 404 : 400;
    res.status(status).json({ message: error.message });
  }
});

/**
 * POST /api/time-tracking/manual
 * Create a manual time entry with start and end times.
 */
router.post('/manual', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const practiceId = getAuthorizedPracticeId(req);
    const { activityType, startTime, endTime, patientId, appointmentId, notes, billable } = req.body;

    if (!activityType || !startTime || !endTime) {
      return res.status(400).json({ message: 'activityType, startTime, and endTime are required' });
    }

    const entry = await timeTrackingService.createManualEntry(userId, practiceId, {
      activityType,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      patientId: patientId || undefined,
      appointmentId: appointmentId || undefined,
      notes,
      billable,
    });

    res.status(201).json(entry);
  } catch (error: any) {
    logger.error('Error creating manual entry', { error: error.message });
    res.status(400).json({ message: error.message });
  }
});

/**
 * GET /api/time-tracking/active
 * Get active (running) timers for the authenticated user.
 */
router.get('/active', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const timers = await timeTrackingService.getActiveTimers(userId);
    res.json(timers);
  } catch (error: any) {
    logger.error('Error getting active timers', { error: error.message });
    res.status(500).json({ message: 'Failed to get active timers' });
  }
});

/**
 * GET /api/time-tracking/summary
 * Get time summary for the practice within a date range.
 * Query params: startDate, endDate (ISO strings)
 */
router.get('/summary', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate query params are required' });
    }

    const summary = await timeTrackingService.getTimeSummary(
      practiceId,
      new Date(startDate as string),
      new Date(endDate as string),
    );

    res.json(summary);
  } catch (error: any) {
    logger.error('Error getting time summary', { error: error.message });
    res.status(500).json({ message: 'Failed to get time summary' });
  }
});

/**
 * GET /api/time-tracking
 * List time entries for the authenticated user with optional filters.
 * Query params: startDate, endDate, activityType, billable, patientId
 */
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const practiceId = getAuthorizedPracticeId(req);
    const { startDate, endDate, activityType, billable, patientId } = req.query;

    const filters: timeTrackingService.TimeEntryFilters = {};
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);
    if (activityType) filters.activityType = activityType as string;
    if (billable !== undefined) filters.billable = billable === 'true';
    if (patientId) filters.patientId = parseInt(patientId as string);

    const entries = await timeTrackingService.getTimeEntries(userId, practiceId, filters);
    res.json(entries);
  } catch (error: any) {
    logger.error('Error getting time entries', { error: error.message });
    res.status(500).json({ message: 'Failed to get time entries' });
  }
});

/**
 * PATCH /api/time-tracking/:id
 * Update a time entry.
 */
router.patch('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const entryId = parseInt(req.params.id);
    if (isNaN(entryId)) {
      return res.status(400).json({ message: 'Invalid entry ID' });
    }

    const { activityType, notes, billable, patientId, appointmentId } = req.body;
    const data: any = {};
    if (activityType !== undefined) data.activityType = activityType;
    if (notes !== undefined) data.notes = notes;
    if (billable !== undefined) data.billable = billable;
    if (patientId !== undefined) data.patientId = patientId;
    if (appointmentId !== undefined) data.appointmentId = appointmentId;

    const entry = await timeTrackingService.updateTimeEntry(entryId, userId, data);
    res.json(entry);
  } catch (error: any) {
    logger.error('Error updating time entry', { error: error.message });
    const status = error.message.includes('not found') ? 404 : 400;
    res.status(status).json({ message: error.message });
  }
});

/**
 * DELETE /api/time-tracking/:id
 * Delete a time entry.
 */
router.delete('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const entryId = parseInt(req.params.id);
    if (isNaN(entryId)) {
      return res.status(400).json({ message: 'Invalid entry ID' });
    }

    await timeTrackingService.deleteTimeEntry(entryId, userId);
    res.status(204).send();
  } catch (error: any) {
    logger.error('Error deleting time entry', { error: error.message });
    const status = error.message.includes('not found') ? 404 : 400;
    res.status(status).json({ message: error.message });
  }
});

export default router;
