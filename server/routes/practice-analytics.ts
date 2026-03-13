/**
 * Practice Analytics Routes
 *
 * Handles:
 * - /api/practice-analytics/revenue-breakdown - Revenue by payer, CPT, provider
 * - /api/practice-analytics/claim-metrics - Claim performance metrics
 * - /api/practice-analytics/provider-productivity - Per-provider productivity
 * - /api/practice-analytics/payer-performance - Per-payer performance
 * - /api/practice-analytics/trends - Monthly trend data
 */

import { Router } from 'express';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import {
  getRevenueBreakdown,
  getClaimMetrics,
  getProviderProductivity,
  getPayerPerformance,
  getTrendData,
} from '../services/practiceAnalyticsService';

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
    return userPracticeId;
  }

  return requestedPracticeId || userPracticeId;
};

// Helper to get default date range (last 3 months)
const getDefaultDateRange = (req: any): { startDate: Date; endDate: Date } => {
  const defaultStart = new Date();
  defaultStart.setMonth(defaultStart.getMonth() - 3);
  const startDate = validateDate(req.query.start as string) || defaultStart;
  const endDate = validateDate(req.query.end as string) || new Date();
  return { startDate, endDate };
};

// Revenue breakdown by payer, CPT code, and provider
router.get('/revenue-breakdown', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { startDate, endDate } = getDefaultDateRange(req);

    if (startDate > endDate) {
      return res.status(400).json({ message: 'Start date must be before end date' });
    }

    const data = await getRevenueBreakdown(practiceId, startDate, endDate);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching revenue breakdown', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to fetch revenue breakdown' });
  }
});

// Claim metrics: denial rate, clean claim rate, payment timing
router.get('/claim-metrics', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { startDate, endDate } = getDefaultDateRange(req);

    if (startDate > endDate) {
      return res.status(400).json({ message: 'Start date must be before end date' });
    }

    const data = await getClaimMetrics(practiceId, startDate, endDate);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching claim metrics', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to fetch claim metrics' });
  }
});

// Provider productivity: per-provider appointments, claims, revenue
router.get('/provider-productivity', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { startDate, endDate } = getDefaultDateRange(req);

    if (startDate > endDate) {
      return res.status(400).json({ message: 'Start date must be before end date' });
    }

    const data = await getProviderProductivity(practiceId, startDate, endDate);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching provider productivity', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to fetch provider productivity' });
  }
});

// Payer performance: per-payer payment time, denial rate, reimbursement rate
router.get('/payer-performance', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { startDate, endDate } = getDefaultDateRange(req);

    if (startDate > endDate) {
      return res.status(400).json({ message: 'Start date must be before end date' });
    }

    const data = await getPayerPerformance(practiceId, startDate, endDate);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching payer performance', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to fetch payer performance' });
  }
});

// Trend data: monthly revenue, claim volume, denial rate
router.get('/trends', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const months = parseInt(req.query.months as string) || 12;

    if (months < 1 || months > 60) {
      return res.status(400).json({ message: 'Months must be between 1 and 60' });
    }

    const data = await getTrendData(practiceId, months);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching trend data', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to fetch trend data' });
  }
});

export default router;
