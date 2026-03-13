/**
 * Referral Routes
 *
 * Handles:
 * - /api/referral-sources/* - Referral source CRUD
 * - /api/referrals/* - Referral CRUD, stats, status updates
 * - /api/referrals/:id/communications/* - Referral communications
 */

import { Router } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

const router = Router();

const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
  if (userRole === 'admin') return requestedPracticeId || userPracticeId || 1;
  if (!userPracticeId) throw new Error('User not assigned to a practice.');
  if (requestedPracticeId && requestedPracticeId !== userPracticeId) return userPracticeId;
  return requestedPracticeId || userPracticeId;
};

// ==================== REFERRAL SOURCES ====================

router.get('/referral-sources', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      type: req.query.type as string | undefined,
      isActive: req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined,
    };
    const sources = await storage.getReferralSources(practiceId, filters);
    res.json(sources);
  } catch (error) {
    logger.error('Error fetching referral sources', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch referral sources' });
  }
});

router.get('/referral-sources/:id', isAuthenticated, async (req: any, res) => {
  try {
    const source = await storage.getReferralSource(parseInt(req.params.id));
    if (!source) return res.status(404).json({ message: 'Referral source not found' });
    res.json(source);
  } catch (error) {
    logger.error('Error fetching referral source', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch referral source' });
  }
});

router.post('/referral-sources', isAuthenticated, async (req: any, res) => {
  try {
    const source = await storage.createReferralSource(req.body);
    res.status(201).json(source);
  } catch (error) {
    logger.error('Error creating referral source', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create referral source' });
  }
});

router.patch('/referral-sources/:id', isAuthenticated, async (req: any, res) => {
  try {
    const source = await storage.updateReferralSource(parseInt(req.params.id), req.body);
    if (!source) return res.status(404).json({ message: 'Referral source not found' });
    res.json(source);
  } catch (error) {
    logger.error('Error updating referral source', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update referral source' });
  }
});

router.delete('/referral-sources/:id', isAuthenticated, async (req: any, res) => {
  try {
    await storage.deleteReferralSource(parseInt(req.params.id));
    res.json({ message: 'Referral source deleted' });
  } catch (error) {
    logger.error('Error deleting referral source', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete referral source' });
  }
});

// ==================== REFERRALS ====================

router.get('/referrals', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      direction: req.query.direction as string | undefined,
      status: req.query.status as string | undefined,
      patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
      referralSourceId: req.query.referralSourceId ? parseInt(req.query.referralSourceId as string) : undefined,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    };
    const referralsList = await storage.getReferrals(practiceId, filters);
    res.json(referralsList);
  } catch (error) {
    logger.error('Error fetching referrals', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch referrals' });
  }
});

router.get('/referrals/stats', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const stats = await storage.getReferralStats(practiceId, startDate, endDate);
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching referral stats', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch referral stats' });
  }
});

router.get('/referrals/pending', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const pending = await storage.getPendingReferrals(practiceId);
    res.json(pending);
  } catch (error) {
    logger.error('Error fetching pending referrals', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch pending referrals' });
  }
});

router.get('/referrals/needs-followup', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const needsFollowUp = await storage.getReferralsNeedingFollowUp(practiceId);
    res.json(needsFollowUp);
  } catch (error) {
    logger.error('Error fetching referrals needing follow-up', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch referrals needing follow-up' });
  }
});

router.get('/referrals/:id', isAuthenticated, async (req: any, res) => {
  try {
    const referralDetails = await storage.getReferralWithDetails(parseInt(req.params.id));
    if (!referralDetails) return res.status(404).json({ message: 'Referral not found' });
    res.json(referralDetails);
  } catch (error) {
    logger.error('Error fetching referral', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch referral' });
  }
});

router.post('/referrals', isAuthenticated, async (req: any, res) => {
  try {
    const referral = await storage.createReferral(req.body);
    res.status(201).json(referral);
  } catch (error) {
    logger.error('Error creating referral', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create referral' });
  }
});

router.patch('/referrals/:id', isAuthenticated, async (req: any, res) => {
  try {
    const referral = await storage.updateReferral(parseInt(req.params.id), req.body);
    if (!referral) return res.status(404).json({ message: 'Referral not found' });
    res.json(referral);
  } catch (error) {
    logger.error('Error updating referral', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update referral' });
  }
});

router.post('/referrals/:id/status', isAuthenticated, async (req: any, res) => {
  try {
    const { status } = req.body;
    const userId = req.user?.id || 'system';
    const referral = await storage.updateReferralStatus(parseInt(req.params.id), status, userId);
    if (!referral) return res.status(404).json({ message: 'Referral not found' });
    res.json(referral);
  } catch (error) {
    logger.error('Error updating referral status', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update referral status' });
  }
});

// ==================== REFERRAL COMMUNICATIONS ====================

router.get('/referrals/:id/communications', isAuthenticated, async (req: any, res) => {
  try {
    const communications = await storage.getReferralCommunications(parseInt(req.params.id));
    res.json(communications);
  } catch (error) {
    logger.error('Error fetching referral communications', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch referral communications' });
  }
});

router.post('/referrals/:id/communications', isAuthenticated, async (req: any, res) => {
  try {
    const communication = await storage.createReferralCommunication({
      ...req.body,
      referralId: parseInt(req.params.id),
      sentBy: req.user?.id,
    });
    res.status(201).json(communication);
  } catch (error) {
    logger.error('Error creating referral communication', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create referral communication' });
  }
});

export default router;
