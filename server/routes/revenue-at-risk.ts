/**
 * Revenue at Risk Routes
 *
 * Handles:
 * - GET /api/revenue-at-risk/summary - Aggregated money-at-risk dashboard
 *   payload: dollars at risk, dollars recovered, appeal status, and a single
 *   prioritized action queue.
 */

import { Router } from 'express';
import { isAuthenticated } from '../replitAuth';
import { getRevenueAtRiskSummary, QUEUE_VIEWS, type QueueView } from '../services/revenueAtRiskService';
import logger from '../services/logger';

const router = Router();

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

router.get('/summary', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    // ?queue=open|snoozed|completed selects the action-queue slice; anything
    // else (or nothing) is the open queue.
    const requested = String(req.query.queue ?? 'open');
    const queue: QueueView = (QUEUE_VIEWS as string[]).includes(requested) ? (requested as QueueView) : 'open';
    const summary = await getRevenueAtRiskSummary(practiceId, { queue });
    res.json(summary);
  } catch (error) {
    logger.error('Error fetching revenue-at-risk summary', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to fetch revenue-at-risk summary' });
  }
});

export default router;
