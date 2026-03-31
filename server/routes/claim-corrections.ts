import { Router } from 'express';
import { isAuthenticated } from '../replitAuth';
import { analyzeClaimForFixes } from '../services/claimAutoFixService';
import logger from '../services/logger';

const router = Router();

/**
 * Analyze a denied claim for auto-fix suggestions
 */
router.post('/:id/analyze-fix', isAuthenticated, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    if (isNaN(claimId)) {
      return res.status(400).json({ error: 'Invalid claim ID' });
    }

    logger.info('Starting auto-fix analysis for claim', {
      claimId,
    });

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
 * List all pending corrections
 * Placeholder endpoint - returns empty array for now
 * Will be implemented once claim_corrections table is added
 */
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    logger.info('Listing claim corrections');

    res.json({
      corrections: [],
      count: 0,
    });
  } catch (error) {
    logger.error('Error listing claim corrections', { error });
    res.status(500).json({ error: 'Failed to list claim corrections' });
  }
});

export default router;
