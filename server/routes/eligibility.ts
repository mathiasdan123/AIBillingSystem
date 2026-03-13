/**
 * Eligibility Routes
 *
 * Handles batch eligibility verification:
 * - POST /api/eligibility/queue - Queue an eligibility check
 * - POST /api/eligibility/process - Process queued checks for a practice
 * - GET  /api/eligibility/queue/status - Get queue status
 * - GET  /api/eligibility/history/:patientId - Get eligibility history for a patient
 * - GET  /api/eligibility/expiring - Get patients with expiring eligibility
 * - DELETE /api/eligibility/queue - Clear the queue
 */

import { Router, type Response, type NextFunction } from 'express';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';
import logger from '../services/logger';
import {
  queueEligibilityCheck,
  getQueueStatus,
  processBatchEligibility,
  getEligibilityHistory,
  getExpiringEligibility,
  clearQueue,
} from '../services/batchEligibilityService';

const router = Router();

// Helper to get authorized practiceId
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
  if (userRole === 'admin') return requestedPracticeId || userPracticeId || 1;
  if (!userPracticeId) throw new Error('User not assigned to a practice. Contact administrator.');
  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    return userPracticeId;
  }
  return requestedPracticeId || userPracticeId;
};

// Queue an eligibility check
router.post('/queue', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { patientId, insuranceId } = req.body;

    if (!patientId || !insuranceId) {
      return res.status(400).json({
        message: 'patientId and insuranceId are required',
      });
    }

    const result = queueEligibilityCheck(
      parseInt(patientId),
      practiceId,
      parseInt(insuranceId)
    );

    res.json({
      success: true,
      queued: result.queued,
      position: result.position,
      message: result.queued
        ? `Eligibility check queued at position ${result.position}`
        : `Already queued at position ${result.position}`,
    });
  } catch (error) {
    logger.error('Error queuing eligibility check', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to queue eligibility check' });
  }
});

// Get queue status for a practice
router.get('/queue/status', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const status = getQueueStatus(practiceId);
    res.json(status);
  } catch (error) {
    logger.error('Error getting queue status', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to get queue status' });
  }
});

// Process all queued eligibility checks for a practice
router.post('/process', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const result = await processBatchEligibility(practiceId);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('already running')) {
      return res.status(409).json({ message: errorMessage });
    }

    logger.error('Error processing batch eligibility', { error: errorMessage });
    res.status(500).json({ message: 'Failed to process batch eligibility' });
  }
});

// Get eligibility check history for a patient
router.get('/history/:patientId', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const patientId = parseInt(req.params.patientId);

    if (isNaN(patientId)) {
      return res.status(400).json({ message: 'Invalid patientId' });
    }

    const history = await getEligibilityHistory(patientId, practiceId);
    res.json(history);
  } catch (error) {
    logger.error('Error getting eligibility history', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to get eligibility history' });
  }
});

// Get patients with expiring eligibility
router.get('/expiring', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const daysAhead = req.query.daysAhead ? parseInt(req.query.daysAhead as string) : 30;

    const expiring = await getExpiringEligibility(practiceId, daysAhead);
    res.json(expiring);
  } catch (error) {
    logger.error('Error getting expiring eligibility', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to get expiring eligibility' });
  }
});

// Clear the queue for a practice
router.delete('/queue', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const cleared = clearQueue(practiceId);
    res.json({
      success: true,
      cleared,
      message: `Cleared ${cleared} items from the queue`,
    });
  } catch (error) {
    logger.error('Error clearing eligibility queue', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to clear queue' });
  }
});

export default router;
