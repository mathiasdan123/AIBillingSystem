/**
 * Claim Status Reaper Admin Routes
 *
 * POST /api/admin/claim-status-reaper/run
 *   On-demand reaper trigger for admins/billing who don't want to wait for
 *   the 6 AM cron. Scoped to the caller's authorized practice. Accepts an
 *   optional { olderThanHours: 1-168 } in the body (default 24).
 *
 * Mirrors the symmetry of /api/admin/eligibility-sweep/run (PR #185).
 */

import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

const router = Router();

// Same practiceId helper used in the admin router (kept local to avoid a
// cross-file import on a tiny helper).
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
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
    logger.warn(
      `Practice access restricted: User requested practice ${requestedPracticeId} but assigned to ${userPracticeId}`,
    );
    return userPracticeId;
  }
  return requestedPracticeId || userPracticeId;
};

const isAdminOrBilling = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const user = await storage.getUser(req.user.claims.sub);
    if (!user || (user.role !== 'admin' && user.role !== 'billing')) {
      return res
        .status(403)
        .json({ message: 'Access denied. Admin or billing role required.' });
    }
    next();
  } catch (error) {
    logger.error('Error checking user role', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to verify permissions' });
  }
};

router.post(
  '/admin/claim-status-reaper/run',
  isAuthenticated,
  isAdminOrBilling,
  async (req: any, res: Response) => {
    try {
      const practiceId = getAuthorizedPracticeId(req);
      const raw = req.body?.olderThanHours;
      const olderThanHours =
        typeof raw === 'number' && raw > 0 && raw <= 168 ? raw : 24;

      logger.info('Manual claim status reap triggered', {
        practiceId,
        userId: req.user?.claims?.sub,
        olderThanHours,
      });

      const { runClaimStatusReap } = await import(
        '../services/claimStatusReaperService'
      );
      const summary = await runClaimStatusReap({ practiceId, olderThanHours });
      res.json(summary);
    } catch (error: any) {
      logger.error('Manual claim status reap failed', {
        error: error?.message || String(error),
      });
      res.status(500).json({ message: 'Claim status reap failed' });
    }
  },
);

export default router;
