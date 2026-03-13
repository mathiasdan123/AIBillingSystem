/**
 * Practice Analytics Service
 *
 * Provides enhanced analytics for practice management:
 * - Revenue breakdown by payer, CPT code, and provider
 * - Claim metrics (denial rate, clean claim rate, payment timing)
 * - Provider productivity metrics
 * - Payer performance analysis
 * - Trend data over time
 */

import { getDb } from '../db';
import {
  claims, claimLineItems, cptCodes, insurances, users,
  appointments, treatmentSessions,
} from '@shared/schema';
import { eq, and, gte, lte, sql, count, sum, avg, isNotNull } from 'drizzle-orm';

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface RevenueByPayer {
  payerId: number;
  payerName: string;
  totalBilled: number;
  totalPaid: number;
  claimCount: number;
}

export interface RevenueByCpt {
  cptCode: string;
  description: string;
  totalBilled: number;
  totalPaid: number;
  claimCount: number;
}

export interface RevenueByProvider {
  providerId: string;
  providerName: string;
  totalBilled: number;
  totalPaid: number;
  claimCount: number;
}

export interface RevenueBreakdown {
  byPayer: RevenueByPayer[];
  byCpt: RevenueByCpt[];
  byProvider: RevenueByProvider[];
  totalBilled: number;
  totalPaid: number;
}

export interface ClaimMetrics {
  avgSubmissionToPaymentDays: number;
  denialRate: number;
  cleanClaimRate: number;
  firstPassResolutionRate: number;
  totalSubmitted: number;
  totalDenied: number;
  totalPaid: number;
}

export interface ProviderProductivityRecord {
  providerId: string;
  providerName: string;
  appointmentsCount: number;
  claimsSubmitted: number;
  totalRevenue: number;
  avgClaimValue: number;
}

export interface PayerPerformanceRecord {
  payerId: number;
  payerName: string;
  avgPaymentTimeDays: number;
  denialRate: number;
  avgReimbursementRate: number;
  totalClaims: number;
}

export interface TrendDataPoint {
  month: string;
  revenue: number;
  claimVolume: number;
  denialRate: number;
}

/**
 * Get revenue breakdown by payer, CPT code, and provider.
 */
export async function getRevenueBreakdown(
  practiceId: number,
  startDate: Date,
  endDate: Date,
): Promise<RevenueBreakdown> {
  const db = await getDb();

  // Revenue by payer
  const byPayerRows = await db
    .select({
      payerId: insurances.id,
      payerName: insurances.name,
      totalBilled: sql<string>`COALESCE(SUM(${claims.totalAmount}::numeric), 0)`,
      totalPaid: sql<string>`COALESCE(SUM(${claims.paidAmount}::numeric), 0)`,
      claimCount: count(),
    })
    .from(claims)
    .innerJoin(insurances, eq(claims.insuranceId, insurances.id))
    .where(and(
      eq(claims.practiceId, practiceId),
      gte(claims.createdAt, startDate),
      lte(claims.createdAt, endDate),
    ))
    .groupBy(insurances.id, insurances.name);

  const byPayer: RevenueByPayer[] = byPayerRows.map((row: any) => ({
    payerId: row.payerId,
    payerName: row.payerName,
    totalBilled: parseFloat(row.totalBilled) || 0,
    totalPaid: parseFloat(row.totalPaid) || 0,
    claimCount: Number(row.claimCount) || 0,
  }));

  // Revenue by CPT code
  const byCptRows = await db
    .select({
      cptCode: cptCodes.code,
      description: cptCodes.description,
      totalBilled: sql<string>`COALESCE(SUM(${claimLineItems.amount}::numeric), 0)`,
      totalPaid: sql<string>`COALESCE(SUM(
        CASE WHEN ${claims.status} = 'paid' THEN ${claimLineItems.amount}::numeric ELSE 0 END
      ), 0)`,
      claimCount: count(),
    })
    .from(claimLineItems)
    .innerJoin(claims, eq(claimLineItems.claimId, claims.id))
    .innerJoin(cptCodes, eq(claimLineItems.cptCodeId, cptCodes.id))
    .where(and(
      eq(claims.practiceId, practiceId),
      gte(claims.createdAt, startDate),
      lte(claims.createdAt, endDate),
    ))
    .groupBy(cptCodes.code, cptCodes.description);

  const byCpt: RevenueByCpt[] = byCptRows.map((row: any) => ({
    cptCode: row.cptCode,
    description: row.description,
    totalBilled: parseFloat(row.totalBilled) || 0,
    totalPaid: parseFloat(row.totalPaid) || 0,
    claimCount: Number(row.claimCount) || 0,
  }));

  // Revenue by provider
  const byProviderRows = await db
    .select({
      providerId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      totalBilled: sql<string>`COALESCE(SUM(${claims.totalAmount}::numeric), 0)`,
      totalPaid: sql<string>`COALESCE(SUM(${claims.paidAmount}::numeric), 0)`,
      claimCount: count(),
    })
    .from(claims)
    .innerJoin(treatmentSessions, eq(claims.sessionId, treatmentSessions.id))
    .innerJoin(users, eq(treatmentSessions.therapistId, users.id))
    .where(and(
      eq(claims.practiceId, practiceId),
      gte(claims.createdAt, startDate),
      lte(claims.createdAt, endDate),
    ))
    .groupBy(users.id, users.firstName, users.lastName);

  const byProvider: RevenueByProvider[] = byProviderRows.map((row: any) => ({
    providerId: row.providerId,
    providerName: `${row.firstName || ''} ${row.lastName || ''}`.trim() || 'Unknown',
    totalBilled: parseFloat(row.totalBilled) || 0,
    totalPaid: parseFloat(row.totalPaid) || 0,
    claimCount: Number(row.claimCount) || 0,
  }));

  // Totals
  const totalBilled = byPayer.reduce((sum, p) => sum + p.totalBilled, 0);
  const totalPaid = byPayer.reduce((sum, p) => sum + p.totalPaid, 0);

  return { byPayer, byCpt, byProvider, totalBilled, totalPaid };
}

/**
 * Get claim metrics: avg submission-to-payment time, denial rate, clean claim rate,
 * and first-pass resolution rate.
 */
export async function getClaimMetrics(
  practiceId: number,
  startDate: Date,
  endDate: Date,
): Promise<ClaimMetrics> {
  const db = await getDb();

  // Overall counts by status
  const statusRows = await db
    .select({
      totalSubmitted: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} != 'draft')`,
      totalPaid: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'paid')`,
      totalDenied: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'denied')`,
      // Clean claims: paid without denial (no denial reason, paid on first pass)
      cleanClaims: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'paid' AND ${claims.denialReason} IS NULL)`,
      // First-pass resolution: paid without going through appeal
      firstPassPaid: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'paid' AND ${claims.denialReason} IS NULL)`,
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      gte(claims.createdAt, startDate),
      lte(claims.createdAt, endDate),
    ));

  const stats = statusRows[0] || {
    totalSubmitted: 0,
    totalPaid: 0,
    totalDenied: 0,
    cleanClaims: 0,
    firstPassPaid: 0,
  };

  const totalSubmitted = Number(stats.totalSubmitted) || 0;
  const totalPaid = Number(stats.totalPaid) || 0;
  const totalDenied = Number(stats.totalDenied) || 0;
  const cleanClaims = Number(stats.cleanClaims) || 0;
  const firstPassPaid = Number(stats.firstPassPaid) || 0;

  // Avg submission-to-payment time (in days) for paid claims
  const paymentTimeRows = await db
    .select({
      avgDays: sql<string>`COALESCE(AVG(
        EXTRACT(EPOCH FROM (${claims.paidAt} - ${claims.submittedAt})) / 86400
      ), 0)`,
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      eq(claims.status, 'paid'),
      isNotNull(claims.submittedAt),
      isNotNull(claims.paidAt),
      gte(claims.createdAt, startDate),
      lte(claims.createdAt, endDate),
    ));

  const avgSubmissionToPaymentDays = Math.round((parseFloat(paymentTimeRows[0]?.avgDays || '0')) * 100) / 100;

  return {
    avgSubmissionToPaymentDays,
    denialRate: totalSubmitted > 0
      ? Math.round((totalDenied / totalSubmitted) * 10000) / 100
      : 0,
    cleanClaimRate: totalSubmitted > 0
      ? Math.round((cleanClaims / totalSubmitted) * 10000) / 100
      : 0,
    firstPassResolutionRate: totalPaid > 0
      ? Math.round((firstPassPaid / totalPaid) * 10000) / 100
      : 0,
    totalSubmitted,
    totalDenied,
    totalPaid,
  };
}

/**
 * Get provider productivity: per-provider appointments, claims, revenue, avg claim value.
 */
export async function getProviderProductivity(
  practiceId: number,
  startDate: Date,
  endDate: Date,
): Promise<ProviderProductivityRecord[]> {
  const db = await getDb();

  // Get all providers (therapists) for the practice
  const providers = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(and(
      eq(users.practiceId, practiceId),
      eq(users.role, 'therapist'),
    ));

  const results: ProviderProductivityRecord[] = [];

  for (const provider of providers) {
    // Appointment count
    const apptRows = await db
      .select({ total: count() })
      .from(appointments)
      .where(and(
        eq(appointments.therapistId, provider.id),
        eq(appointments.practiceId, practiceId),
        gte(appointments.startTime, startDate),
        lte(appointments.startTime, endDate),
      ));

    const appointmentsCount = Number(apptRows[0]?.total) || 0;

    // Claims submitted and revenue
    const claimRows = await db
      .select({
        claimsSubmitted: count(),
        totalRevenue: sql<string>`COALESCE(SUM(${claims.paidAmount}::numeric), 0)`,
        avgClaimValue: sql<string>`COALESCE(AVG(${claims.totalAmount}::numeric), 0)`,
      })
      .from(claims)
      .innerJoin(treatmentSessions, eq(claims.sessionId, treatmentSessions.id))
      .where(and(
        eq(treatmentSessions.therapistId, provider.id),
        eq(claims.practiceId, practiceId),
        gte(claims.createdAt, startDate),
        lte(claims.createdAt, endDate),
      ));

    const claimsSubmitted = Number(claimRows[0]?.claimsSubmitted) || 0;
    const totalRevenue = parseFloat(claimRows[0]?.totalRevenue || '0') || 0;
    const avgClaimValue = parseFloat(claimRows[0]?.avgClaimValue || '0') || 0;

    results.push({
      providerId: provider.id,
      providerName: `${provider.firstName || ''} ${provider.lastName || ''}`.trim() || 'Unknown',
      appointmentsCount,
      claimsSubmitted,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      avgClaimValue: Math.round(avgClaimValue * 100) / 100,
    });
  }

  return results;
}

/**
 * Get payer performance: per-payer avg payment time, denial rate, avg reimbursement rate.
 */
export async function getPayerPerformance(
  practiceId: number,
  startDate: Date,
  endDate: Date,
): Promise<PayerPerformanceRecord[]> {
  const db = await getDb();

  const rows = await db
    .select({
      payerId: insurances.id,
      payerName: insurances.name,
      totalClaims: count(),
      totalDenied: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'denied')`,
      avgPaymentDays: sql<string>`COALESCE(AVG(
        CASE WHEN ${claims.status} = 'paid' AND ${claims.submittedAt} IS NOT NULL AND ${claims.paidAt} IS NOT NULL
          THEN EXTRACT(EPOCH FROM (${claims.paidAt} - ${claims.submittedAt})) / 86400
          ELSE NULL
        END
      ), 0)`,
      avgReimbursementRate: sql<string>`COALESCE(AVG(
        CASE WHEN ${claims.totalAmount}::numeric > 0 AND ${claims.paidAmount} IS NOT NULL
          THEN (${claims.paidAmount}::numeric / ${claims.totalAmount}::numeric) * 100
          ELSE NULL
        END
      ), 0)`,
    })
    .from(claims)
    .innerJoin(insurances, eq(claims.insuranceId, insurances.id))
    .where(and(
      eq(claims.practiceId, practiceId),
      gte(claims.createdAt, startDate),
      lte(claims.createdAt, endDate),
    ))
    .groupBy(insurances.id, insurances.name);

  return rows.map((row: any) => {
    const totalClaims = Number(row.totalClaims) || 0;
    const totalDenied = Number(row.totalDenied) || 0;
    return {
      payerId: row.payerId,
      payerName: row.payerName,
      avgPaymentTimeDays: Math.round((parseFloat(row.avgPaymentDays) || 0) * 100) / 100,
      denialRate: totalClaims > 0
        ? Math.round((totalDenied / totalClaims) * 10000) / 100
        : 0,
      avgReimbursementRate: Math.round((parseFloat(row.avgReimbursementRate) || 0) * 100) / 100,
      totalClaims,
    };
  });
}

/**
 * Get trend data: monthly revenue, claim volume, and denial rate.
 */
export async function getTrendData(
  practiceId: number,
  months: number = 12,
): Promise<TrendDataPoint[]> {
  const db = await getDb();

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);

  const rows = await db
    .select({
      month: sql<string>`TO_CHAR(${claims.createdAt}, 'YYYY-MM')`,
      revenue: sql<string>`COALESCE(SUM(${claims.paidAmount}::numeric), 0)`,
      claimVolume: count(),
      deniedCount: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'denied')`,
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      gte(claims.createdAt, startDate),
    ))
    .groupBy(sql`TO_CHAR(${claims.createdAt}, 'YYYY-MM')`)
    .orderBy(sql`TO_CHAR(${claims.createdAt}, 'YYYY-MM')`);

  return rows.map((row: any) => {
    const claimVolume = Number(row.claimVolume) || 0;
    const deniedCount = Number(row.deniedCount) || 0;
    return {
      month: row.month,
      revenue: parseFloat(row.revenue) || 0,
      claimVolume,
      denialRate: claimVolume > 0
        ? Math.round((deniedCount / claimVolume) * 10000) / 100
        : 0,
    };
  });
}
