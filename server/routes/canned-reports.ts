/**
 * Canned Reports - Phase 2 + Phase 3
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
 * - GET /api/reports/capacity-utilization
 * - GET /api/reports/patient-credits
 * - GET /api/reports/operations
 */

import { Router } from 'express';
import { db } from '../db';
import { isAuthenticated } from '../replitAuth';
import {
  appointments,
  claims,
  insurances,
  patients,
  payments,
  paymentPostings,
  referrals,
  referralSources,
  soapNotes,
  therapistAvailability,
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

// ============================================================
// Capacity Utilization
// ============================================================
// Booked-vs-available hours per therapist over the requested range.
// Available hours = sum of weekly availability windows, multiplied by
// the number of times each day-of-week occurs in the range.
// Booked hours = sum of appointment durations (scheduled or completed),
// excluding cancelled/no_show.
router.get('/capacity-utilization', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { start, end } = parseRange(req);

    // Available hours per therapist, by counting day-of-week occurrences in range.
    const availabilityRows = await db
      .select({
        therapistId: therapistAvailability.therapistId,
        dayOfWeek: therapistAvailability.dayOfWeek,
        startTime: therapistAvailability.startTime,
        endTime: therapistAvailability.endTime,
      })
      .from(therapistAvailability)
      .where(
        and(
          eq(therapistAvailability.practiceId, practiceId),
          eq(therapistAvailability.isAvailable, true),
        ),
      );

    // For each (therapist, dow) row, count how many of that DOW occur in range.
    const dayOccurrences = (dow: number): number => {
      let count = 0;
      const cursor = new Date(start);
      cursor.setHours(0, 0, 0, 0);
      const last = new Date(end);
      while (cursor <= last) {
        if (cursor.getDay() === dow) count++;
        cursor.setDate(cursor.getDate() + 1);
      }
      return count;
    };

    const hoursBetween = (a: string, b: string): number => {
      const [ah, am] = a.split(':').map(Number);
      const [bh, bm] = b.split(':').map(Number);
      return Math.max(0, bh * 60 + bm - (ah * 60 + am)) / 60;
    };

    const availableByTherapist = new Map<string, number>();
    for (const row of availabilityRows) {
      if (!row.therapistId) continue;
      const hours = hoursBetween(row.startTime, row.endTime) * dayOccurrences(row.dayOfWeek);
      availableByTherapist.set(row.therapistId, (availableByTherapist.get(row.therapistId) || 0) + hours);
    }

    // Booked hours from appointments in range, excluding cancelled / no_show.
    const bookedRows = await db
      .select({
        therapistId: appointments.therapistId,
        therapistFirstName: users.firstName,
        therapistLastName: users.lastName,
        bookedHours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${appointments.endTime} - ${appointments.startTime})) / 3600.0), 0)`,
        appointmentCount: sql<number>`COUNT(*)::int`,
      })
      .from(appointments)
      .leftJoin(users, eq(users.id, appointments.therapistId))
      .where(
        and(
          eq(appointments.practiceId, practiceId),
          gte(appointments.startTime, start),
          lte(appointments.startTime, end),
          sql`${appointments.status} NOT IN ('cancelled', 'no_show')`,
        ),
      )
      .groupBy(appointments.therapistId, users.firstName, users.lastName);

    type UtilRow = {
      therapistId: string | null;
      therapistFirstName: string | null;
      therapistLastName: string | null;
      availableHours: number;
      bookedHours: number;
      appointmentCount: number;
      utilization: number | null;
    };

    const rows: UtilRow[] = bookedRows.map((r: typeof bookedRows[number]) => {
      const available = r.therapistId ? availableByTherapist.get(r.therapistId) ?? 0 : 0;
      const booked = Number(r.bookedHours);
      const utilization = available > 0 ? booked / available : null;
      return {
        therapistId: r.therapistId,
        therapistFirstName: r.therapistFirstName,
        therapistLastName: r.therapistLastName,
        availableHours: available,
        bookedHours: booked,
        appointmentCount: r.appointmentCount,
        utilization,
      };
    });

    // Also include therapists with availability but no bookings.
    for (const entry of Array.from(availableByTherapist.entries())) {
      const [therapistId, available] = entry;
      if (rows.some((r) => r.therapistId === therapistId)) continue;
      const u = await db
        .select({ firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, therapistId))
        .limit(1);
      rows.push({
        therapistId,
        therapistFirstName: u[0]?.firstName ?? null,
        therapistLastName: u[0]?.lastName ?? null,
        availableHours: available,
        bookedHours: 0,
        appointmentCount: 0,
        utilization: available > 0 ? 0 : null,
      });
    }

    rows.sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1));

    res.json({ start, end, rows });
  } catch (error) {
    logger.error('Capacity utilization report failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load report' });
  }
});

// ============================================================
// Patient Credits
// ============================================================
// Patients whose patient-method payments exceed their patient
// responsibility on file. Credit = sum(patient payments) − sum(patient
// responsibility from payment_postings + statement balances). Only
// patients with a positive credit are returned.
router.get('/patient-credits', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);

    // Sum of patient-method payments per patient.
    const paidRows = await db
      .select({
        patientId: payments.patientId,
        paidByPatient: sql<string>`COALESCE(SUM(${payments.amount}::numeric), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.practiceId, practiceId),
          eq(payments.paymentMethod, 'patient'),
          eq(payments.status, 'completed'),
          isNotNull(payments.patientId),
        ),
      )
      .groupBy(payments.patientId);

    // Sum of patient responsibility per patient (via payment_postings → claims).
    const owedRows = await db
      .select({
        patientId: claims.patientId,
        patientResponsibility: sql<string>`COALESCE(SUM(COALESCE(${paymentPostings.patientResponsibility}::numeric, 0)), 0)`,
      })
      .from(paymentPostings)
      .innerJoin(claims, eq(claims.id, paymentPostings.claimId))
      .where(
        and(
          eq(paymentPostings.practiceId, practiceId),
          eq(paymentPostings.reversed, false),
        ),
      )
      .groupBy(claims.patientId);

    type CreditRow = {
      patientId: number;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      paidByPatient: number;
      patientResponsibility: number;
      credit: number;
    };
    const paidMap = new Map<number, number>();
    for (const r of paidRows) {
      if (r.patientId != null) paidMap.set(r.patientId, Number(r.paidByPatient));
    }
    const owedMap = new Map<number, number>();
    for (const r of owedRows) {
      if (r.patientId != null) owedMap.set(r.patientId, Number(r.patientResponsibility));
    }
    const patientIds = new Set<number>();
    for (const id of Array.from(paidMap.keys())) patientIds.add(id);
    for (const id of Array.from(owedMap.keys())) patientIds.add(id);

    const credits: CreditRow[] = [];
    for (const patientId of Array.from(patientIds)) {
      const paid = paidMap.get(patientId) ?? 0;
      const owed = owedMap.get(patientId) ?? 0;
      const credit = paid - owed;
      if (credit > 0.005) {
        credits.push({ patientId, firstName: null, lastName: null, email: null, paidByPatient: paid, patientResponsibility: owed, credit });
      }
    }

    if (credits.length > 0) {
      const ids = credits.map((c) => c.patientId);
      const patientRows = await db
        .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName, email: patients.email })
        .from(patients)
        .where(and(eq(patients.practiceId, practiceId), sql`${patients.id} = ANY(${ids})`));
      const pMap = new Map<number, typeof patientRows[number]>(patientRows.map((p: typeof patientRows[number]) => [p.id, p]));
      for (const c of credits) {
        const p = pMap.get(c.patientId);
        if (p) {
          c.firstName = p.firstName;
          c.lastName = p.lastName;
          c.email = p.email;
        }
      }
    }

    credits.sort((a, b) => b.credit - a.credit);
    const totalCredit = credits.reduce((s, c) => s + c.credit, 0);

    res.json({ count: credits.length, totalCredit, rows: credits });
  } catch (error) {
    logger.error('Patient credits report failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load report' });
  }
});

// ============================================================
// Operations Report
// ============================================================
// Practice-wide rollup over the requested range: visits, cancellations,
// no-shows, new patients, completed notes, claims submitted, payments
// collected. One row per month for trend; plus a totals block.
router.get('/operations', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { start, end } = parseRange(req);

    const apptRows = await db
      .select({
        month: sql<string>`TO_CHAR(${appointments.startTime}, 'YYYY-MM')`,
        scheduled: sql<number>`SUM(CASE WHEN ${appointments.status} IN ('scheduled', 'completed') THEN 1 ELSE 0 END)::int`,
        completed: sql<number>`SUM(CASE WHEN ${appointments.status} = 'completed' THEN 1 ELSE 0 END)::int`,
        cancelled: sql<number>`SUM(CASE WHEN ${appointments.status} = 'cancelled' THEN 1 ELSE 0 END)::int`,
        noShow: sql<number>`SUM(CASE WHEN ${appointments.status} = 'no_show' THEN 1 ELSE 0 END)::int`,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.practiceId, practiceId),
          gte(appointments.startTime, start),
          lte(appointments.startTime, end),
        ),
      )
      .groupBy(sql`TO_CHAR(${appointments.startTime}, 'YYYY-MM')`);

    const patientRows = await db
      .select({
        month: sql<string>`TO_CHAR(${patients.createdAt}, 'YYYY-MM')`,
        newPatients: sql<number>`COUNT(*)::int`,
      })
      .from(patients)
      .where(
        and(
          eq(patients.practiceId, practiceId),
          gte(patients.createdAt, start),
          lte(patients.createdAt, end),
        ),
      )
      .groupBy(sql`TO_CHAR(${patients.createdAt}, 'YYYY-MM')`);

    const noteRows = await db
      .select({
        month: sql<string>`TO_CHAR(${soapNotes.therapistSignedAt}, 'YYYY-MM')`,
        notesSigned: sql<number>`COUNT(*)::int`,
      })
      .from(soapNotes)
      .innerJoin(treatmentSessions, eq(treatmentSessions.id, soapNotes.sessionId))
      .where(
        and(
          eq(treatmentSessions.practiceId, practiceId),
          isNotNull(soapNotes.therapistSignedAt),
          gte(soapNotes.therapistSignedAt, start),
          lte(soapNotes.therapistSignedAt, end),
        ),
      )
      .groupBy(sql`TO_CHAR(${soapNotes.therapistSignedAt}, 'YYYY-MM')`);

    const claimRows = await db
      .select({
        month: sql<string>`TO_CHAR(${claims.submittedAt}, 'YYYY-MM')`,
        claimsSubmitted: sql<number>`COUNT(*)::int`,
      })
      .from(claims)
      .where(
        and(
          eq(claims.practiceId, practiceId),
          isNotNull(claims.submittedAt),
          gte(claims.submittedAt, start),
          lte(claims.submittedAt, end),
        ),
      )
      .groupBy(sql`TO_CHAR(${claims.submittedAt}, 'YYYY-MM')`);

    const paymentRows = await db
      .select({
        month: sql<string>`TO_CHAR(${payments.paymentDate}, 'YYYY-MM')`,
        paymentsCollected: sql<string>`COALESCE(SUM(${payments.amount}::numeric), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.practiceId, practiceId),
          eq(payments.status, 'completed'),
          gte(payments.paymentDate, start.toISOString().split('T')[0]),
          lte(payments.paymentDate, end.toISOString().split('T')[0]),
        ),
      )
      .groupBy(sql`TO_CHAR(${payments.paymentDate}, 'YYYY-MM')`);

    type Row = {
      month: string;
      scheduled: number;
      completed: number;
      cancelled: number;
      noShow: number;
      newPatients: number;
      notesSigned: number;
      claimsSubmitted: number;
      paymentsCollected: number;
    };
    const byMonth = new Map<string, Row>();
    const ensure = (m: string): Row => {
      let r = byMonth.get(m);
      if (!r) {
        r = { month: m, scheduled: 0, completed: 0, cancelled: 0, noShow: 0, newPatients: 0, notesSigned: 0, claimsSubmitted: 0, paymentsCollected: 0 };
        byMonth.set(m, r);
      }
      return r;
    };
    for (const r of apptRows) {
      const m = ensure(r.month);
      m.scheduled = r.scheduled; m.completed = r.completed; m.cancelled = r.cancelled; m.noShow = r.noShow;
    }
    for (const r of patientRows) ensure(r.month).newPatients = r.newPatients;
    for (const r of noteRows) ensure(r.month).notesSigned = r.notesSigned;
    for (const r of claimRows) ensure(r.month).claimsSubmitted = r.claimsSubmitted;
    for (const r of paymentRows) ensure(r.month).paymentsCollected = Number(r.paymentsCollected);

    const rows = Array.from(byMonth.values()).sort((a, b) => b.month.localeCompare(a.month));
    const totals = rows.reduce(
      (t, r) => ({
        scheduled: t.scheduled + r.scheduled,
        completed: t.completed + r.completed,
        cancelled: t.cancelled + r.cancelled,
        noShow: t.noShow + r.noShow,
        newPatients: t.newPatients + r.newPatients,
        notesSigned: t.notesSigned + r.notesSigned,
        claimsSubmitted: t.claimsSubmitted + r.claimsSubmitted,
        paymentsCollected: t.paymentsCollected + r.paymentsCollected,
      }),
      { scheduled: 0, completed: 0, cancelled: 0, noShow: 0, newPatients: 0, notesSigned: 0, claimsSubmitted: 0, paymentsCollected: 0 },
    );

    res.json({ start, end, totals, rows });
  } catch (error) {
    logger.error('Operations report failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load report' });
  }
});

export default router;
