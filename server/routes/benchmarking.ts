/**
 * Benchmarking Routes
 *
 * Practice benchmarking dashboard that compares KPIs against industry
 * benchmarks (MGMA/AOTA/CMS data) and historical performance.
 *
 * Handles:
 * - GET /api/benchmarking/industry   — Static industry benchmark data
 * - GET /api/benchmarking/metrics    — Calculated practice KPIs for a period
 * - GET /api/benchmarking/trends     — Monthly KPI history
 */

import { Router } from 'express';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';
import logger from '../services/logger';
import { getDb } from '../db';
import { users, appointments, claims, treatmentSessions, patients } from '@shared/schema';
import { eq, and, gte, lte, sql, count } from 'drizzle-orm';
import { cache, CacheKeys, CacheTTL } from '../services/cacheService';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;
  if (userRole === 'admin') return requestedPracticeId || userPracticeId || 1;
  if (!userPracticeId) throw new Error('User not assigned to a practice. Contact administrator.');
  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    logger.warn(`Practice access restricted: User requested practice ${requestedPracticeId} but assigned to ${userPracticeId}`);
    return userPracticeId;
  }
  return requestedPracticeId || userPracticeId;
};

/** Parse a period string like "1m", "3m", "6m", "12m" into months. */
const parsePeriodMonths = (period: string | undefined): number => {
  const match = (period || '3m').match(/^(\d+)m$/);
  if (!match) return 3;
  const months = parseInt(match[1], 10);
  return [1, 3, 6, 12].includes(months) ? months : 3;
};

// ---------------------------------------------------------------------------
// Industry benchmarks (static, sourced from MGMA / AOTA / CMS data)
// ---------------------------------------------------------------------------

interface IndustryBenchmark {
  key: string;
  label: string;
  group: 'financial' | 'operational' | 'clinical';
  unit: string;
  min: number;
  max: number;
  target: number;
  /** true when a lower value is better (e.g. denial rate, AR days) */
  lowerIsBetter: boolean;
}

const INDUSTRY_BENCHMARKS: IndustryBenchmark[] = [
  { key: 'collectionsRate', label: 'Collections Rate', group: 'financial', unit: '%', min: 95, max: 98, target: 96, lowerIsBetter: false },
  { key: 'avgDaysInAR', label: 'Avg Days in AR', group: 'financial', unit: 'days', min: 30, max: 45, target: 35, lowerIsBetter: true },
  { key: 'cleanClaimRate', label: 'Clean Claim Rate', group: 'financial', unit: '%', min: 90, max: 95, target: 93, lowerIsBetter: false },
  { key: 'denialRate', label: 'Denial Rate', group: 'financial', unit: '%', min: 5, max: 10, target: 7, lowerIsBetter: true },
  { key: 'firstPassPaymentRate', label: 'First-Pass Payment Rate', group: 'financial', unit: '%', min: 85, max: 90, target: 88, lowerIsBetter: false },
  { key: 'revenuePerVisit', label: 'Revenue per Visit (OT)', group: 'financial', unit: '$', min: 120, max: 180, target: 150, lowerIsBetter: false },
  { key: 'sessionsPerProviderPerWeek', label: 'Sessions per Provider/Week', group: 'operational', unit: 'sessions', min: 25, max: 30, target: 28, lowerIsBetter: false },
  { key: 'noShowRate', label: 'No-Show Rate', group: 'operational', unit: '%', min: 8, max: 12, target: 10, lowerIsBetter: true },
  { key: 'cancellationRate', label: 'Cancellation Rate', group: 'operational', unit: '%', min: 10, max: 15, target: 12, lowerIsBetter: true },
  { key: 'patientRetentionRate', label: 'Patient Retention Rate', group: 'clinical', unit: '%', min: 80, max: 90, target: 85, lowerIsBetter: false },
];

// ---------------------------------------------------------------------------
// GET /industry — static benchmark data
// ---------------------------------------------------------------------------

router.get('/industry', isAuthenticated, (_req: any, res) => {
  res.json(INDUSTRY_BENCHMARKS);
});

// ---------------------------------------------------------------------------
// Shared KPI calculation
// ---------------------------------------------------------------------------

async function calculateKPIs(practiceId: number, startDate: Date, endDate: Date) {
  const db = await getDb();
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  // Claims metrics
  const claimRows = await db
    .select({
      totalClaims: count(),
      totalBilled: sql<string>`COALESCE(SUM(${claims.totalAmount}::numeric), 0)`,
      totalPaid: sql<string>`COALESCE(SUM(${claims.paidAmount}::numeric), 0)`,
      deniedCount: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'denied')`,
      paidCount: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'paid')`,
      submittedCount: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} IN ('submitted', 'paid', 'denied', 'appeal'))`,
      firstPassPaid: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'paid' AND ${claims.denialReason} IS NULL)`,
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      gte(claims.createdAt, startDate),
      lte(claims.createdAt, endDate),
    ));

  const cs = claimRows[0] || { totalClaims: 0, totalBilled: '0', totalPaid: '0', deniedCount: 0, paidCount: 0, submittedCount: 0, firstPassPaid: 0 };
  const totalBilled = parseFloat(cs.totalBilled) || 0;
  const totalPaid = parseFloat(cs.totalPaid) || 0;
  const totalClaims = Number(cs.totalClaims) || 0;
  const deniedCount = Number(cs.deniedCount) || 0;
  const paidCount = Number(cs.paidCount) || 0;
  const submittedCount = Number(cs.submittedCount) || 0;
  const firstPassPaid = Number(cs.firstPassPaid) || 0;

  // Average days in AR (submitted -> paid)
  const arRows = await db
    .select({
      avgDays: sql<string>`COALESCE(AVG(EXTRACT(EPOCH FROM (${claims.paidAt} - ${claims.submittedAt})) / 86400), 0)`,
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      eq(claims.status, 'paid'),
      gte(claims.createdAt, startDate),
      lte(claims.createdAt, endDate),
      sql`${claims.paidAt} IS NOT NULL`,
      sql`${claims.submittedAt} IS NOT NULL`,
    ));
  const avgDaysInAR = Math.round((parseFloat(arRows[0]?.avgDays || '0')) * 10) / 10;

  // Clean claim rate: claims that were not denied on first submission
  const cleanCount = submittedCount - deniedCount;
  const cleanClaimRate = submittedCount > 0 ? Math.round((cleanCount / submittedCount) * 10000) / 100 : 0;

  // Appointment metrics
  const apptRows = await db
    .select({
      totalAppts: count(),
      completed: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'completed')`,
      cancelled: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'cancelled')`,
      noShow: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'no_show')`,
    })
    .from(appointments)
    .where(and(
      eq(appointments.practiceId, practiceId),
      gte(appointments.startTime, startDate),
      lte(appointments.startTime, endDate),
    ));

  const a = apptRows[0] || { totalAppts: 0, completed: 0, cancelled: 0, noShow: 0 };
  const totalAppts = Number(a.totalAppts) || 0;
  const completedAppts = Number(a.completed) || 0;
  const cancelledAppts = Number(a.cancelled) || 0;
  const noShowAppts = Number(a.noShow) || 0;

  // Sessions per provider per week
  const sessionRows = await db
    .select({
      totalSessions: count(),
      distinctProviders: sql<number>`COUNT(DISTINCT ${treatmentSessions.therapistId})`,
    })
    .from(treatmentSessions)
    .where(and(
      eq(treatmentSessions.practiceId, practiceId),
      gte(treatmentSessions.sessionDate, startStr),
      lte(treatmentSessions.sessionDate, endStr),
    ));
  const totalSessions = Number(sessionRows[0]?.totalSessions) || 0;
  const distinctProviders = Number(sessionRows[0]?.distinctProviders) || 0;
  const periodWeeks = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)));
  const sessionsPerProviderPerWeek = distinctProviders > 0
    ? Math.round((totalSessions / distinctProviders / periodWeeks) * 10) / 10
    : 0;

  // Revenue per visit
  const revenuePerVisit = completedAppts > 0 ? Math.round((totalPaid / completedAppts) * 100) / 100 : 0;

  // Patient retention: patients who had > 1 session in the period
  const retentionRows = await db
    .select({
      totalPatients: sql<number>`COUNT(DISTINCT ${treatmentSessions.patientId})`,
      returningPatients: sql<number>`COUNT(DISTINCT ${treatmentSessions.patientId}) FILTER (WHERE ${treatmentSessions.patientId} IN (
        SELECT ${treatmentSessions.patientId} FROM ${treatmentSessions}
        WHERE ${treatmentSessions.practiceId} = ${practiceId}
          AND ${treatmentSessions.sessionDate} >= ${startStr}
          AND ${treatmentSessions.sessionDate} <= ${endStr}
        GROUP BY ${treatmentSessions.patientId}
        HAVING COUNT(*) > 1
      ))`,
    })
    .from(treatmentSessions)
    .where(and(
      eq(treatmentSessions.practiceId, practiceId),
      gte(treatmentSessions.sessionDate, startStr),
      lte(treatmentSessions.sessionDate, endStr),
    ));
  const totalPatients = Number(retentionRows[0]?.totalPatients) || 0;
  const returningPatients = Number(retentionRows[0]?.returningPatients) || 0;

  return {
    collectionsRate: totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 10000) / 100 : 0,
    avgDaysInAR,
    cleanClaimRate,
    denialRate: submittedCount > 0 ? Math.round((deniedCount / submittedCount) * 10000) / 100 : 0,
    firstPassPaymentRate: submittedCount > 0 ? Math.round((firstPassPaid / submittedCount) * 10000) / 100 : 0,
    revenuePerVisit,
    sessionsPerProviderPerWeek,
    noShowRate: totalAppts > 0 ? Math.round((noShowAppts / totalAppts) * 10000) / 100 : 0,
    cancellationRate: totalAppts > 0 ? Math.round((cancelledAppts / totalAppts) * 10000) / 100 : 0,
    patientRetentionRate: totalPatients > 0 ? Math.round((returningPatients / totalPatients) * 10000) / 100 : 0,
  };
}

// ---------------------------------------------------------------------------
// GET /metrics?period=3m — calculated practice KPIs for the given period
// ---------------------------------------------------------------------------

router.get('/metrics', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const months = parsePeriodMonths(req.query.period as string);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const cacheKey = `practice:${practiceId}:benchmarking:metrics:${months}m`;
    const data = await cache.wrap(cacheKey, CacheTTL.ANALYTICS, () =>
      calculateKPIs(practiceId, startDate, endDate),
    );
    res.json(data);
  } catch (error) {
    logger.error('Error fetching benchmarking metrics', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch benchmarking metrics' });
  }
});

// ---------------------------------------------------------------------------
// GET /trends?months=6 — monthly KPI history
// ---------------------------------------------------------------------------

router.get('/trends', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const trendMonths = Math.min(Math.max(parseInt(req.query.months as string) || 6, 1), 24);

    const cacheKey = `practice:${practiceId}:benchmarking:trends:${trendMonths}`;
    const cached = await cache.get<any>(cacheKey);
    if (cached !== null) return res.json(cached);

    const now = new Date();
    const results: Array<{ month: string; [key: string]: string | number }> = [];

    for (let i = trendMonths - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const kpis = await calculateKPIs(practiceId, monthStart, monthEnd);
      const label = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;
      results.push({ month: label, ...kpis });
    }

    await cache.set(cacheKey, results, CacheTTL.ANALYTICS);
    res.json(results);
  } catch (error) {
    logger.error('Error fetching benchmarking trends', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch benchmarking trends' });
  }
});

export default router;
