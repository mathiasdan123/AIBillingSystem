/**
 * Scheduling Optimization Routes
 *
 * Handles:
 * - GET /api/scheduling/analysis — schedule analysis for a therapist
 * - GET /api/scheduling/optimal-slots — suggest optimal slots for new appointment
 * - GET /api/scheduling/insights — AI-generated scheduling insights
 * - GET /api/scheduling/utilization — utilization heatmap data (hour x day grid)
 */

import { Router } from 'express';
import { isAuthenticated } from '../replitAuth';
import {
  analyzeSchedule,
  suggestOptimalSlots,
  generateScheduleInsights,
  getUtilizationHeatmap,
} from '../services/schedulingOptimizer';
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
 * GET /api/scheduling/analysis
 * Analyze a therapist's schedule over a date range.
 *
 * Query params:
 * - therapistId (required)
 * - start (ISO date string, required)
 * - end (ISO date string, required)
 * - practiceId (optional, admin only)
 */
router.get('/analysis', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { therapistId, start, end } = req.query;

    if (!therapistId) {
      return res.status(400).json({ message: 'therapistId is required' });
    }
    if (!start || !end) {
      return res.status(400).json({ message: 'start and end date are required' });
    }

    const startDate = new Date(start as string);
    const endDate = new Date(end as string);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    const analysis = await analyzeSchedule(practiceId, therapistId as string, {
      start: startDate,
      end: endDate,
    });

    res.json(analysis);
  } catch (error) {
    logger.error('Error analyzing schedule', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to analyze schedule' });
  }
});

/**
 * GET /api/scheduling/optimal-slots
 * Suggest optimal time slots for a new appointment.
 *
 * Query params:
 * - therapistId (required)
 * - duration (minutes, required)
 * - bufferMinutes (optional, default 15)
 * - preferredDays (optional, comma-separated day numbers 0-6)
 * - preferredTimeStart (optional, HH:MM)
 * - preferredTimeEnd (optional, HH:MM)
 * - lookAheadDays (optional, default 14)
 * - practiceId (optional, admin only)
 */
router.get('/optimal-slots', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { therapistId, duration } = req.query;

    if (!therapistId) {
      return res.status(400).json({ message: 'therapistId is required' });
    }
    if (!duration) {
      return res.status(400).json({ message: 'duration (in minutes) is required' });
    }

    const durationMinutes = parseInt(duration as string);
    if (isNaN(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) {
      return res.status(400).json({ message: 'Duration must be between 15 and 240 minutes' });
    }

    const preferences: Record<string, any> = {};
    if (req.query.bufferMinutes) {
      preferences.bufferMinutes = parseInt(req.query.bufferMinutes as string);
    }
    if (req.query.preferredDays) {
      preferences.preferredDays = (req.query.preferredDays as string)
        .split(',')
        .map(Number)
        .filter((n: number) => n >= 0 && n <= 6);
    }
    if (req.query.preferredTimeStart) {
      preferences.preferredTimeStart = req.query.preferredTimeStart as string;
    }
    if (req.query.preferredTimeEnd) {
      preferences.preferredTimeEnd = req.query.preferredTimeEnd as string;
    }
    if (req.query.lookAheadDays) {
      preferences.lookAheadDays = parseInt(req.query.lookAheadDays as string);
    }

    const slots = await suggestOptimalSlots(
      practiceId,
      therapistId as string,
      durationMinutes,
      Object.keys(preferences).length > 0 ? preferences : undefined
    );

    res.json({ slots, therapistId, duration: durationMinutes });
  } catch (error) {
    logger.error('Error suggesting optimal slots', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to suggest optimal slots' });
  }
});

/**
 * GET /api/scheduling/insights
 * Generate AI-powered scheduling insights for the practice.
 *
 * Query params:
 * - start (ISO date string, required)
 * - end (ISO date string, required)
 * - practiceId (optional, admin only)
 */
router.get('/insights', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({ message: 'start and end date are required' });
    }

    const startDate = new Date(start as string);
    const endDate = new Date(end as string);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    const insights = await generateScheduleInsights(practiceId, {
      start: startDate,
      end: endDate,
    });

    res.json({ insights, dateRange: { start: start, end: end } });
  } catch (error) {
    logger.error('Error generating scheduling insights', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to generate scheduling insights' });
  }
});

/**
 * GET /api/scheduling/utilization
 * Get utilization heatmap data (hour x day-of-week grid).
 *
 * Query params:
 * - start (ISO date string, required)
 * - end (ISO date string, required)
 * - therapistId (optional — omit for practice-wide view)
 * - practiceId (optional, admin only)
 */
router.get('/utilization', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { start, end, therapistId } = req.query;

    if (!start || !end) {
      return res.status(400).json({ message: 'start and end date are required' });
    }

    const startDate = new Date(start as string);
    const endDate = new Date(end as string);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    const heatmap = await getUtilizationHeatmap(
      practiceId,
      { start: startDate, end: endDate },
      therapistId as string | undefined
    );

    res.json({
      heatmap,
      dateRange: { start: start, end: end },
      therapistId: therapistId || null,
    });
  } catch (error) {
    logger.error('Error generating utilization heatmap', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to generate utilization heatmap' });
  }
});

export default router;
