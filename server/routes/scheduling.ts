/**
 * Scheduling Insights Routes
 *
 * Bridges client/src/pages/scheduling-insights.tsx to schedulingOptimizer.ts.
 * Both pieces have been in the repo unconnected — this is the missing glue.
 *
 * - GET /api/scheduling/utilization  - Heatmap of hourly utilization
 * - GET /api/scheduling/insights     - High-level insights across therapists
 * - GET /api/scheduling/analysis     - Per-therapist analysis
 * - GET /api/scheduling/optimal-slots - Suggested open slots for a duration
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

const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;
  if (userRole === 'admin') return requestedPracticeId || userPracticeId || 1;
  if (!userPracticeId) throw new Error('User not assigned to a practice. Contact administrator.');
  if (requestedPracticeId && requestedPracticeId !== userPracticeId) return userPracticeId;
  return requestedPracticeId || userPracticeId;
};

function parseDateRange(req: any): { start: Date; end: Date } | null {
  const start = req.query.start as string | undefined;
  const end = req.query.end as string | undefined;
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
  return { start: s, end: e };
}

router.get('/utilization', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const range = parseDateRange(req);
    if (!range) return res.status(400).json({ message: 'start and end query params required (ISO dates)' });
    const therapistIdRaw = req.query.therapistId as string | undefined;
    const therapistId = therapistIdRaw && therapistIdRaw !== 'all' ? therapistIdRaw : undefined;
    const heatmap = await getUtilizationHeatmap(practiceId, range, therapistId);
    res.json({ heatmap });
  } catch (error) {
    logger.error('Error fetching utilization heatmap', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to fetch utilization heatmap' });
  }
});

router.get('/insights', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const range = parseDateRange(req);
    if (!range) return res.status(400).json({ message: 'start and end query params required' });
    const insights = await generateScheduleInsights(practiceId, range);
    res.json({ insights });
  } catch (error) {
    logger.error('Error generating schedule insights', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to generate schedule insights' });
  }
});

router.get('/analysis', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const range = parseDateRange(req);
    if (!range) return res.status(400).json({ message: 'start and end query params required' });
    const therapistId = (req.query.therapistId as string | undefined) ?? '';
    if (!therapistId || therapistId === 'all') {
      return res.status(400).json({ message: 'therapistId required (must be a specific therapist)' });
    }
    const analysis = await analyzeSchedule(practiceId, therapistId, range);
    res.json(analysis);
  } catch (error) {
    logger.error('Error analyzing schedule', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to analyze schedule' });
  }
});

router.get('/optimal-slots', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const therapistId = (req.query.therapistId as string | undefined) ?? '';
    if (!therapistId || therapistId === 'all') {
      return res.status(400).json({ message: 'therapistId required' });
    }
    const duration = parseInt((req.query.duration as string) ?? '50', 10);
    const slots = await suggestOptimalSlots(practiceId, therapistId, duration);
    res.json({ slots });
  } catch (error) {
    logger.error('Error finding optimal slots', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to find optimal slots' });
  }
});

export default router;
