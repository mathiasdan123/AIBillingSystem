/**
 * Canned Reports - Phase 2
 *
 * Named, Prompt-EMR-style reports each with a single dedicated endpoint.
 * All endpoints scope by the authenticated user's practiceId.
 *
 * - GET /api/reports/days-to-note-completion
 * - GET /api/reports/cancellations
 * - GET /api/reports/timely-filing
 * - GET /api/reports/adjustments
 * - GET /api/reports/intake-completion
 * - GET /api/reports/referrals
 * - GET /api/reports/unverified-benefits
 */

import { Router } from 'express';
import { db } from '../db';
import { isAuthenticated } from '../replitAuth';
import {
  appointments,
  claims,
  insurances,
  patients,
  referrals,
  referralSources,
  soapNotes,
  treatmentSessions,
  users,
  eligibilityChecks,
} from '@shared/schema';
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import logger from '../services/logger';

const router = Router();

// Reuse the same practiceId-scoping pattern other routers use.
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requested = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
  if (userRole === 'admin') return requested || userPracticeId || 1;
  if (!userPracticeId) throw new Error('User not assigned to a practice. Contact administrator.');
  if (requested && requested !== userPracticeId) {
    logger.warn(`Practice access restricted: requested ${requested} but assigned to ${userPracticeId}`);
    return userPracticeId;
  }
  return requested || userPracticeId;
};

const parseRange = (req: any): { start: Date; end: Date } => {
  const end = req.query.end ? new Date(req.query.end as string) : new Date();
  const start = req.query.start
    ? new Date(req.query.start as string)
    : new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
  return { start, end };
};

// ============================================================
// Days to Note Completion
// ============================================================
// For each completed treatment session, time from session date to the
// associated SOAP note's therapistSignedAt. Aggregated per therapist.
router.get('/days-to-note-completion', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { start, end } = parseRange(req);

    const rows = await db
      .select({
        therapistId: treatmentSessions.therapistId,
        therapistFirstName: users.firstName,
        therapistLastName: users.lastName,
        avgDays: sql<number>`AVG(EXTRACT(EPOCH FROM (${soapNotes.therapistSignedAt} - ${treatmentSessions.sessionDate}::timestamp)) / 86400.0)`,
        sessionCount: sql<number>`COUNT(*)::int`,
        signedWithin24h: sql<number>`SUM(CASE WHEN ${soapNotes.therapistSignedAt} <= ${treatmentSessions.sessionDate}::timestamp + INTERVAL '24 hours' THEN 1 ELSE 0 END)::int`,
        signedWithin7d: sql<number>`SUM(CASE WHEN ${soapNotes.therapistSignedAt} <= ${treatmentSessions.sessionDate}::timestamp + INTERVAL '7 days' THEN 1 ELSE 0 END)::int`,
        unsigned: sql<number>`SUM(CASE WHEN ${soapNotes.therapistSignedAt} IS NULL THEN 1 ELSE 0 END)::int`,
      })
      .from(treatmentSessions)
      .leftJoin(soapNotes, eq(soapNotes.sessionId, treatmentSessions.id))
      .leftJoin(users, eq(users.id, treatmentSessions.therapistId))
      .where(
        and(
          eq(treatmentSessions.practiceId, practiceId),
          gte(treatmentSessions.sessionDate, start.toISOString().split('T')[0]),
          lte(treatmentSessions.sessionDate, end.toISOString().split('T')[0]),
        ),
      )
      .groupBy(treatmentSessions.therapistId, users.firstName, users.lastName);

    res.json({ start, end, rows });
  } catch (error) {
    logger.error('Days to note completion failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load report' });
  }
});

// ============================================================
// Cancellations Report
// ============================================================
router.get('/cancellations', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { start, end } = parseRange(req);

    const byReason = await db
      .select({
        reason: appointments.cancellationReason,
        cancelledBy: appointments.cancelledBy,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.practiceId, practiceId),
          or(eq(appointments.status, 'cancelled'), eq(appointments.status, 'no_show')),
          gte(appointments.startTime, start),
          lte(appointments.startTime, end),
        ),
      )
      .groupBy(appointments.cancellationReason, appointments.cancelledBy);

    const byTherapist = await db
      .select({
        therapistId: appointments.therapistId,
        therapistFirstName: users.firstName,
        therapistLastName: users.lastName,
        cancelled: sql<number>`SUM(CASE WHEN ${appointments.status} = 'cancelled' THEN 1 ELSE 0 END)::int`,
        noShow: sql<number>`SUM(CASE WHEN ${appointments.status} = 'no_show' THEN 1 ELSE 0 END)::int`,
        total: sql<number>`COUNT(*)::int`,
      })
      .from(appointments)
      .leftJoin(users, eq(users.id, appointments.therapistId))
      .where(
        and(
          eq(appointments.practiceId, practiceId),
          gte(appointments.startTime, start),
          lte(appointments.startTime, end),
        ),
      )
      .groupBy(appointments.therapistId, users.firstName, users.lastName);

    res.json({ start, end, byReason, byTherapist });
  } catch (error) {
    logger.error('Cancellations report failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load report' });
  }
});

// ============================================================
// Timely Filing
// ============================================================
// Open claims (not yet paid/denied) whose date-of-service is approaching or
// past the typical 90-day filing deadline. Practices override per-payer
// in payer_contracts; defaulting to 90 days here for a usable single view.
// Date of service lives on treatmentSessions (claims.sessionId join).
router.get('/timely-filing', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filingDays = parseInt((req.query.filingDays as string) || '90');

    const rows = await db
      .select({
        id: claims.id,
        claimNumber: claims.claimNumber,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        dateOfService: treatmentSessions.sessionDate,
        status: claims.status,
        payerName: insurances.name,
        totalAmount: claims.totalAmount,
        daysSinceDOS: sql<number>`(CURRENT_DATE - ${treatmentSessions.sessionDate})::int`,
      })
      .from(claims)
      .leftJoin(patients, eq(patients.id, claims.patientId))
      .leftJoin(treatmentSessions, eq(treatmentSessions.id, claims.sessionId))
      .leftJoin(insurances, eq(insurances.id, claims.insuranceId))
      .where(
        and(
          eq(claims.practiceId, practiceId),
          isNotNull(treatmentSessions.sessionDate),
          // Only un-finalized claims are at risk
          sql`${claims.status} NOT IN ('paid', 'denied', 'voided')`,
        ),
      )
      .orderBy(asc(treatmentSessions.sessionDate))
      .limit(500);

    const buckets = {
      pastDue: rows.filter((r: typeof rows[number]) => Number(r.daysSinceDOS) > filingDays),
      atRisk: rows.filter((r: typeof rows[number]) => Number(r.daysSinceDOS) > filingDays - 14 && Number(r.daysSinceDOS) <= filingDays),
      safe: rows.filter((r: typeof rows[number]) => Number(r.daysSinceDOS) <= filingDays - 14),
    };

    res.json({
      filingDays,
      totals: { pastDue: buckets.pastDue.length, atRisk: buckets.atRisk.length, safe: buckets.safe.length },
      rows,
    });
  } catch (error) {
    logger.error('Timely filing report failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load report' });
  }
});

// ============================================================
// Adjustments Report
// ============================================================
// Adjustments live on the claims.primaryAdjustmentAmount column (primary
// payer write-offs); aggregated by month-of-service and payer.
router.get('/adjustments', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { start, end } = parseRange(req);

    const rows = await db
      .select({
        month: sql<string>`TO_CHAR(${treatmentSessions.sessionDate}, 'YYYY-MM')`,
        payerName: insurances.name,
        primaryAdjustments: sql<string>`COALESCE(SUM(COALESCE(${claims.primaryAdjustmentAmount}::numeric, 0)), 0)`,
        claimCount: sql<number>`COUNT(*)::int`,
      })
      .from(claims)
      .leftJoin(treatmentSessions, eq(treatmentSessions.id, claims.sessionId))
      .leftJoin(insurances, eq(insurances.id, claims.insuranceId))
      .where(
        and(
          eq(claims.practiceId, practiceId),
          gte(treatmentSessions.sessionDate, start.toISOString().split('T')[0]),
          lte(treatmentSessions.sessionDate, end.toISOString().split('T')[0]),
          sql`COALESCE(${claims.primaryAdjustmentAmount}::numeric, 0) > 0`,
        ),
      )
      .groupBy(sql`TO_CHAR(${treatmentSessions.sessionDate}, 'YYYY-MM')`, insurances.name)
      .orderBy(desc(sql`TO_CHAR(${treatmentSessions.sessionDate}, 'YYYY-MM')`));

    res.json({ start, end, rows });
  } catch (error) {
    logger.error('Adjustments report failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load report' });
  }
});

// ============================================================
// Intake Completion
// ============================================================
router.get('/intake-completion', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { start, end } = parseRange(req);

    const totalsRow = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        completed: sql<number>`SUM(CASE WHEN ${patients.intakeCompletedAt} IS NOT NULL THEN 1 ELSE 0 END)::int`,
        avgHoursToComplete: sql<number>`AVG(CASE WHEN ${patients.intakeCompletedAt} IS NOT NULL THEN EXTRACT(EPOCH FROM (${patients.intakeCompletedAt} - ${patients.createdAt})) / 3600.0 ELSE NULL END)`,
      })
      .from(patients)
      .where(
        and(
          eq(patients.practiceId, practiceId),
          gte(patients.createdAt, start),
          lte(patients.createdAt, end),
        ),
      );

    const totals = totalsRow[0] ?? { total: 0, completed: 0, avgHoursToComplete: 0 };
    const pending = await db
      .select({
        id: patients.id,
        firstName: patients.firstName,
        lastName: patients.lastName,
        email: patients.email,
        phone: patients.phone,
        createdAt: patients.createdAt,
      })
      .from(patients)
      .where(
        and(
          eq(patients.practiceId, practiceId),
          isNull(patients.intakeCompletedAt),
          gte(patients.createdAt, start),
          lte(patients.createdAt, end),
        ),
      )
      .orderBy(asc(patients.createdAt))
      .limit(100);

    res.json({ start, end, totals, pending });
  } catch (error) {
    logger.error('Intake completion report failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load report' });
  }
});

// ============================================================
// Referrals by Month
// ============================================================
router.get('/referrals', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { start, end } = parseRange(req);

    const byMonth = await db
      .select({
        month: sql<string>`TO_CHAR(${referrals.referralDate}, 'YYYY-MM')`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(referrals)
      .where(
        and(
          eq(referrals.practiceId, practiceId),
          gte(referrals.referralDate, start.toISOString().split('T')[0]),
          lte(referrals.referralDate, end.toISOString().split('T')[0]),
        ),
      )
      .groupBy(sql`TO_CHAR(${referrals.referralDate}, 'YYYY-MM')`)
      .orderBy(desc(sql`TO_CHAR(${referrals.referralDate}, 'YYYY-MM')`));

    const bySource = await db
      .select({
        sourceName: sql<string>`COALESCE(${referralSources.name}, ${referrals.externalProviderName}, 'Unknown')`,
        sourceType: referralSources.type,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(referrals)
      .leftJoin(referralSources, eq(referralSources.id, referrals.referralSourceId))
      .where(
        and(
          eq(referrals.practiceId, practiceId),
          gte(referrals.referralDate, start.toISOString().split('T')[0]),
          lte(referrals.referralDate, end.toISOString().split('T')[0]),
        ),
      )
      .groupBy(referralSources.name, referrals.externalProviderName, referralSources.type)
      .orderBy(desc(sql<number>`COUNT(*)::int`));

    res.json({ start, end, byMonth, bySource });
  } catch (error) {
    logger.error('Referrals report failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load report' });
  }
});

// ============================================================
// Unverified Benefits
// ============================================================
// Active patients with no eligibility check in the last N days (default 90).
router.get('/unverified-benefits', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const staleDays = parseInt((req.query.staleDays as string) || '90');
    const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

    // Most recent check per patient.
    const lastCheckSub = db
      .select({
        patientId: eligibilityChecks.patientId,
        lastChecked: sql<Date>`MAX(${eligibilityChecks.checkDate})`.as('last_checked'),
      })
      .from(eligibilityChecks)
      .groupBy(eligibilityChecks.patientId)
      .as('last_check');

    const rows = await db
      .select({
        id: patients.id,
        firstName: patients.firstName,
        lastName: patients.lastName,
        email: patients.email,
        phone: patients.phone,
        insuranceProvider: patients.insuranceProvider,
        lastChecked: lastCheckSub.lastChecked,
      })
      .from(patients)
      .leftJoin(lastCheckSub, eq(lastCheckSub.patientId, patients.id))
      .where(
        and(
          eq(patients.practiceId, practiceId),
          isNotNull(patients.insuranceProvider),
          or(isNull(lastCheckSub.lastChecked), lte(lastCheckSub.lastChecked, cutoff)),
        ),
      )
      .orderBy(asc(patients.lastName), asc(patients.firstName))
      .limit(500);

    res.json({ staleDays, count: rows.length, rows });
  } catch (error) {
    logger.error('Unverified benefits report failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load report' });
  }
});

export default router;
