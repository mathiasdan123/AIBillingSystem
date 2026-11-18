/**
 * Isolated demo practice (2026-07-06).
 *
 * The public "Try Free Demo" login used to grab the first practice in the DB —
 * which in production is a REAL practice — and hand an anonymous visitor an
 * admin session on it (see the security fixes in commit 9100bd9, which disabled
 * that path in prod). This module provisions a dedicated, fully isolated demo
 * practice so the demo can run in production without ever touching real data.
 *
 * Isolation model:
 *   - `practices.isDemo = true` marks the sandbox. It is the ONLY practice the
 *     demo-login endpoints are allowed to land on, and external actions
 *     (submit_claim etc.) refuse demo practices.
 *   - Its seeded rows are `isDemo = false` on purpose: analytics are always
 *     scoped by practiceId, so this practice's data can never appear in a real
 *     practice's dashboard — and keeping the rows non-demo means the demo
 *     practice's OWN dashboard shows realistic numbers (row-level isDemo would
 *     be filtered out of every analytics query, leaving the demo empty).
 *     This is an invariant, not a default: no row inside a demo practice may
 *     carry isDemo=true. Blanche's demo-tagging tools refuse to run here (see
 *     ai-assistant.ts), and repairDemoRowFlags() below clears any that slipped
 *     through before that guard existed.
 *
 * ensureDemoPractice() is idempotent: it creates the practice + a representative
 * dataset once, then returns the existing one on every later call.
 */

import { storage } from '../storage';
import { getPool } from '../db';
import logger from './logger';
import { getBusinessTimeZone, zonedAddDays, zonedDateString, zonedInstant } from '../utils/timezone';
import { zonedTimeString } from '../utils/dateOnly';
import type { Practice } from '@shared/schema';

// Advisory-lock key that serializes concurrent ensureDemoPractice() calls, so
// two visitors clicking "Try Free Demo" at the same moment on a fresh DB can't
// both create/seed (the unique npi already blocks a duplicate practice, but the
// seed-if-empty check could otherwise double-insert patients/appointments).
const DEMO_LOCK_KEY = 918273645;

export const DEMO_PRACTICE_NAME = 'Bright Steps Pediatric Therapy (Demo)';
// Clearly-fake placeholder NPI. The demo practice never bills for real, and
// submit_claim refuses demo practices, so this is never sent to a payer.
const DEMO_NPI = '0000000001';

/**
 * A day at a fixed PRACTICE wall-clock time, offset from today.
 *
 * Built in the business timezone (America/New_York unless TIMEZONE is set),
 * not the process zone: on ECS the process runs in UTC, so the previous
 * `setHours(9)` seeded "9:00 AM" appointments at 09:00Z = 4:00 AM Eastern.
 * They only LOOKED right because the calendar grid was rendering UTC hours
 * (fixed 2026-11-18); once the grid rendered local time the demo day would
 * have started at 4 AM. Same helper the booking route uses to store a
 * patient's requested slot.
 */
function dayAt(offsetDays: number, hour = 10, minute = 0): Date {
  const tz = getBusinessTimeZone();
  const day = zonedDateString(zonedAddDays(new Date(), offsetDays, tz), tz);
  return zonedInstant(day, `${hour}:${minute}`, tz);
}
/** YYYY-MM-DD (practice calendar day) offset from today. */
function isoDate(offsetDays: number): string {
  const tz = getBusinessTimeZone();
  return zonedDateString(zonedAddDays(new Date(), offsetDays, tz), tz);
}

/**
 * Find or create the isolated demo practice, seeding a representative dataset
 * the first time. Safe to call on every demo-login.
 */

/**
 * Demo charges read as round numbers.
 *
 * The platform catalog prices treatment codes at $289.00, which is a real
 * figure for a real practice but looks arbitrary in a sandbox a prospect is
 * clicking through. In the DEMO practice only, those become $100.00.
 *
 * Deliberately scoped to rows still at the catalog default: a rate someone
 * edited inside the demo is theirs to keep, and evaluation codes keep their
 * own pricing. Runs on every ensureDemoPractice call so the existing demo
 * practice in production picks it up, and is a no-op once applied.
 */
const DEMO_DEFAULT_TREATMENT_RATE = '100.00';
const CATALOG_TREATMENT_RATE = '289.00';

/**
 * Repair row-level demo flags inside the demo practice.
 *
 * The isolation model (see module header) is practice-level: `practices.isDemo`
 * marks the sandbox, and its rows stay `isDemo = false` so the demo practice's
 * own dashboard has data. Every analytics aggregate filters out row-level demo
 * rows, so a flagged row inside the demo practice is invisible — flag them all
 * and the demo shows zeros.
 *
 * That is exactly what happened in production: the seeded patients are named
 * "Ava Sample", "Liam Demo", "Mia Example" with @example.com addresses, which
 * makes them a perfect match for find_legacy_demo_candidates' telltales, and
 * mark_patients_as_demo cascaded the flag to their appointments and claims. The
 * demo dashboard read $0 / 0 claims and Blanche opened prospect demos with "no
 * patients added yet". The tool now refuses to run inside a demo practice; this
 * repairs the rows it already flagged.
 *
 * Runs on every ensureDemoPractice call so production self-heals on the next
 * demo login, and is a no-op once applied.
 */
async function repairDemoRowFlags(practiceId: number): Promise<void> {
  try {
    const pool = await getPool();
    let repaired = 0;
    for (const table of ['patients', 'appointments', 'claims'] as const) {
      const result = await pool.query(
        `UPDATE ${table} SET is_demo = false WHERE practice_id = $1 AND is_demo = true`,
        [practiceId],
      );
      repaired += result.rowCount ?? 0;
    }
    if (repaired) {
      logger.info('Demo practice row-level demo flags cleared', {
        practiceId,
        repaired,
      });
    }
  } catch (error) {
    // Never block a demo login over it — the next call retries.
    logger.warn('Could not repair demo practice row flags', {
      practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function normalizeDemoRates(practiceId: number): Promise<void> {
  try {
    const pool = await getPool();
    const result = await pool.query(
      `UPDATE practice_cpt_rates
          SET base_rate = $1
        WHERE practice_id = $2
          AND base_rate::numeric = $3::numeric`,
      [DEMO_DEFAULT_TREATMENT_RATE, practiceId, CATALOG_TREATMENT_RATE],
    );
    if (result.rowCount) {
      logger.info('Demo practice charges normalized', {
        practiceId,
        updated: result.rowCount,
        rate: DEMO_DEFAULT_TREATMENT_RATE,
      });
    }
  } catch (error) {
    // Cosmetic for the demo — never block a demo login over it.
    logger.warn('Could not normalize demo practice charges', {
      practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function ensureDemoPractice(): Promise<Practice> {
  // Fast path: already provisioned + seeded — no lock needed.
  const existing = await storage.getDemoPractice();
  if (existing) {
    const patients = await storage.getPatients(existing.id);
    if (patients.length > 0) {
      await normalizeDemoRates(existing.id);
      await repairDemoRowFlags(existing.id);
      await ensureDemoFixturePatients(existing.id);
      const therapistId = await ensureDemoTherapist(existing.id);
      await repairDemoSeededAppointments(existing.id, therapistId);
      return existing;
    }
  }

  // Slow path (first provision, or a prior run that crashed mid-seed): take a
  // session advisory lock on a dedicated connection so concurrent callers
  // serialize instead of double-creating/seeding.
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [DEMO_LOCK_KEY]);

    let practice = await storage.getDemoPractice();
    if (!practice) {
      practice = await storage.createPractice({
        name: DEMO_PRACTICE_NAME,
        isDemo: true,
        sandboxMode: true,
        npi: DEMO_NPI,
        email: 'demo@therapybill.com',
        phone: '(555) 010-0000',
        addressStreet: '123 Demo Way',
        addressCity: 'Springfield',
        addressState: 'NJ',
        addressZip: '07000',
        specialty: 'occupational_therapy',
        onboardingCompleted: true,
      } as any);
      logger.info('Demo practice created', { practiceId: practice.id });
    }

    // Seed only if empty (idempotent; also recovers a crashed-mid-seed run).
    const existingPatients = await storage.getPatients(practice.id);
    if (existingPatients.length === 0) {
      await seedDemoData(practice.id);
      logger.info('Demo practice dataset seeded', { practiceId: practice.id });
    }

    await normalizeDemoRates(practice.id);
    await repairDemoRowFlags(practice.id);
    await ensureDemoFixturePatients(practice.id);
    const therapistId = await ensureDemoTherapist(practice.id);
    await repairDemoSeededAppointments(practice.id, therapistId);
    return practice;
  } finally {
    // Unlock on the SAME connection, then return it to the pool.
    await client.query('SELECT pg_advisory_unlock($1)', [DEMO_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

// Fake-but-realistic pediatric OT/ST caseload. Names are obviously demo.
const DEMO_PATIENTS = [
  { firstName: 'Ava', lastName: 'Sample', dob: '2018-04-12', gender: 'F', payer: 'Horizon BCBS of New Jersey' },
  { firstName: 'Liam', lastName: 'Demo', dob: '2017-09-03', gender: 'M', payer: 'Aetna' },
  { firstName: 'Mia', lastName: 'Example', dob: '2019-01-27', gender: 'F', payer: 'UnitedHealthcare' },
  { firstName: 'Noah', lastName: 'Sample', dob: '2016-11-15', gender: 'M', payer: 'Cigna' },
  { firstName: 'Sofia', lastName: 'Demo', dob: '2018-07-30', gender: 'F', payer: 'Horizon BCBS of New Jersey' },
  { firstName: 'Ethan', lastName: 'Example', dob: '2015-03-08', gender: 'M', payer: 'Aetna' },
];

/**
 * QA fixture patients (therapybill-qa #2). These exist so behaviours that the
 * realistic caseload above can never reach are testable in the live demo:
 *
 *   - Riley Nodob has NO date of birth. Every seeded patient has one, so the
 *     blank-DOB paths (age lines in AI prompts, DOB rendering on cards and
 *     PDFs, intake/import gaps) had no demo reproduction.
 *
 * They are added by ensureDemoFixturePatients() on EVERY ensureDemoPractice
 * call, keyed by their @example.com address, so an already-seeded demo
 * practice picks them up on the next demo login without a reseed. Same
 * isolation rules as DEMO_PATIENTS: isDemo=false rows inside the demo practice.
 */
export const DEMO_FIXTURE_PATIENTS = [
  {
    firstName: 'Riley',
    lastName: 'Nodob',
    dob: null as string | null,
    gender: 'F',
    payer: 'Aetna',
    email: 'riley.nodob@example.com',
    purpose: 'blank date of birth',
  },
];

/**
 * Create any QA fixture patient the demo practice does not have yet.
 * Idempotent: looks each fixture up by email within this practice first.
 */
/**
 * The demo practice's one therapist user. Every demo LOGIN account is an
 * admin (DEMO_ACCOUNTS in routes/auth.ts), and /api/therapists lists only
 * role='therapist' users, so until this existed the New Appointment dialog's
 * therapist picker had zero options in the demo and every demo appointment
 * was saved unassigned (QA sweep 2026-11-18). This user has no password and
 * cannot log in; it exists to be picked. The id is deterministic so the
 * upsert is idempotent across logins and re-seeds.
 */
export const DEMO_THERAPIST = {
  firstName: 'Maya',
  lastName: 'Chen',
  credentials: 'OTR/L',
  email: 'maya.chen@demo.therapybill.com',
  // Clearly-fake placeholder like DEMO_NPI; never reaches a payer.
  npiNumber: '0000000002',
};

export async function ensureDemoTherapist(practiceId: number): Promise<string> {
  const existing = await storage.getTherapistsByPractice(practiceId);
  if (existing.length > 0) return existing[0].id;
  const created = await storage.upsertUser({
    id: `demo-therapist-${practiceId}`,
    email: DEMO_THERAPIST.email,
    firstName: DEMO_THERAPIST.firstName,
    lastName: DEMO_THERAPIST.lastName,
    credentials: DEMO_THERAPIST.credentials,
    npiNumber: DEMO_THERAPIST.npiNumber,
    practiceId,
    role: 'therapist',
  } as any);
  logger.info('Demo therapist user created', { practiceId, userId: created.id });
  return created.id;
}

/** Title seedDemoData gives every appointment it creates. */
export const DEMO_SEED_APPOINTMENT_TITLE = 'Occupational Therapy';
// What the seed intends, in practice wall-clock hours: 9 + (i % 6) → 9..14.
const SEED_FIRST_HOUR = 9;
const SEED_LAST_HOUR = 14;

/**
 * True for a start time the OLD seed wrote: `setHours(9 + i % 6)` in the
 * process zone, UTC on ECS, i.e. an instant at exactly HH:00:00.000Z with HH
 * in 9..14 whose practice-local hour is therefore outside 9..14 (4–9 AM
 * Eastern). The new seed writes practice-local 9..14 = 13..19Z, so it never
 * matches; neither does anything a demo visitor books through the dialog at
 * a sane hour (a 9:00 AM Eastern booking is 14:00Z, local hour 9 → excluded).
 * In a practice whose zone IS UTC the two seeds coincide and nothing matches.
 */
export function isProcessZoneSeedTime(start: Date, timeZone: string): boolean {
  if (start.getUTCMinutes() !== 0 || start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0) return false;
  const utcHour = start.getUTCHours();
  if (utcHour < SEED_FIRST_HOUR || utcHour > SEED_LAST_HOUR) return false;
  const localHour = parseInt(zonedTimeString(start, timeZone).slice(0, 2), 10);
  return localHour < SEED_FIRST_HOUR || localHour > SEED_LAST_HOUR;
}

/**
 * One-time repair for demo practices seeded before 2026-11-18, when
 * seedDemoData built appointment times with setHours() in the process zone.
 * On ECS that is UTC, so "9:00 AM" appointments were stored at 09:00Z = 4:00
 * AM Eastern. The calendar grid rendered UTC hours back then, which hid it;
 * once the grid rendered local time (PR #465) those rows drew at 4–9 AM and
 * fell off the 8 AM grid. Also assigns the demo therapist to seeded rows
 * that predate the therapist user.
 *
 * Idempotent and cheap: one practice-scoped read per demo login; after the
 * first pass nothing matches and nothing is written. Scope is the demo
 * practice id only (callers pass it from ensureDemoPractice), the seed's
 * title, and the predicate above, so hand-booked demo appointments are left
 * alone. Appointments carry no explicit "seeded" marker; the title plus an
 * exact-hour UTC instant at a nonsensical local hour is the safest available
 * signature. Never blocks a demo login: failures are logged.
 */
export async function repairDemoSeededAppointments(
  practiceId: number,
  therapistId: string,
): Promise<{ retimed: number; assigned: number }> {
  const result = { retimed: 0, assigned: 0 };
  try {
    const tz = getBusinessTimeZone();
    const rows = await storage.getAppointments(practiceId);
    for (const appt of rows) {
      if (appt.title !== DEMO_SEED_APPOINTMENT_TITLE) continue;
      const patch: Record<string, unknown> = {};
      const start = new Date(appt.startTime as any);
      if (isProcessZoneSeedTime(start, tz)) {
        // The UTC hour the old seed wrote IS the practice-local hour it meant.
        const intendedHour = start.getUTCHours();
        const localDay = zonedDateString(start, tz);
        const newStart = zonedInstant(localDay, `${intendedHour}:00`, tz);
        const durationMs = appt.endTime
          ? Math.max(new Date(appt.endTime as any).getTime() - start.getTime(), 15 * 60 * 1000)
          : 45 * 60 * 1000;
        patch.startTime = newStart;
        patch.endTime = new Date(newStart.getTime() + durationMs);
        result.retimed++;
      }
      if (!appt.therapistId) {
        patch.therapistId = therapistId;
        result.assigned++;
      }
      if (Object.keys(patch).length > 0) {
        await storage.updateAppointment(appt.id, patch as any);
      }
    }
    if (result.retimed || result.assigned) {
      logger.info('Repaired demo seeded appointments', { practiceId, ...result });
    }
  } catch (error) {
    logger.warn('Could not repair demo seeded appointments', {
      practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return result;
}

export async function ensureDemoFixturePatients(practiceId: number): Promise<number> {
  let created = 0;
  for (const f of DEMO_FIXTURE_PATIENTS) {
    const matches = await storage.getPatientsByEmail(f.email);
    if (matches.some((m: any) => m.practiceId === practiceId)) continue;
    await storage.createPatient({
      practiceId,
      isDemo: false,
      firstName: f.firstName,
      lastName: f.lastName,
      dateOfBirth: f.dob,
      gender: f.gender,
      email: f.email,
      phone: '(555) 019-0099',
      insuranceProvider: f.payer,
      insuranceId: 'DEMO1099',
      policyNumber: 'POL5099',
    } as any);
    created++;
    logger.info('Demo fixture patient created', { practiceId, fixture: f.purpose });
  }
  return created;
}

// Representative claim mix so the dashboard shows revenue, a clean-claim /
// denial rate, and AR aging. amounts in dollars. paidOffset/submitOffset drive
// the paidAt/submittedAt timestamps so the monthly-revenue and revenue-trend
// widgets (which group by paidAt) aren't empty — spread across recent months.
const DEMO_CLAIMS = [
  { patientIdx: 0, status: 'paid', total: '289.00', paid: '241.13', serviceOffset: -68, submitOffset: -66, paidOffset: -50 },
  { patientIdx: 1, status: 'paid', total: '216.00', paid: '198.72', serviceOffset: -40, submitOffset: -38, paidOffset: -22 },
  { patientIdx: 2, status: 'paid', total: '289.00', paid: '246.65', serviceOffset: -24, submitOffset: -22, paidOffset: -6 },
  { patientIdx: 3, status: 'submitted', total: '216.00', paid: null, serviceOffset: -12, submitOffset: -10, paidOffset: null },
  { patientIdx: 4, status: 'submitted', total: '289.00', paid: null, serviceOffset: -9, submitOffset: -7, paidOffset: null },
  { patientIdx: 5, status: 'denied', total: '150.00', paid: null, serviceOffset: -20, submitOffset: -18, paidOffset: null },
  { patientIdx: 0, status: 'denied', total: '216.00', paid: null, serviceOffset: -15, submitOffset: -13, paidOffset: null },
  { patientIdx: 1, status: 'draft', total: '289.00', paid: null, serviceOffset: -2, submitOffset: null, paidOffset: null },
  { patientIdx: 2, status: 'draft', total: '216.00', paid: null, serviceOffset: -1, submitOffset: null, paidOffset: null },
];

async function seedDemoData(practiceId: number): Promise<void> {
  // Therapist first so the seeded appointments can be assigned to someone.
  const therapistId = await ensureDemoTherapist(practiceId);

  // Patients (isDemo=false — see module header). createPatient encrypts PHI.
  const patientIds: number[] = [];
  for (let i = 0; i < DEMO_PATIENTS.length; i++) {
    const p = DEMO_PATIENTS[i];
    const created = await storage.createPatient({
      practiceId,
      isDemo: false,
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dob,
      gender: p.gender,
      email: `${p.firstName.toLowerCase()}.${p.lastName.toLowerCase()}@example.com`,
      phone: `(555) 01${i}-00${i}${i}`,
      insuranceProvider: p.payer,
      insuranceId: `DEMO${1000 + i}`,
      policyNumber: `POL${5000 + i}`,
    } as any);
    patientIds.push(created.id);
  }

  // Appointments: a few completed last week, a few upcoming this/next week.
  const apptPlan = [
    { patientIdx: 0, offset: -7, status: 'completed' },
    { patientIdx: 1, offset: -6, status: 'completed' },
    { patientIdx: 2, offset: -3, status: 'completed' },
    { patientIdx: 3, offset: -2, status: 'no_show' },
    { patientIdx: 4, offset: 0, status: 'scheduled' },
    { patientIdx: 5, offset: 1, status: 'scheduled' },
    { patientIdx: 0, offset: 2, status: 'scheduled' },
    { patientIdx: 1, offset: 3, status: 'scheduled' },
    { patientIdx: 2, offset: 6, status: 'scheduled' },
  ];
  for (let i = 0; i < apptPlan.length; i++) {
    const a = apptPlan[i];
    const start = dayAt(a.offset, 9 + (i % 6));
    const end = new Date(start.getTime() + 45 * 60 * 1000);
    await storage.createAppointment({
      practiceId,
      patientId: patientIds[a.patientIdx],
      therapistId,
      isDemo: false,
      title: DEMO_SEED_APPOINTMENT_TITLE,
      startTime: start,
      endTime: end,
      durationMinutes: 45,
      status: a.status,
    } as any);
  }

  // Claims across the revenue cycle.
  for (let i = 0; i < DEMO_CLAIMS.length; i++) {
    const c = DEMO_CLAIMS[i];
    await storage.createClaim({
      practiceId,
      patientId: patientIds[c.patientIdx],
      isDemo: false,
      claimNumber: `DEMO-${practiceId}-${1000 + i}`,
      totalAmount: c.total,
      submittedAmount: c.status === 'draft' ? null : c.total,
      paidAmount: c.paid,
      status: c.status,
      dateOfService: isoDate(c.serviceOffset),
      submittedAt: c.submitOffset != null ? dayAt(c.submitOffset) : null,
      paidAt: c.paidOffset != null ? dayAt(c.paidOffset) : null,
      denialReason: c.status === 'denied' ? 'CO-197: Precertification/authorization absent' : null,
    } as any);
  }
}
