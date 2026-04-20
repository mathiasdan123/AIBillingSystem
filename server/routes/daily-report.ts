/**
 * Daily Billing Summary Report Routes
 *
 * Handles:
 * - GET /api/daily-report — Get daily report data (optional ?date=YYYY-MM-DD)
 * - GET /api/daily-report/send — Trigger sending the report email manually
 * - POST /api/daily-report/subscribe — Subscribe email for daily reports
 */

import { Router } from 'express';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';
import { getDb } from '../db';
import {
  claims, paymentPostings, patientPayments, patientStatements, paymentTransactions,
} from '@shared/schema';
import { eq, and, gte, lte, lt, sql, count, sum } from 'drizzle-orm';
import { sendEmail, isSmtpConfigured } from '../services/emailService';
import logger from '../services/logger';
import { cache, CacheKeys, CacheTTL } from '../services/cacheService';

const router = Router();

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
  return userPracticeId || 1;
};

// In-memory store for daily report email subscribers (per practice)
const reportSubscribers: Map<number, Set<string>> = new Map();

export interface DailyReportData {
  reportDate: string;
  practiceName: string;
  claims: {
    newCreated: { count: number; totalAmount: number };
    submitted: { count: number; totalAmount: number };
    paid: { count: number; totalPaid: number };
    denied: { count: number; totalAmount: number };
    pending: { count: number; totalOutstanding: number };
  };
  payments: {
    insurancePosted: { count: number; totalAmount: number };
    patientReceived: { count: number; totalAmount: number };
    totalCashCollected: number;
    adjustments: number;
    netCollectionRate: number;
  };
  patientBilling: {
    statementsGenerated: number;
    statementsSent: number;
    outstandingBalance: number;
    overdueStatements: { count: number; totalAmount: number };
    arAging: {
      current: number;
      thirtyToSixty: number;
      sixtyToNinety: number;
      ninetyPlus: number;
    };
  };
  keyMetrics: {
    averageDaysInAR: number;
    collectionRate30Day: number;
    denialRate30Day: number;
    cleanClaimRate30Day: number;
  };
  frontDesk: {
    // Avg minutes between check-in and session-start for today's
    // appointments that have both timestamps set. 0 with 0 appointments
    // if the day has no eligible data.
    avgWaitMinutes: number;
    maxWaitMinutes: number;
    appointments: number;
  };
}

/**
 * Build daily report data for a given practice and date.
 */
async function buildDailyReport(practiceId: number, reportDate: Date): Promise<DailyReportData> {
  const db = await getDb();

  // Date boundaries: start of reportDate to start of next day
  const dayStart = new Date(reportDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const dayStartStr = dayStart.toISOString().split('T')[0];
  const dayEndStr = dayEnd.toISOString().split('T')[0];

  // 30 days ago for trailing metrics
  const thirtyDaysAgo = new Date(dayStart);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Get practice name
  const practice = await storage.getPractice(practiceId);
  const practiceName = practice?.name || 'Your Practice';

  // ========== SECTION A: Claims Summary ==========

  // New claims created today
  const newClaimsRows = await db
    .select({
      cnt: count(),
      total: sql<string>`COALESCE(SUM(${claims.totalAmount}::numeric), 0)`,
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      gte(claims.createdAt, dayStart),
      lt(claims.createdAt, dayEnd),
    ));

  const newCreated = {
    count: Number(newClaimsRows[0]?.cnt) || 0,
    totalAmount: parseFloat(newClaimsRows[0]?.total || '0'),
  };

  // Claims submitted today
  const submittedRows = await db
    .select({
      cnt: count(),
      total: sql<string>`COALESCE(SUM(${claims.submittedAmount}::numeric), 0)`,
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      gte(claims.submittedAt, dayStart),
      lt(claims.submittedAt, dayEnd),
    ));

  const submitted = {
    count: Number(submittedRows[0]?.cnt) || 0,
    totalAmount: parseFloat(submittedRows[0]?.total || '0'),
  };

  // Claims paid today
  const paidRows = await db
    .select({
      cnt: count(),
      total: sql<string>`COALESCE(SUM(${claims.paidAmount}::numeric), 0)`,
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      eq(claims.status, 'paid'),
      gte(claims.paidAt, dayStart),
      lt(claims.paidAt, dayEnd),
    ));

  const paid = {
    count: Number(paidRows[0]?.cnt) || 0,
    totalPaid: parseFloat(paidRows[0]?.total || '0'),
  };

  // Claims denied today
  const deniedRows = await db
    .select({
      cnt: count(),
      total: sql<string>`COALESCE(SUM(${claims.totalAmount}::numeric), 0)`,
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      eq(claims.status, 'denied'),
      gte(claims.updatedAt, dayStart),
      lt(claims.updatedAt, dayEnd),
    ));

  const denied = {
    count: Number(deniedRows[0]?.cnt) || 0,
    totalAmount: parseFloat(deniedRows[0]?.total || '0'),
  };

  // Claims pending (all-time)
  const pendingRows = await db
    .select({
      cnt: count(),
      total: sql<string>`COALESCE(SUM(${claims.totalAmount}::numeric), 0)`,
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      sql`${claims.status} IN ('draft', 'submitted')`,
    ));

  const pending = {
    count: Number(pendingRows[0]?.cnt) || 0,
    totalOutstanding: parseFloat(pendingRows[0]?.total || '0'),
  };

  // ========== SECTION B: Payment Activity ==========

  // Insurance payments posted today
  const insurancePaymentRows = await db
    .select({
      cnt: count(),
      total: sql<string>`COALESCE(SUM(${paymentPostings.paymentAmount}::numeric), 0)`,
      adjustments: sql<string>`COALESCE(SUM(${paymentPostings.adjustmentAmount}::numeric), 0)`,
    })
    .from(paymentPostings)
    .where(and(
      eq(paymentPostings.practiceId, practiceId),
      gte(paymentPostings.paymentDate, dayStartStr),
      lt(paymentPostings.paymentDate, dayEndStr),
    ));

  const insurancePosted = {
    count: Number(insurancePaymentRows[0]?.cnt) || 0,
    totalAmount: parseFloat(insurancePaymentRows[0]?.total || '0'),
  };
  const adjustments = parseFloat(insurancePaymentRows[0]?.adjustments || '0');

  // Patient payments received today
  const patientPaymentRows = await db
    .select({
      cnt: count(),
      total: sql<string>`COALESCE(SUM(${patientPayments.amount}::numeric), 0)`,
    })
    .from(patientPayments)
    .where(and(
      eq(patientPayments.practiceId, practiceId),
      gte(patientPayments.paymentDate, dayStart),
      lt(patientPayments.paymentDate, dayEnd),
    ));

  const patientReceived = {
    count: Number(patientPaymentRows[0]?.cnt) || 0,
    totalAmount: parseFloat(patientPaymentRows[0]?.total || '0'),
  };

  const totalCashCollected = insurancePosted.totalAmount + patientReceived.totalAmount;

  // Net collection rate: payments / charges for the day
  const dayCharges = newCreated.totalAmount || 1; // avoid division by zero
  const netCollectionRate = newCreated.totalAmount > 0
    ? Math.round((totalCashCollected / dayCharges) * 10000) / 100
    : 0;

  // ========== SECTION C: Patient Billing ==========

  // Statements generated today (created today with any status)
  const statementsGeneratedRows = await db
    .select({ cnt: count() })
    .from(patientStatements)
    .where(and(
      eq(patientStatements.practiceId, practiceId),
      gte(patientStatements.createdAt, dayStart),
      lt(patientStatements.createdAt, dayEnd),
    ));
  const statementsGenerated = Number(statementsGeneratedRows[0]?.cnt) || 0;

  // Statements sent today
  const statementsSentRows = await db
    .select({ cnt: count() })
    .from(patientStatements)
    .where(and(
      eq(patientStatements.practiceId, practiceId),
      gte(patientStatements.sentAt, dayStart),
      lt(patientStatements.sentAt, dayEnd),
    ));
  const statementsSent = Number(statementsSentRows[0]?.cnt) || 0;

  // Outstanding patient balances total
  const outstandingRows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${patientStatements.patientBalance}::numeric), 0)`,
    })
    .from(patientStatements)
    .where(and(
      eq(patientStatements.practiceId, practiceId),
      sql`${patientStatements.status} IN ('sent', 'overdue')`,
    ));
  const outstandingBalance = parseFloat(outstandingRows[0]?.total || '0');

  // Overdue statements (past due date)
  const overdueRows = await db
    .select({
      cnt: count(),
      total: sql<string>`COALESCE(SUM(${patientStatements.patientBalance}::numeric), 0)`,
    })
    .from(patientStatements)
    .where(and(
      eq(patientStatements.practiceId, practiceId),
      sql`${patientStatements.status} IN ('sent', 'overdue')`,
      lt(patientStatements.dueDate, dayStartStr),
    ));
  const overdueStatements = {
    count: Number(overdueRows[0]?.cnt) || 0,
    totalAmount: parseFloat(overdueRows[0]?.total || '0'),
  };

  // AR Aging buckets based on statement date
  const today = dayStartStr;
  const thirtyAgo = new Date(dayStart);
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const sixtyAgo = new Date(dayStart);
  sixtyAgo.setDate(sixtyAgo.getDate() - 60);
  const ninetyAgo = new Date(dayStart);
  ninetyAgo.setDate(ninetyAgo.getDate() - 90);

  const arAgingRows = await db
    .select({
      current: sql<string>`COALESCE(SUM(CASE WHEN ${patientStatements.statementDate} >= ${thirtyAgo.toISOString().split('T')[0]} THEN ${patientStatements.patientBalance}::numeric ELSE 0 END), 0)`,
      thirtyToSixty: sql<string>`COALESCE(SUM(CASE WHEN ${patientStatements.statementDate} >= ${sixtyAgo.toISOString().split('T')[0]} AND ${patientStatements.statementDate} < ${thirtyAgo.toISOString().split('T')[0]} THEN ${patientStatements.patientBalance}::numeric ELSE 0 END), 0)`,
      sixtyToNinety: sql<string>`COALESCE(SUM(CASE WHEN ${patientStatements.statementDate} >= ${ninetyAgo.toISOString().split('T')[0]} AND ${patientStatements.statementDate} < ${sixtyAgo.toISOString().split('T')[0]} THEN ${patientStatements.patientBalance}::numeric ELSE 0 END), 0)`,
      ninetyPlus: sql<string>`COALESCE(SUM(CASE WHEN ${patientStatements.statementDate} < ${ninetyAgo.toISOString().split('T')[0]} THEN ${patientStatements.patientBalance}::numeric ELSE 0 END), 0)`,
    })
    .from(patientStatements)
    .where(and(
      eq(patientStatements.practiceId, practiceId),
      sql`${patientStatements.status} IN ('sent', 'overdue')`,
    ));

  const arAging = {
    current: parseFloat(arAgingRows[0]?.current || '0'),
    thirtyToSixty: parseFloat(arAgingRows[0]?.thirtyToSixty || '0'),
    sixtyToNinety: parseFloat(arAgingRows[0]?.sixtyToNinety || '0'),
    ninetyPlus: parseFloat(arAgingRows[0]?.ninetyPlus || '0'),
  };

  // ========== SECTION D: Key Metrics (trailing 30 days) ==========

  // Average days in AR (from claims that got paid in last 30 days)
  const daysInARRows = await db
    .select({
      avgDays: sql<string>`COALESCE(AVG(EXTRACT(EPOCH FROM (${claims.paidAt} - ${claims.submittedAt})) / 86400), 0)`,
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      eq(claims.status, 'paid'),
      gte(claims.paidAt, thirtyDaysAgo),
      lte(claims.paidAt, dayEnd),
    ));
  const averageDaysInAR = Math.round(parseFloat(daysInARRows[0]?.avgDays || '0') * 10) / 10;

  // Collection rate (trailing 30 days): total paid / total billed
  const collectionRateRows = await db
    .select({
      totalBilled: sql<string>`COALESCE(SUM(${claims.totalAmount}::numeric), 0)`,
      totalPaid: sql<string>`COALESCE(SUM(${claims.paidAmount}::numeric), 0)`,
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      gte(claims.createdAt, thirtyDaysAgo),
      lte(claims.createdAt, dayEnd),
    ));
  const totalBilled30 = parseFloat(collectionRateRows[0]?.totalBilled || '0');
  const totalPaid30 = parseFloat(collectionRateRows[0]?.totalPaid || '0');
  const collectionRate30Day = totalBilled30 > 0
    ? Math.round((totalPaid30 / totalBilled30) * 10000) / 100
    : 0;

  // Denial rate (trailing 30 days)
  const denialRateRows = await db
    .select({
      totalClaims: count(),
      deniedClaims: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'denied')`,
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      gte(claims.createdAt, thirtyDaysAgo),
      lte(claims.createdAt, dayEnd),
    ));
  const totalClaims30 = Number(denialRateRows[0]?.totalClaims) || 0;
  const deniedClaims30 = Number(denialRateRows[0]?.deniedClaims) || 0;
  const denialRate30Day = totalClaims30 > 0
    ? Math.round((deniedClaims30 / totalClaims30) * 10000) / 100
    : 0;

  // Clean claim rate (trailing 30 days): claims accepted on first submission
  const cleanClaimRows = await db
    .select({
      totalSubmitted: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} IN ('submitted', 'paid', 'denied'))`,
      cleanClaims: sql<number>`COUNT(*) FILTER (WHERE ${claims.clearinghouseStatus} = 'accepted')`,
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      gte(claims.createdAt, thirtyDaysAgo),
      lte(claims.createdAt, dayEnd),
    ));
  const totalSubmitted30 = Number(cleanClaimRows[0]?.totalSubmitted) || 0;
  const cleanClaims30 = Number(cleanClaimRows[0]?.cleanClaims) || 0;
  const cleanClaimRate30Day = totalSubmitted30 > 0
    ? Math.round((cleanClaims30 / totalSubmitted30) * 10000) / 100
    : 0;

  // Front-desk wait time: avg minutes from check-in → session-start for
  // today's eligible appointments.
  const waitTimes = await storage.getWaitTimes(practiceId, dayStart, dayEnd);

  return {
    reportDate: dayStartStr,
    practiceName,
    claims: { newCreated, submitted, paid, denied, pending },
    payments: {
      insurancePosted,
      patientReceived,
      totalCashCollected,
      adjustments,
      netCollectionRate,
    },
    patientBilling: {
      statementsGenerated,
      statementsSent,
      outstandingBalance,
      overdueStatements,
      arAging,
    },
    keyMetrics: {
      averageDaysInAR,
      collectionRate30Day,
      denialRate30Day,
      cleanClaimRate30Day,
    },
    frontDesk: {
      avgWaitMinutes: waitTimes.summary.avgMinutes,
      maxWaitMinutes: waitTimes.summary.maxMinutes,
      appointments: waitTimes.summary.appointments,
    },
  };
}

/**
 * Generate HTML email content for the daily report.
 */
function generateEmailHtml(report: DailyReportData): string {
  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n: number) => n.toFixed(1) + '%';
  const appUrl = process.env.APP_URL || 'http://localhost:5000';

  const denialColor = report.keyMetrics.denialRate30Day > 10 ? '#dc2626' : '#16a34a';
  const collectionColor = report.keyMetrics.collectionRate30Day < 90 ? '#dc2626' : '#16a34a';
  const overdueColor = report.patientBilling.overdueStatements.count > 0 ? '#dc2626' : '#16a34a';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; margin: 0; padding: 20px;">
<div style="max-width: 640px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

  <!-- Header -->
  <div style="background: linear-gradient(135deg, #1e40af, #3b82f6); padding: 24px 32px; color: #fff;">
    <h1 style="margin: 0 0 4px 0; font-size: 22px;">Daily Billing Summary</h1>
    <p style="margin: 0; opacity: 0.9; font-size: 14px;">${report.practiceName} &mdash; ${report.reportDate}</p>
  </div>

  <!-- Top Summary -->
  <div style="background: #eff6ff; padding: 20px 32px; border-bottom: 1px solid #dbeafe;">
    <p style="margin: 0; font-size: 16px; color: #1e3a5f;">
      Today you collected <strong>${fmt(report.payments.insurancePosted.totalAmount)}</strong> from insurance
      and <strong>${fmt(report.payments.patientReceived.totalAmount)}</strong> from patients
      (total: <strong>${fmt(report.payments.totalCashCollected)}</strong>).
    </p>
  </div>

  <div style="padding: 24px 32px;">

    <!-- Section A: Claims Summary -->
    <h2 style="font-size: 16px; color: #1e40af; border-bottom: 2px solid #dbeafe; padding-bottom: 8px; margin-top: 0;">Claims Summary</h2>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 24px;">
      <tr><td style="padding: 6px 0; color: #374151;">New Claims Created</td><td style="text-align: right; font-weight: 600;">${report.claims.newCreated.count} (${fmt(report.claims.newCreated.totalAmount)})</td></tr>
      <tr style="background: #f9fafb;"><td style="padding: 6px 0; color: #374151;">Claims Submitted</td><td style="text-align: right; font-weight: 600;">${report.claims.submitted.count} (${fmt(report.claims.submitted.totalAmount)})</td></tr>
      <tr><td style="padding: 6px 0; color: #374151;">Claims Paid</td><td style="text-align: right; font-weight: 600; color: #16a34a;">${report.claims.paid.count} (${fmt(report.claims.paid.totalPaid)})</td></tr>
      <tr style="background: #f9fafb;"><td style="padding: 6px 0; color: #374151;">Claims Denied</td><td style="text-align: right; font-weight: 600; color: ${report.claims.denied.count > 0 ? '#dc2626' : '#374151'};">${report.claims.denied.count} (${fmt(report.claims.denied.totalAmount)})</td></tr>
      <tr><td style="padding: 6px 0; color: #374151;">Pending Claims</td><td style="text-align: right; font-weight: 600;">${report.claims.pending.count} (${fmt(report.claims.pending.totalOutstanding)})</td></tr>
    </table>

    <!-- Section B: Payment Activity -->
    <h2 style="font-size: 16px; color: #1e40af; border-bottom: 2px solid #dbeafe; padding-bottom: 8px;">Payment Activity</h2>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 24px;">
      <tr><td style="padding: 6px 0; color: #374151;">Insurance Payments</td><td style="text-align: right; font-weight: 600;">${report.payments.insurancePosted.count} (${fmt(report.payments.insurancePosted.totalAmount)})</td></tr>
      <tr style="background: #f9fafb;"><td style="padding: 6px 0; color: #374151;">Patient Payments</td><td style="text-align: right; font-weight: 600;">${report.payments.patientReceived.count} (${fmt(report.payments.patientReceived.totalAmount)})</td></tr>
      <tr><td style="padding: 6px 0; color: #374151;">Total Cash Collected</td><td style="text-align: right; font-weight: 600; color: #16a34a;">${fmt(report.payments.totalCashCollected)}</td></tr>
      <tr style="background: #f9fafb;"><td style="padding: 6px 0; color: #374151;">Adjustments/Write-offs</td><td style="text-align: right; font-weight: 600;">${fmt(report.payments.adjustments)}</td></tr>
      <tr><td style="padding: 6px 0; color: #374151;">Net Collection Rate</td><td style="text-align: right; font-weight: 600;">${pct(report.payments.netCollectionRate)}</td></tr>
    </table>

    <!-- Section C: Patient Billing -->
    <h2 style="font-size: 16px; color: #1e40af; border-bottom: 2px solid #dbeafe; padding-bottom: 8px;">Patient Billing</h2>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
      <tr><td style="padding: 6px 0; color: #374151;">Statements Generated</td><td style="text-align: right; font-weight: 600;">${report.patientBilling.statementsGenerated}</td></tr>
      <tr style="background: #f9fafb;"><td style="padding: 6px 0; color: #374151;">Statements Sent</td><td style="text-align: right; font-weight: 600;">${report.patientBilling.statementsSent}</td></tr>
      <tr><td style="padding: 6px 0; color: #374151;">Outstanding Balance</td><td style="text-align: right; font-weight: 600;">${fmt(report.patientBilling.outstandingBalance)}</td></tr>
      <tr style="background: #f9fafb;"><td style="padding: 6px 0; color: #374151;">Overdue Statements</td><td style="text-align: right; font-weight: 600; color: ${overdueColor};">${report.patientBilling.overdueStatements.count} (${fmt(report.patientBilling.overdueStatements.totalAmount)})</td></tr>
    </table>
    <p style="font-size: 13px; color: #6b7280; margin: 0 0 24px 0;">
      AR Aging: Current ${fmt(report.patientBilling.arAging.current)} |
      30-60 ${fmt(report.patientBilling.arAging.thirtyToSixty)} |
      60-90 ${fmt(report.patientBilling.arAging.sixtyToNinety)} |
      90+ ${fmt(report.patientBilling.arAging.ninetyPlus)}
    </p>

    <!-- Section D: Key Metrics -->
    <h2 style="font-size: 16px; color: #1e40af; border-bottom: 2px solid #dbeafe; padding-bottom: 8px;">Key Metrics (30-Day Trailing)</h2>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 24px;">
      <tr><td style="padding: 6px 0; color: #374151;">Avg Days in AR</td><td style="text-align: right; font-weight: 600;">${report.keyMetrics.averageDaysInAR} days</td></tr>
      <tr style="background: #f9fafb;"><td style="padding: 6px 0; color: #374151;">Collection Rate</td><td style="text-align: right; font-weight: 600; color: ${collectionColor};">${pct(report.keyMetrics.collectionRate30Day)}</td></tr>
      <tr><td style="padding: 6px 0; color: #374151;">Denial Rate</td><td style="text-align: right; font-weight: 600; color: ${denialColor};">${pct(report.keyMetrics.denialRate30Day)}</td></tr>
      <tr style="background: #f9fafb;"><td style="padding: 6px 0; color: #374151;">Clean Claim Rate</td><td style="text-align: right; font-weight: 600;">${pct(report.keyMetrics.cleanClaimRate30Day)}</td></tr>
    </table>

    <!-- Section E: Front Desk -->
    <h2 style="font-size: 16px; color: #1e40af; border-bottom: 2px solid #dbeafe; padding-bottom: 8px;">Front Desk</h2>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 24px;">
      <tr><td style="padding: 6px 0; color: #374151;">Avg Wait (check-in → session start)</td><td style="text-align: right; font-weight: 600;">${report.frontDesk.appointments > 0 ? `${report.frontDesk.avgWaitMinutes} min` : '—'}</td></tr>
      <tr style="background: #f9fafb;"><td style="padding: 6px 0; color: #374151;">Longest Wait Today</td><td style="text-align: right; font-weight: 600;">${report.frontDesk.appointments > 0 ? `${report.frontDesk.maxWaitMinutes} min` : '—'}</td></tr>
      <tr><td style="padding: 6px 0; color: #374151;">Appointments Measured</td><td style="text-align: right; font-weight: 600;">${report.frontDesk.appointments}</td></tr>
    </table>

    <div style="text-align: center; margin-top: 16px;">
      <a href="${appUrl}/daily-report" style="display: inline-block; background: #2563eb; color: #fff; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">View Full Report</a>
    </div>
  </div>

  <!-- Footer -->
  <div style="background: #f9fafb; padding: 16px 32px; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb;">
    TherapyBill AI &mdash; Daily Billing Summary &mdash; ${report.reportDate}
  </div>

</div>
</body>
</html>`;
}

/**
 * Generate plain text version of the daily report for email.
 */
function generateEmailText(report: DailyReportData): string {
  const fmt = (n: number) => '$' + n.toFixed(2);
  const pct = (n: number) => n.toFixed(1) + '%';

  return `Daily Billing Summary - ${report.practiceName} - ${report.reportDate}

Today you collected ${fmt(report.payments.insurancePosted.totalAmount)} from insurance and ${fmt(report.payments.patientReceived.totalAmount)} from patients (total: ${fmt(report.payments.totalCashCollected)}).

CLAIMS SUMMARY
- New Claims Created: ${report.claims.newCreated.count} (${fmt(report.claims.newCreated.totalAmount)})
- Claims Submitted: ${report.claims.submitted.count} (${fmt(report.claims.submitted.totalAmount)})
- Claims Paid: ${report.claims.paid.count} (${fmt(report.claims.paid.totalPaid)})
- Claims Denied: ${report.claims.denied.count} (${fmt(report.claims.denied.totalAmount)})
- Pending Claims: ${report.claims.pending.count} (${fmt(report.claims.pending.totalOutstanding)})

PAYMENT ACTIVITY
- Insurance Payments: ${report.payments.insurancePosted.count} (${fmt(report.payments.insurancePosted.totalAmount)})
- Patient Payments: ${report.payments.patientReceived.count} (${fmt(report.payments.patientReceived.totalAmount)})
- Total Cash Collected: ${fmt(report.payments.totalCashCollected)}
- Adjustments/Write-offs: ${fmt(report.payments.adjustments)}
- Net Collection Rate: ${pct(report.payments.netCollectionRate)}

PATIENT BILLING
- Statements Generated: ${report.patientBilling.statementsGenerated}
- Statements Sent: ${report.patientBilling.statementsSent}
- Outstanding Balance: ${fmt(report.patientBilling.outstandingBalance)}
- Overdue Statements: ${report.patientBilling.overdueStatements.count} (${fmt(report.patientBilling.overdueStatements.totalAmount)})
- AR Aging: Current ${fmt(report.patientBilling.arAging.current)} | 30-60 ${fmt(report.patientBilling.arAging.thirtyToSixty)} | 60-90 ${fmt(report.patientBilling.arAging.sixtyToNinety)} | 90+ ${fmt(report.patientBilling.arAging.ninetyPlus)}

KEY METRICS (30-Day Trailing)
- Avg Days in AR: ${report.keyMetrics.averageDaysInAR} days
- Collection Rate: ${pct(report.keyMetrics.collectionRate30Day)}
- Denial Rate: ${pct(report.keyMetrics.denialRate30Day)}
- Clean Claim Rate: ${pct(report.keyMetrics.cleanClaimRate30Day)}

FRONT DESK
- Avg Wait (check-in → session start): ${report.frontDesk.appointments > 0 ? `${report.frontDesk.avgWaitMinutes} min` : '—'}
- Longest Wait Today: ${report.frontDesk.appointments > 0 ? `${report.frontDesk.maxWaitMinutes} min` : '—'}
- Appointments Measured: ${report.frontDesk.appointments}
`;
}

// ==================== ROUTES ====================

// GET /api/daily-report — Get today's report (or specify date with ?date=YYYY-MM-DD)
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const dateStr = req.query.date as string | undefined;
    const reportDate = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();

    if (isNaN(reportDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const cacheKey = `practice:${practiceId}:daily-report:${reportDate.toISOString().split('T')[0]}`;
    const cached = await cache.get<DailyReportData>(cacheKey);
    if (cached !== null) {
      return res.json(cached);
    }

    const report = await buildDailyReport(practiceId, reportDate);
    await cache.set(cacheKey, report, CacheTTL.ANALYTICS);
    res.json(report);
  } catch (error) {
    logger.error('Error fetching daily report', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch daily report' });
  }
});

// GET /api/daily-report/send — Trigger sending the report email manually
router.get('/send', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const dateStr = req.query.date as string | undefined;
    const reportDate = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();

    if (isNaN(reportDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const report = await buildDailyReport(practiceId, reportDate);

    // Gather recipients: subscribers + admin emails from the practice
    const subscribers = reportSubscribers.get(practiceId) || new Set();
    const admins = await storage.getAdminsByPractice(practiceId);
    const adminEmails = admins.map((a: any) => a.email).filter(Boolean);
    const recipientSet = new Set<string>(adminEmails);
    subscribers.forEach((s: string) => recipientSet.add(s));
    const allRecipients = Array.from(recipientSet);

    if (allRecipients.length === 0) {
      return res.json({
        success: false,
        message: 'No recipients configured. Subscribe at least one email address or ensure admin accounts have emails.',
      });
    }

    const html = generateEmailHtml(report);
    const text = generateEmailText(report);
    const results: Array<{ email: string; success: boolean; error?: string }> = [];

    for (const email of allRecipients) {
      const result = await sendEmail({
        to: email,
        subject: `Daily Billing Summary - ${report.practiceName} - ${report.reportDate}`,
        html,
        text,
        fromName: 'TherapyBill AI Reports',
      });
      results.push({ email, ...result });
    }

    logger.info('Daily report email send triggered', {
      practiceId,
      recipientCount: allRecipients.length,
      successCount: results.filter(r => r.success).length,
    });

    res.json({ success: true, results });
  } catch (error) {
    logger.error('Error sending daily report', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to send daily report' });
  }
});

// POST /api/daily-report/subscribe — Subscribe/unsubscribe email for daily reports
router.post('/subscribe', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { email, subscribe } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ message: 'Email is required' });
    }

    if (!reportSubscribers.has(practiceId)) {
      reportSubscribers.set(practiceId, new Set());
    }

    const subs = reportSubscribers.get(practiceId)!;

    if (subscribe === false) {
      subs.delete(email);
      logger.info('Unsubscribed from daily report', { practiceId, email: '[REDACTED]' });
      return res.json({ subscribed: false, email });
    }

    subs.add(email);
    logger.info('Subscribed to daily report', { practiceId, email: '[REDACTED]' });
    res.json({ subscribed: true, email });
  } catch (error) {
    logger.error('Error managing daily report subscription', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to manage subscription' });
  }
});

// Export for use by the scheduler
export { buildDailyReport, generateEmailHtml, generateEmailText, reportSubscribers };

export default router;
