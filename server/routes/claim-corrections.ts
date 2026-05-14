import { Router } from 'express';
import { isAuthenticated } from '../replitAuth';
import { analyzeClaimForFixes } from '../services/claimAutoFixService';
import { db } from '../db';
import { claimCorrections } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';
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
 * Analyze a denied claim for auto-fix suggestions
 */
router.post('/:id/analyze-fix', isAuthenticated, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    if (isNaN(claimId)) {
      return res.status(400).json({ error: 'Invalid claim ID' });
    }

    logger.info('Starting auto-fix analysis for claim', { claimId });

    const corrections = await analyzeClaimForFixes(claimId);

    res.json({
      claimId,
      corrections,
      count: corrections.length,
    });
  } catch (error) {
    logger.error('Error analyzing claim for fixes', {
      error,
      claimId: req.params.id,
    });
    res.status(500).json({ error: 'Failed to analyze claim for fixes' });
  }
});

/**
 * List claim corrections for the practice. Supports ?status= and ?claimId=
 * filters. Corrections are persisted by the auto-fix pipeline — `applied`
 * rows were fixed automatically, `pending` rows need a human.
 */
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const conditions = [eq(claimCorrections.practiceId, practiceId)];

    if (typeof req.query.status === 'string') {
      conditions.push(eq(claimCorrections.status, req.query.status));
    }
    if (req.query.claimId) {
      const claimId = parseInt(req.query.claimId as string);
      if (!isNaN(claimId)) {
        conditions.push(eq(claimCorrections.claimId, claimId));
      }
    }

    const corrections = await db
      .select()
      .from(claimCorrections)
      .where(and(...conditions))
      .orderBy(desc(claimCorrections.createdAt));

    res.json({
      corrections,
      count: corrections.length,
    });
  } catch (error) {
    logger.error('Error listing claim corrections', { error });
    res.status(500).json({ error: 'Failed to list claim corrections' });
  }
});

export default router;
