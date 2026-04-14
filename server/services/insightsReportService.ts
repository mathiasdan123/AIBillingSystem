/**
 * Insights Report Service
 *
 * Generates daily and weekly AI-powered insight reports for front desk staff
 * and practice owners. Aggregates data from existing storage/analytics functions.
 */

import { storage } from '../storage';
import { getDb } from '../db';
import { claims, appointments } from '@shared/schema';
import { eq, and, gte, lte, lt, sql, count, sum } from 'drizzle-orm';
import { getExpiringAuthorizations } from './authorizationService';
import logger from './logger';

// ==================== TYPE DEFINITIONS ====================

export interface DailyInsightReport {
  reportDate: string;
  practiceId: number;
  practiceName: string;
  generatedAt: string;

  claimsSummary: {
    newToday: number;
    submittedToday: number;
    paidToday: number;
    deniedToday: number;
  };

  revenueCollectedToday: number;

  patientVolume: {
    completed: number;
    noShows: number;
    cancellations: number;
    scheduled: number;
  };

  denialRateTrailing7Day: number;

  expiringAuthorizations: {
    patientName: string;
    authorizationId: number;
    expirationDate: string;
    remainingVisits: number | null;
  }[];

  agingClaims: {
    over30: { count: number; amount: number };
    over60: { count: number; amount: number };
    over90: { count: number; amount: number };
  };

  actionItems: {
    priority: 'high' | 'medium' | 'low';
    category: string;
    description: string;
  }[];
}

export interface WeeklyInsightReport {
  weekOf: string;
  weekEnd: string;
  practiceId: number;
  practiceName: string;
  generatedAt: string;

  claimTrends: {
    thisWeek: { total: number; paid: number; denied: number; submitted: number };
    lastWeek: { total: number; paid: number; denied: number; submitted: number };
    changePercent: {
      total: number;
      paid: number;
      denied: number;
    };
  };

  revenueSummary: {
    totalCollected: number;
    totalOutstanding: number;
    totalExpected: number;
  };

  topDenialReasons: { reason: string; count: number }[];

  patientVolumeTrends: {
    thisWeek: { completed: number; noShows: number; cancellations: number };
    lastWeek: { completed: number; noShows: number; cancellations: number };
  };

  collectionRateByPayer: { payer: string; rate: number; billed: number; collected: number }[];

  expiringAuthorizations: {
    patientName: string;
    authorizationId: number;
    expirationDate: string;
    remainingVisits: number | null;
  }[];

  recommendations: string[];
}

// ==================== HELPERS ====================

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function percentChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

async function getClaimCountsByDateRange(
  db: any,
  practiceId: number,
  start: Date,
  end: Date,
): Promise<{ total: number; paid: number; denied: number; submitted: number }> {
  const rows = await db
    .select({
      total: count(),
      paid: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'paid')`,
      denied: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'denied')`,
      submitted: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'submitted')`,
    })
    .from(claims)
    .where(
      and(
        eq(claims.practiceId, practiceId),
        gte(claims.createdAt, start),
        lt(claims.createdAt, end),
      ),
    );

  return {
    total: Number(rows[0]?.total) || 0,
    paid: Number(rows[0]?.paid) || 0,
    denied: Number(rows[0]?.denied) || 0,
    submitted: Number(rows[0]?.submitted) || 0,
  };
}

async function getAppointmentVolume(
  db: any,
  practiceId: number,
  start: Date,
  end: Date,
): Promise<{ completed: number; noShows: number; cancellations: number; scheduled: number }> {
  const rows = await db
    .select({
      scheduled: count(),
      completed: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'completed')`,
      noShows: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'no_show')`,
      cancellations: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'cancelled')`,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.practiceId, practiceId),
        gte(appointments.startTime, start),
        lt(appointments.startTime, end),
      ),
    );

  return {
    scheduled: Number(rows[0]?.scheduled) || 0,
    completed: Number(rows[0]?.completed) || 0,
    noShows: Number(rows[0]?.noShows) || 0,
    cancellations: Number(rows[0]?.cancellations) || 0,
  };
}

// ==================== DAILY REPORT ====================

export async function generateDailyReport(
  practiceId: number,
  date?: Date,
): Promise<DailyInsightReport> {
  const db = await getDb();
  const reportDate = date || new Date();
  const dayStart = new Date(reportDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // 7 days ago for trailing denial rate
  const sevenDaysAgo = new Date(dayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Practice name
  const practice = await storage.getPractice(practiceId);
  const practiceName = practice?.name || 'Your Practice';

  // Claims summary for today
  const todayClaims = await getClaimCountsByDateRange(db, practiceId, dayStart, dayEnd);

  // Revenue collected today (paid claims)
  const revenueRows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${claims.paidAmount}::numeric), 0)`,
    })
    .from(claims)
    .where(
      and(
        eq(claims.practiceId, practiceId),
        eq(claims.status, 'paid'),
        gte(claims.paidAt, dayStart),
        lt(claims.paidAt, dayEnd),
      ),
    );
  const revenueCollectedToday = parseFloat(revenueRows[0]?.total || '0');

  // Patient volume for today
  const patientVolume = await getAppointmentVolume(db, practiceId, dayStart, dayEnd);

  // Trailing 7-day denial rate
  const trailing7d = await getClaimCountsByDateRange(db, practiceId, sevenDaysAgo, dayEnd);
  const denialRateTrailing7Day =
    trailing7d.total > 0
      ? Math.round((trailing7d.denied / trailing7d.total) * 10000) / 100
      : 0;

  // Expiring authorizations (next 7 days)
  let expiringAuthorizations: DailyInsightReport['expiringAuthorizations'] = [];
  try {
    const expiring = await getExpiringAuthorizations(practiceId, 7);
    expiringAuthorizations = expiring.map((auth: any) => ({
      patientName: auth.patientName || `Patient ${auth.patientId}`,
      authorizationId: auth.id,
      expirationDate: auth.endDate || auth.expirationDate || '',
      remainingVisits: auth.remainingUnits ?? auth.approvedUnits ?? null,
    }));
  } catch (err) {
    logger.warn('Could not fetch expiring authorizations for daily report', {
      practiceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // AR aging
  const arAging = await storage.getDaysInAR(practiceId);
  const over30 = { count: 0, amount: 0 };
  const over60 = { count: 0, amount: 0 };
  const over90 = { count: 0, amount: 0 };

  for (const bucket of arAging.byBucket) {
    if (bucket.bucket === '31-60' || bucket.bucket === '61-90' || bucket.bucket === '91-120' || bucket.bucket === '120+') {
      over30.count += bucket.count;
      over30.amount += bucket.amount;
    }
    if (bucket.bucket === '61-90' || bucket.bucket === '91-120' || bucket.bucket === '120+') {
      over60.count += bucket.count;
      over60.amount += bucket.amount;
    }
    if (bucket.bucket === '91-120' || bucket.bucket === '120+') {
      over90.count += bucket.count;
      over90.amount += bucket.amount;
    }
  }

  // Generate action items
  const actionItems: DailyInsightReport['actionItems'] = [];

  if (todayClaims.denied > 0) {
    actionItems.push({
      priority: 'high',
      category: 'Denials',
      description: `${todayClaims.denied} claim(s) were denied today. Review denial reasons and consider filing appeals.`,
    });
  }

  if (over90.count > 0) {
    actionItems.push({
      priority: 'high',
      category: 'Aging Claims',
      description: `${over90.count} claims are over 90 days old totaling $${over90.amount.toFixed(2)}. Follow up with payers immediately.`,
    });
  }

  if (expiringAuthorizations.length > 0) {
    actionItems.push({
      priority: 'medium',
      category: 'Authorizations',
      description: `${expiringAuthorizations.length} authorization(s) expiring within 7 days. Submit renewal requests.`,
    });
  }

  if (patientVolume.noShows > 0) {
    actionItems.push({
      priority: 'medium',
      category: 'No-Shows',
      description: `${patientVolume.noShows} patient(s) were no-shows today. Consider rescheduling or applying no-show policy.`,
    });
  }

  if (denialRateTrailing7Day > 10) {
    actionItems.push({
      priority: 'high',
      category: 'Denial Rate',
      description: `Trailing 7-day denial rate is ${denialRateTrailing7Day}%, which exceeds the 10% threshold. Review claim submission accuracy.`,
    });
  }

  if (over30.count > 0 && over60.count === 0) {
    actionItems.push({
      priority: 'low',
      category: 'Follow-Up',
      description: `${over30.count} claims are in the 31-60 day aging bucket. Schedule follow-ups with payers.`,
    });
  }

  return {
    reportDate: formatDate(dayStart),
    practiceId,
    practiceName,
    generatedAt: new Date().toISOString(),
    claimsSummary: {
      newToday: todayClaims.total,
      submittedToday: todayClaims.submitted,
      paidToday: todayClaims.paid,
      deniedToday: todayClaims.denied,
    },
    revenueCollectedToday,
    patientVolume,
    denialRateTrailing7Day,
    expiringAuthorizations,
    agingClaims: { over30, over60, over90 },
    actionItems,
  };
}

// ==================== WEEKLY REPORT ====================

export async function generateWeeklyReport(
  practiceId: number,
  weekOf?: Date,
): Promise<WeeklyInsightReport> {
  const db = await getDb();
  const startOfWeek = weekOf ? new Date(weekOf) : new Date();
  // Normalize to Monday
  const day = startOfWeek.getDay();
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
  startOfWeek.setDate(diff);
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const prevWeekStart = new Date(startOfWeek);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd = new Date(startOfWeek);

  // Practice name
  const practice = await storage.getPractice(practiceId);
  const practiceName = practice?.name || 'Your Practice';

  // Claim trends: this week vs last week
  const thisWeekClaims = await getClaimCountsByDateRange(db, practiceId, startOfWeek, endOfWeek);
  const lastWeekClaims = await getClaimCountsByDateRange(db, practiceId, prevWeekStart, prevWeekEnd);

  const claimTrends = {
    thisWeek: thisWeekClaims,
    lastWeek: lastWeekClaims,
    changePercent: {
      total: percentChange(thisWeekClaims.total, lastWeekClaims.total),
      paid: percentChange(thisWeekClaims.paid, lastWeekClaims.paid),
      denied: percentChange(thisWeekClaims.denied, lastWeekClaims.denied),
    },
  };

  // Revenue summary
  const collectedRows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${claims.paidAmount}::numeric), 0)`,
    })
    .from(claims)
    .where(
      and(
        eq(claims.practiceId, practiceId),
        eq(claims.status, 'paid'),
        gte(claims.paidAt, startOfWeek),
        lt(claims.paidAt, endOfWeek),
      ),
    );
  const totalCollected = parseFloat(collectedRows[0]?.total || '0');

  const outstandingRows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${claims.totalAmount}::numeric), 0)`,
    })
    .from(claims)
    .where(
      and(
        eq(claims.practiceId, practiceId),
        sql`${claims.status} IN ('submitted', 'pending', 'draft')`,
      ),
    );
  const totalOutstanding = parseFloat(outstandingRows[0]?.total || '0');

  // Expected: submitted claims amount
  const expectedRows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${claims.totalAmount}::numeric), 0)`,
    })
    .from(claims)
    .where(
      and(
        eq(claims.practiceId, practiceId),
        eq(claims.status, 'submitted'),
      ),
    );
  const totalExpected = parseFloat(expectedRows[0]?.total || '0');

  // Top denial reasons this week
  const denialReasonRows = await db
    .select({
      reason: claims.denialReason,
      cnt: count(),
    })
    .from(claims)
    .where(
      and(
        eq(claims.practiceId, practiceId),
        eq(claims.status, 'denied'),
        gte(claims.updatedAt, startOfWeek),
        lt(claims.updatedAt, endOfWeek),
      ),
    )
    .groupBy(claims.denialReason)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(5);

  const topDenialReasons = denialReasonRows.map((row: any) => ({
    reason: row.reason || 'Unknown',
    count: Number(row.cnt) || 0,
  }));

  // Patient volume trends
  const thisWeekVolume = await getAppointmentVolume(db, practiceId, startOfWeek, endOfWeek);
  const lastWeekVolume = await getAppointmentVolume(db, practiceId, prevWeekStart, prevWeekEnd);

  // Collection rate by payer
  const collectionRateData = await storage.getCollectionRate(practiceId);
  const collectionRateByPayer = collectionRateData.byInsurance.map((ins) => ({
    payer: ins.name,
    rate: Math.round(ins.rate * 100) / 100,
    billed: ins.billed,
    collected: ins.collected,
  }));

  // Expiring authorizations (next 14 days)
  let expiringAuthorizations: WeeklyInsightReport['expiringAuthorizations'] = [];
  try {
    const expiring = await getExpiringAuthorizations(practiceId, 14);
    expiringAuthorizations = expiring.map((auth: any) => ({
      patientName: auth.patientName || `Patient ${auth.patientId}`,
      authorizationId: auth.id,
      expirationDate: auth.endDate || auth.expirationDate || '',
      remainingVisits: auth.remainingUnits ?? auth.approvedUnits ?? null,
    }));
  } catch (err) {
    logger.warn('Could not fetch expiring authorizations for weekly report', {
      practiceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // AI recommendations based on patterns
  const recommendations: string[] = [];

  if (claimTrends.changePercent.denied > 20) {
    recommendations.push(
      `Denial volume increased ${claimTrends.changePercent.denied}% this week. Review the top denial reasons and address recurring issues.`,
    );
  }

  if (collectionRateData.collectionRate < 90) {
    recommendations.push(
      `Collection rate is ${collectionRateData.collectionRate.toFixed(1)}%, below the 90% target. Focus follow-up efforts on aged claims.`,
    );
  }

  const thisWeekNoShowRate =
    thisWeekVolume.scheduled > 0
      ? (thisWeekVolume.noShows / thisWeekVolume.scheduled) * 100
      : 0;
  if (thisWeekNoShowRate > 5) {
    recommendations.push(
      `No-show rate was ${thisWeekNoShowRate.toFixed(1)}% this week. Consider implementing appointment reminders or adjusting the no-show policy.`,
    );
  }

  if (expiringAuthorizations.length >= 5) {
    recommendations.push(
      `${expiringAuthorizations.length} authorizations expire in the next 2 weeks. Prioritize renewal submissions to avoid coverage gaps.`,
    );
  }

  const arAging = await storage.getDaysInAR(practiceId);
  if (arAging.averageDays > 45) {
    recommendations.push(
      `Average days in AR is ${arAging.averageDays} days, which is above the 45-day benchmark. Increase follow-up frequency on outstanding claims.`,
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      'Practice metrics are within normal ranges this week. Continue current billing and follow-up workflows.',
    );
  }

  return {
    weekOf: formatDate(startOfWeek),
    weekEnd: formatDate(endOfWeek),
    practiceId,
    practiceName,
    generatedAt: new Date().toISOString(),
    claimTrends,
    revenueSummary: { totalCollected, totalOutstanding, totalExpected },
    topDenialReasons,
    patientVolumeTrends: {
      thisWeek: {
        completed: thisWeekVolume.completed,
        noShows: thisWeekVolume.noShows,
        cancellations: thisWeekVolume.cancellations,
      },
      lastWeek: {
        completed: lastWeekVolume.completed,
        noShows: lastWeekVolume.noShows,
        cancellations: lastWeekVolume.cancellations,
      },
    },
    collectionRateByPayer,
    expiringAuthorizations,
    recommendations,
  };
}
