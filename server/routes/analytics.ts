/**
 * Analytics Routes
 *
 * Handles:
 * - /api/analytics/dashboard - Dashboard overview stats
 * - /api/analytics/revenue - Revenue by month
 * - /api/analytics/claims-by-status - Claims grouped by status
 * - /api/analytics/denial-reasons - Top denial reasons
 * - /api/analytics/collection-rate - Collection rate metrics
 * - /api/analytics/clean-claims-rate - Clean claims percentage
 * - /api/analytics/capacity - Capacity utilization
 * - /api/analytics/ar-aging - Accounts receivable aging
 * - /api/analytics/revenue/forecast - Revenue forecasting
 * - /api/analytics/referrals - Referral analytics
 * - /api/analytics/revenue-by-location-therapist - Revenue breakdown
 * - /api/analytics/cancellations/* - Cancellation analytics
 */

import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

const router = Router();

// Helper to validate date
const validateDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  return date;
};

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
    logger.warn(`Practice access restricted: User requested practice ${requestedPracticeId} but assigned to ${userPracticeId}`);
    return userPracticeId;
  }

  return requestedPracticeId || userPracticeId;
};

// ==================== DASHBOARD ANALYTICS ====================

// Dashboard analytics (financial data filtered by role)
router.get('/dashboard', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    const user = userId ? await storage.getUser(userId) : null;
    const isAdminOrBillingRole = user?.role === 'admin' || user?.role === 'billing';

    // Base stats visible to all authenticated users
    const baseStats = {
      totalPatients: 3,
      activeClaims: 2,
      pendingPayments: 1,
      claimApprovalRate: 94.2
    };

    // Financial data only for admin/billing
    if (isAdminOrBillingRole) {
      res.json({
        ...baseStats,
        monthlyRevenue: 12500,
        averageReimbursement: 142.50
      });
    } else {
      res.json(baseStats);
    }
  } catch (error) {
    logger.error("Error fetching dashboard", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch dashboard data" });
  }
});

// ==================== REVENUE ANALYTICS ====================

// Revenue analytics
router.get('/revenue', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const timeRange = req.query.timeRange as string || '12months';
    const months = { '3months': 3, '6months': 6, '12months': 12 }[timeRange] || 12;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    const data = await storage.getRevenueByMonth(practiceId, startDate, new Date());
    res.json(data);
  } catch (error) {
    logger.error('Error fetching revenue analytics', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch revenue analytics' });
  }
});

// Revenue forecast analytics
router.get('/revenue/forecast', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const months = parseInt(req.query.months as string) || 3;
    const data = await storage.getRevenueForecast(practiceId, months);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching revenue forecast', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch revenue forecast' });
  }
});

// Revenue by location and therapist
router.get('/revenue-by-location-therapist', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
    const endDate = req.query.end ? new Date(req.query.end as string) : undefined;
    const data = await storage.getRevenueByLocationAndTherapist(practiceId, startDate, endDate);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching revenue by location/therapist', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch revenue by location/therapist' });
  }
});

// ==================== CLAIMS ANALYTICS ====================

// Claims by status
router.get('/claims-by-status', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const data = await storage.getClaimsByStatus(practiceId);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching claims by status', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch claims by status' });
  }
});

// Denial reasons
router.get('/denial-reasons', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const data = await storage.getTopDenialReasons(practiceId);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching denial reasons', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch denial reasons' });
  }
});

// Collection rate analytics
router.get('/collection-rate', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const data = await storage.getCollectionRate(practiceId);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching collection rate', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch collection rate' });
  }
});

// Clean claims rate analytics
router.get('/clean-claims-rate', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const data = await storage.getCleanClaimsRate(practiceId);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching clean claims rate', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch clean claims rate' });
  }
});

// ==================== CAPACITY & UTILIZATION ====================

// Capacity utilization analytics
router.get('/capacity', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);

    const defaultStart = new Date();
    defaultStart.setMonth(defaultStart.getMonth() - 1);
    const start = validateDate(req.query.start as string) || defaultStart;
    const end = validateDate(req.query.end as string) || new Date();

    if (start > end) {
      return res.status(400).json({ message: 'Start date must be before end date' });
    }

    const data = await storage.getCapacityUtilization(practiceId, start, end);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching capacity utilization', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch capacity utilization' });
  }
});

// AR aging analytics
router.get('/ar-aging', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const data = await storage.getDaysInAR(practiceId);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching AR aging', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch AR aging' });
  }
});

// ==================== REFERRALS ====================

// Referrals analytics
router.get('/referrals', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const data = await storage.getTopReferringProviders(practiceId);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching referrals', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch referrals' });
  }
});

// ==================== CANCELLATION ANALYTICS ====================

router.get('/cancellations', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const start = req.query.start ? new Date(req.query.start as string) : new Date(new Date().setMonth(new Date().getMonth() - 6));
    const end = req.query.end ? new Date(req.query.end as string) : new Date(new Date().setMonth(new Date().getMonth() + 3));
    const stats = await storage.getCancellationStats(practiceId, start, end);
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching cancellation stats', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch cancellation stats' });
  }
});

router.get('/cancellations/by-patient', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const start = req.query.start ? new Date(req.query.start as string) : new Date(new Date().setMonth(new Date().getMonth() - 6));
    const end = req.query.end ? new Date(req.query.end as string) : new Date(new Date().setMonth(new Date().getMonth() + 3));
    const data = await storage.getCancellationsByPatient(practiceId, start, end);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching cancellations by patient', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch cancellations by patient' });
  }
});

router.get('/cancellations/trend', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const start = req.query.start ? new Date(req.query.start as string) : new Date(new Date().setMonth(new Date().getMonth() - 12));
    const end = req.query.end ? new Date(req.query.end as string) : new Date(new Date().setMonth(new Date().getMonth() + 3));
    const data = await storage.getCancellationTrend(practiceId, start, end);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching cancellation trend', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch cancellation trend' });
  }
});

export default router;
