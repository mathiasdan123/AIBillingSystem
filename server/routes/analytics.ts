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
 * - /api/analytics/therapist-productivity - Per-therapist productivity metrics
 * - /api/analytics/therapist-productivity/trends - Monthly trend data per therapist
 */

import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import { getDb } from '../db';
import { users, appointments, claims, treatmentSessions, soapNotes } from '@shared/schema';
import { eq, and, gte, lte, sql, count, sum, avg } from 'drizzle-orm';
import { cache, CacheKeys, CacheTTL } from '../services/cacheService';
import { generateDailyReport, generateWeeklyReport } from '../services/insightsReportService';
import { sendEmail, isSmtpConfigured } from '../services/emailService';

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
    const practiceId = getAuthorizedPracticeId(req);
    const userId = req.user?.claims?.sub;
    const user = userId ? await storage.getUser(userId) : null;
    const isAdminOrBillingRole = user?.role === 'admin' || user?.role === 'billing';

    const stats = await storage.getDashboardStats(practiceId);

    if (isAdminOrBillingRole) {
      res.json(stats);
    } else {
      // Non-admin users get limited view (no financial data)
      const { monthlyRevenue, totalRevenue, ...baseStats } = stats as any;
      res.json(baseStats);
    }
  } catch (error) {
    logger.error("Error fetching dashboard", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch dashboard data" });
  }
});

// ==================== REVENUE ANALYTICS ====================

// Revenue analytics
// Wait time analytics (checked-in → session-started, in minutes)
router.get('/wait-times', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const timeRange = (req.query.timeRange as string) || '30days';
    const days = { '7days': 7, '14days': 14, '30days': 30, '90days': 90 }[timeRange] || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    const data = await storage.getWaitTimes(practiceId, startDate, endDate);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching wait-time analytics', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch wait-time analytics' });
  }
});

router.get('/revenue', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const timeRange = req.query.timeRange as string || '12months';
    const months = { '3months': 3, '6months': 6, '12months': 12 }[timeRange] || 12;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    const data = await cache.wrap(
      CacheKeys.revenue(practiceId, timeRange),
      CacheTTL.ANALYTICS,
      () => storage.getRevenueByMonth(practiceId, startDate, new Date())
    );
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
    const data = await cache.wrap(
      CacheKeys.revenueForecast(practiceId, months),
      CacheTTL.ANALYTICS,
      () => storage.getRevenueForecast(practiceId, months)
    );
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
    const data = await cache.wrap(
      CacheKeys.claimsByStatus(practiceId),
      CacheTTL.ANALYTICS,
      () => storage.getClaimsByStatus(practiceId)
    );
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
    const data = await cache.wrap(
      CacheKeys.denialReasons(practiceId),
      CacheTTL.ANALYTICS,
      () => storage.getTopDenialReasons(practiceId)
    );
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
    const data = await cache.wrap(
      CacheKeys.collectionRate(practiceId),
      CacheTTL.ANALYTICS,
      () => storage.getCollectionRate(practiceId)
    );
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
    const data = await cache.wrap(
      CacheKeys.cleanClaimsRate(practiceId),
      CacheTTL.ANALYTICS,
      () => storage.getCleanClaimsRate(practiceId)
    );
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

    const paramHash = `${start.toISOString().split('T')[0]}_${end.toISOString().split('T')[0]}`;
    const data = await cache.wrap(
      CacheKeys.capacity(practiceId, paramHash),
      CacheTTL.ANALYTICS,
      () => storage.getCapacityUtilization(practiceId, start, end)
    );
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
    const data = await cache.wrap(
      CacheKeys.arAging(practiceId),
      CacheTTL.ANALYTICS,
      () => storage.getDaysInAR(practiceId)
    );
    res.json(data);
  } catch (error) {
    logger.error('Error fetching AR aging', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch AR aging' });
  }
});

// Patient billing AR aging (statement-based, separate from insurance claims AR)
router.get('/patient-ar-aging', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const data = await cache.wrap(
      CacheKeys.patientArAging(practiceId),
      CacheTTL.ANALYTICS,
      () => storage.getPatientArAging(practiceId)
    );
    res.json(data);
  } catch (error) {
    logger.error('Error fetching patient AR aging', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch patient AR aging' });
  }
});

// ==================== REFERRALS ====================

// Referrals analytics
router.get('/referrals', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const data = await cache.wrap(
      CacheKeys.referrals(practiceId),
      CacheTTL.ANALYTICS,
      () => storage.getTopReferringProviders(practiceId)
    );
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
    const paramHash = `stats_${start.toISOString().split('T')[0]}_${end.toISOString().split('T')[0]}`;
    const stats = await cache.wrap(
      CacheKeys.cancellations(practiceId, paramHash),
      CacheTTL.ANALYTICS,
      () => storage.getCancellationStats(practiceId, start, end)
    );
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
    const paramHash = `by-patient_${start.toISOString().split('T')[0]}_${end.toISOString().split('T')[0]}`;
    const data = await cache.wrap(
      CacheKeys.cancellations(practiceId, paramHash),
      CacheTTL.ANALYTICS,
      () => storage.getCancellationsByPatient(practiceId, start, end)
    );
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
    const paramHash = `trend_${start.toISOString().split('T')[0]}_${end.toISOString().split('T')[0]}`;
    const data = await cache.wrap(
      CacheKeys.cancellations(practiceId, paramHash),
      CacheTTL.ANALYTICS,
      () => storage.getCancellationTrend(practiceId, start, end)
    );
    res.json(data);
  } catch (error) {
    logger.error('Error fetching cancellation trend', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch cancellation trend' });
  }
});

// ==================== THERAPIST PRODUCTIVITY ====================

// Therapist productivity metrics
router.get('/therapist-productivity', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const therapistId = req.query.therapistId as string | undefined;

    const defaultStart = new Date();
    defaultStart.setMonth(defaultStart.getMonth() - 3);
    const startDate = validateDate(req.query.start as string) || defaultStart;
    const endDate = validateDate(req.query.end as string) || new Date();

    if (startDate > endDate) {
      return res.status(400).json({ message: 'Start date must be before end date' });
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    const paramHash = `${therapistId || 'all'}_${startStr}_${endStr}`;
    const cacheKey = CacheKeys.therapistProductivity(practiceId, paramHash);
    const cached = await cache.get<any>(cacheKey);
    if (cached !== null) {
      return res.json(cached);
    }

    const db = await getDb();

    // Get all therapists for the practice (or single therapist)
    const therapistFilter = therapistId
      ? and(eq(users.practiceId, practiceId), eq(users.id, therapistId), eq(users.role, 'therapist'))
      : and(eq(users.practiceId, practiceId), eq(users.role, 'therapist'));

    const therapists = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, credentials: users.credentials })
      .from(users)
      .where(therapistFilter);

    if (therapists.length === 0) {
      return res.json([]);
    }

    const therapistIds = therapists.map((t: any) => t.id);

    const results = [];

    for (const therapist of therapists) {
      // Appointment metrics
      const appointmentRows = await db
        .select({
          total: count(),
          completed: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'completed')`,
          cancelled: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'cancelled')`,
          noShow: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'no_show')`,
        })
        .from(appointments)
        .where(and(
          eq(appointments.therapistId, therapist.id),
          eq(appointments.practiceId, practiceId),
          gte(appointments.startTime, startDate),
          lte(appointments.startTime, endDate),
        ));

      const apptStats = appointmentRows[0] || { total: 0, completed: 0, cancelled: 0, noShow: 0 };
      const totalAppts = Number(apptStats.total) || 0;
      const completedAppts = Number(apptStats.completed) || 0;
      const cancelledAppts = Number(apptStats.cancelled) || 0;
      const noShowAppts = Number(apptStats.noShow) || 0;

      // Claims / billing metrics
      const claimRows = await db
        .select({
          totalBilled: sql<string>`COALESCE(SUM(${claims.totalAmount}::numeric), 0)`,
          totalCollected: sql<string>`COALESCE(SUM(${claims.paidAmount}::numeric), 0)`,
        })
        .from(claims)
        .innerJoin(treatmentSessions, eq(claims.sessionId, treatmentSessions.id))
        .where(and(
          eq(treatmentSessions.therapistId, therapist.id),
          eq(claims.practiceId, practiceId),
          gte(claims.createdAt, startDate),
          lte(claims.createdAt, endDate),
        ));

      const claimStats = claimRows[0] || { totalBilled: '0', totalCollected: '0' };
      const totalBilled = parseFloat(claimStats.totalBilled) || 0;
      const totalCollected = parseFloat(claimStats.totalCollected) || 0;

      // Treatment sessions for sessions-per-day calculation
      const sessionRows = await db
        .select({
          totalSessions: count(),
          distinctDays: sql<number>`COUNT(DISTINCT ${treatmentSessions.sessionDate})`,
        })
        .from(treatmentSessions)
        .where(and(
          eq(treatmentSessions.therapistId, therapist.id),
          eq(treatmentSessions.practiceId, practiceId),
          gte(treatmentSessions.sessionDate, startStr),
          lte(treatmentSessions.sessionDate, endStr),
        ));

      const sessionStats = sessionRows[0] || { totalSessions: 0, distinctDays: 0 };
      const totalSessions = Number(sessionStats.totalSessions) || 0;
      const distinctDays = Number(sessionStats.distinctDays) || 0;

      // Documentation completion rate: SOAP notes completed vs treatment sessions
      const soapNoteRows = await db
        .select({ noteCount: count() })
        .from(soapNotes)
        .innerJoin(treatmentSessions, eq(soapNotes.sessionId, treatmentSessions.id))
        .where(and(
          eq(treatmentSessions.therapistId, therapist.id),
          eq(treatmentSessions.practiceId, practiceId),
          gte(treatmentSessions.sessionDate, startStr),
          lte(treatmentSessions.sessionDate, endStr),
        ));

      const noteCount = Number(soapNoteRows[0]?.noteCount) || 0;

      // Patient retention: patients seen more than once
      const retentionRows = await db
        .select({
          totalPatients: sql<number>`COUNT(DISTINCT ${treatmentSessions.patientId})`,
          returningPatients: sql<number>`COUNT(DISTINCT ${treatmentSessions.patientId}) FILTER (WHERE ${treatmentSessions.patientId} IN (
            SELECT ${treatmentSessions.patientId} FROM ${treatmentSessions}
            WHERE ${treatmentSessions.therapistId} = ${therapist.id}
              AND ${treatmentSessions.practiceId} = ${practiceId}
              AND ${treatmentSessions.sessionDate} >= ${startStr}
              AND ${treatmentSessions.sessionDate} <= ${endStr}
            GROUP BY ${treatmentSessions.patientId}
            HAVING COUNT(*) > 1
          ))`,
        })
        .from(treatmentSessions)
        .where(and(
          eq(treatmentSessions.therapistId, therapist.id),
          eq(treatmentSessions.practiceId, practiceId),
          gte(treatmentSessions.sessionDate, startStr),
          lte(treatmentSessions.sessionDate, endStr),
        ));

      const totalPatients = Number(retentionRows[0]?.totalPatients) || 0;
      const returningPatients = Number(retentionRows[0]?.returningPatients) || 0;

      results.push({
        therapistId: therapist.id,
        therapistName: `${therapist.firstName || ''} ${therapist.lastName || ''}`.trim() || 'Unknown',
        credentials: therapist.credentials || '',
        appointmentsScheduled: totalAppts,
        appointmentsCompleted: completedAppts,
        cancellationRate: totalAppts > 0 ? Math.round((cancelledAppts / totalAppts) * 10000) / 100 : 0,
        noShowRate: totalAppts > 0 ? Math.round((noShowAppts / totalAppts) * 10000) / 100 : 0,
        totalBilled: Math.round(totalBilled * 100) / 100,
        totalCollected: Math.round(totalCollected * 100) / 100,
        collectionRate: totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 10000) / 100 : 0,
        averageSessionsPerDay: distinctDays > 0 ? Math.round((totalSessions / distinctDays) * 100) / 100 : 0,
        averageRevenuePerSession: totalSessions > 0 ? Math.round((totalCollected / totalSessions) * 100) / 100 : 0,
        documentationCompletionRate: totalSessions > 0 ? Math.round((noteCount / totalSessions) * 10000) / 100 : 0,
        patientRetentionRate: totalPatients > 0 ? Math.round((returningPatients / totalPatients) * 10000) / 100 : 0,
        totalPatients,
        totalSessions,
      });
    }

    await cache.set(cacheKey, results, CacheTTL.ANALYTICS);
    res.json(results);
  } catch (error) {
    logger.error('Error fetching therapist productivity', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch therapist productivity' });
  }
});

// Therapist productivity trends (monthly)
router.get('/therapist-productivity/trends', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const therapistId = req.query.therapistId as string | undefined;

    const defaultStart = new Date();
    defaultStart.setMonth(defaultStart.getMonth() - 12);
    const startDate = validateDate(req.query.start as string) || defaultStart;
    const endDate = validateDate(req.query.end as string) || new Date();

    if (startDate > endDate) {
      return res.status(400).json({ message: 'Start date must be before end date' });
    }

    const trendStartStr = startDate.toISOString().split('T')[0];
    const trendEndStr = endDate.toISOString().split('T')[0];
    const trendParamHash = `${therapistId || 'all'}_${trendStartStr}_${trendEndStr}`;
    const trendCacheKey = CacheKeys.therapistProductivityTrends(practiceId, trendParamHash);
    const trendCached = await cache.get<any>(trendCacheKey);
    if (trendCached !== null) {
      return res.json(trendCached);
    }

    const db = await getDb();

    // Get therapists
    const therapistFilter = therapistId
      ? and(eq(users.practiceId, practiceId), eq(users.id, therapistId), eq(users.role, 'therapist'))
      : and(eq(users.practiceId, practiceId), eq(users.role, 'therapist'));

    const therapists = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(therapistFilter);

    if (therapists.length === 0) {
      return res.json([]);
    }

    const results = [];

    for (const therapist of therapists) {
      // Monthly appointment counts
      const monthlyAppts = await db
        .select({
          month: sql<string>`TO_CHAR(${appointments.startTime}, 'YYYY-MM')`,
          total: count(),
          completed: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'completed')`,
          cancelled: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'cancelled')`,
          noShow: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'no_show')`,
        })
        .from(appointments)
        .where(and(
          eq(appointments.therapistId, therapist.id),
          eq(appointments.practiceId, practiceId),
          gte(appointments.startTime, startDate),
          lte(appointments.startTime, endDate),
        ))
        .groupBy(sql`TO_CHAR(${appointments.startTime}, 'YYYY-MM')`)
        .orderBy(sql`TO_CHAR(${appointments.startTime}, 'YYYY-MM')`);

      // Monthly revenue
      const monthlyRevenue = await db
        .select({
          month: sql<string>`TO_CHAR(${claims.createdAt}, 'YYYY-MM')`,
          billed: sql<string>`COALESCE(SUM(${claims.totalAmount}::numeric), 0)`,
          collected: sql<string>`COALESCE(SUM(${claims.paidAmount}::numeric), 0)`,
        })
        .from(claims)
        .innerJoin(treatmentSessions, eq(claims.sessionId, treatmentSessions.id))
        .where(and(
          eq(treatmentSessions.therapistId, therapist.id),
          eq(claims.practiceId, practiceId),
          gte(claims.createdAt, startDate),
          lte(claims.createdAt, endDate),
        ))
        .groupBy(sql`TO_CHAR(${claims.createdAt}, 'YYYY-MM')`)
        .orderBy(sql`TO_CHAR(${claims.createdAt}, 'YYYY-MM')`);

      // Merge appointment and revenue data by month
      const monthMap = new Map<string, any>();

      for (const row of monthlyAppts) {
        monthMap.set(row.month, {
          month: row.month,
          appointmentsScheduled: Number(row.total) || 0,
          appointmentsCompleted: Number(row.completed) || 0,
          cancellationRate: Number(row.total) > 0 ? Math.round((Number(row.cancelled) / Number(row.total)) * 10000) / 100 : 0,
          noShowRate: Number(row.total) > 0 ? Math.round((Number(row.noShow) / Number(row.total)) * 10000) / 100 : 0,
          totalBilled: 0,
          totalCollected: 0,
          collectionRate: 0,
        });
      }

      for (const row of monthlyRevenue) {
        const existing = monthMap.get(row.month) || {
          month: row.month,
          appointmentsScheduled: 0,
          appointmentsCompleted: 0,
          cancellationRate: 0,
          noShowRate: 0,
        };
        const billed = parseFloat(row.billed) || 0;
        const collected = parseFloat(row.collected) || 0;
        existing.totalBilled = Math.round(billed * 100) / 100;
        existing.totalCollected = Math.round(collected * 100) / 100;
        existing.collectionRate = billed > 0 ? Math.round((collected / billed) * 10000) / 100 : 0;
        monthMap.set(row.month, existing);
      }

      const months = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));

      results.push({
        therapistId: therapist.id,
        therapistName: `${therapist.firstName || ''} ${therapist.lastName || ''}`.trim() || 'Unknown',
        months,
      });
    }

    await cache.set(trendCacheKey, results, CacheTTL.ANALYTICS);
    res.json(results);
  } catch (error) {
    logger.error('Error fetching therapist productivity trends', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch therapist productivity trends' });
  }
});

// ==================== INSIGHT REPORTS ====================

// Daily insights report
router.get('/reports/daily-insights', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const dateParam = req.query.date as string | undefined;
    const reportDate = dateParam ? new Date(dateParam) : undefined;

    if (dateParam && isNaN(new Date(dateParam).getTime())) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const report = await generateDailyReport(practiceId, reportDate);
    res.json(report);
  } catch (error) {
    logger.error('Error generating daily insights report', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to generate daily insights report' });
  }
});

// Weekly insights report
router.get('/reports/weekly-insights', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const weekOfParam = req.query.weekOf as string | undefined;
    const weekOf = weekOfParam ? new Date(weekOfParam) : undefined;

    if (weekOfParam && isNaN(new Date(weekOfParam).getTime())) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const report = await generateWeeklyReport(practiceId, weekOf);
    res.json(report);
  } catch (error) {
    logger.error('Error generating weekly insights report', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to generate weekly insights report' });
  }
});

// Email daily insights report to practice admins
router.post('/reports/daily-insights/email', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);

    if (!isSmtpConfigured()) {
      return res.status(503).json({ message: 'Email service is not configured. Set SMTP environment variables.' });
    }

    const report = await generateDailyReport(practiceId);

    // Get admin emails for this practice
    const admins = await storage.getAdminsByPractice(practiceId);
    const recipients = admins.map((a: any) => a.email).filter(Boolean);

    if (recipients.length === 0) {
      return res.status(400).json({ message: 'No admin email addresses found for this practice.' });
    }

    const subject = `Daily Insights Report - ${report.practiceName} - ${report.reportDate}`;
    const html = buildDailyInsightsEmailHtml(report);
    const text = buildDailyInsightsEmailText(report);

    let sentCount = 0;
    for (const email of recipients) {
      const result = await sendEmail({
        to: email,
        subject,
        html,
        text,
        fromName: 'TherapyBill AI Reports',
      });
      if (result.success) sentCount++;
    }

    res.json({
      success: true,
      message: `Report emailed to ${sentCount} recipient(s).`,
      recipients: sentCount,
    });
  } catch (error) {
    logger.error('Error emailing daily insights report', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to email daily insights report' });
  }
});

// ==================== EMAIL TEMPLATE HELPERS ====================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br/>');
}

function buildDailyInsightsEmailHtml(
  report: ReturnType<typeof generateDailyReport> extends Promise<infer T> ? T : never,
  narrative?: string,
): string {
  const actionItemsHtml = report.actionItems
    .map(
      (item) =>
        `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;">
            <span style="color:${item.priority === 'high' ? '#dc2626' : item.priority === 'medium' ? '#d97706' : '#059669'};font-weight:bold;text-transform:uppercase;font-size:11px;">${item.priority}</span>
          </td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${item.category}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${item.description}</td>
        </tr>`,
    )
    .join('');

  const narrativeHtml = narrative
    ? `<div style="margin:16px 0;padding:14px 16px;background:#f5f3ff;border-left:4px solid #7c3aed;border-radius:4px;">
         <div style="font-size:11px;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;color:#6d28d9;margin-bottom:6px;">AI Summary</div>
         <p style="margin:0;font-size:14px;line-height:1.5;color:#1f2937;">${escapeHtml(narrative)}</p>
       </div>`
    : '';

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a;">
      <h2 style="color:#1e40af;">Daily Insights Report</h2>
      <p style="color:#6b7280;font-size:14px;">${report.practiceName} &mdash; ${report.reportDate}</p>
      ${narrativeHtml}

      <h3 style="margin-top:24px;color:#374151;">Claims Summary</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr>
          <td style="padding:8px;background:#f0f9ff;text-align:center;border:1px solid #e5e7eb;"><strong>${report.claimsSummary.newToday}</strong><br/><small>New</small></td>
          <td style="padding:8px;background:#fef3c7;text-align:center;border:1px solid #e5e7eb;"><strong>${report.claimsSummary.submittedToday}</strong><br/><small>Submitted</small></td>
          <td style="padding:8px;background:#d1fae5;text-align:center;border:1px solid #e5e7eb;"><strong>${report.claimsSummary.paidToday}</strong><br/><small>Paid</small></td>
          <td style="padding:8px;background:#fee2e2;text-align:center;border:1px solid #e5e7eb;"><strong>${report.claimsSummary.deniedToday}</strong><br/><small>Denied</small></td>
        </tr>
      </table>

      <p><strong>Revenue Collected:</strong> $${report.revenueCollectedToday.toFixed(2)}</p>
      <p><strong>Trailing 7-Day Denial Rate:</strong> ${report.denialRateTrailing7Day}%</p>

      <h3 style="margin-top:24px;color:#374151;">Patient Volume</h3>
      <p>Completed: ${report.patientVolume.completed} | No-Shows: ${report.patientVolume.noShows} | Cancellations: ${report.patientVolume.cancellations}</p>

      <h3 style="margin-top:24px;color:#374151;">Aging Claims</h3>
      <p>30+ days: ${report.agingClaims.over30.count} ($${report.agingClaims.over30.amount.toFixed(2)}) |
         60+ days: ${report.agingClaims.over60.count} ($${report.agingClaims.over60.amount.toFixed(2)}) |
         90+ days: ${report.agingClaims.over90.count} ($${report.agingClaims.over90.amount.toFixed(2)})</p>

      ${report.actionItems.length > 0 ? `
        <h3 style="margin-top:24px;color:#374151;">Action Items</h3>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="text-align:left;padding:6px 12px;border-bottom:2px solid #e5e7eb;font-size:12px;">Priority</th>
              <th style="text-align:left;padding:6px 12px;border-bottom:2px solid #e5e7eb;font-size:12px;">Category</th>
              <th style="text-align:left;padding:6px 12px;border-bottom:2px solid #e5e7eb;font-size:12px;">Description</th>
            </tr>
          </thead>
          <tbody>${actionItemsHtml}</tbody>
        </table>
      ` : ''}

      <p style="margin-top:24px;color:#9ca3af;font-size:12px;">Generated by TherapyBill AI at ${new Date().toLocaleString()}</p>
    </div>
  `;
}

function buildDailyInsightsEmailText(
  report: ReturnType<typeof generateDailyReport> extends Promise<infer T> ? T : never,
  narrative?: string,
): string {
  const lines: string[] = [
    `Daily Insights Report - ${report.practiceName} - ${report.reportDate}`,
    '',
  ];
  if (narrative) {
    lines.push('AI SUMMARY');
    lines.push(narrative);
    lines.push('');
  }
  lines.push(
    'CLAIMS SUMMARY',
    `  New: ${report.claimsSummary.newToday}  Submitted: ${report.claimsSummary.submittedToday}  Paid: ${report.claimsSummary.paidToday}  Denied: ${report.claimsSummary.deniedToday}`,
    '',
    `Revenue Collected: $${report.revenueCollectedToday.toFixed(2)}`,
    `Trailing 7-Day Denial Rate: ${report.denialRateTrailing7Day}%`,
    '',
    'PATIENT VOLUME',
    `  Completed: ${report.patientVolume.completed}  No-Shows: ${report.patientVolume.noShows}  Cancellations: ${report.patientVolume.cancellations}`,
    '',
    'AGING CLAIMS',
    `  30+ days: ${report.agingClaims.over30.count} ($${report.agingClaims.over30.amount.toFixed(2)})`,
    `  60+ days: ${report.agingClaims.over60.count} ($${report.agingClaims.over60.amount.toFixed(2)})`,
    `  90+ days: ${report.agingClaims.over90.count} ($${report.agingClaims.over90.amount.toFixed(2)})`,
  );

  if (report.actionItems.length > 0) {
    lines.push('', 'ACTION ITEMS');
    report.actionItems.forEach((item, i) => {
      lines.push(`  ${i + 1}. [${item.priority.toUpperCase()}] ${item.category}: ${item.description}`);
    });
  }

  lines.push('', `Generated by TherapyBill AI at ${new Date().toLocaleString()}`);
  return lines.join('\n');
}

export { buildDailyInsightsEmailHtml, buildDailyInsightsEmailText };

export default router;
