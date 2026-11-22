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

import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { storage } from '../storage';
import { getPool } from '../db';
import logger from './logger';
import { encryptRemittanceLineItem } from './phiEncryptionService';
import { POSTING_CONFIRMED_MARKER } from './eraDenialService';
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
 * Fake billing identity for the demo practice (post-merge demo retest of
 * #493–#496): the pre-submission scrub failed every demo draft with
 * "Practice Tax ID is missing" (error) and "Practice address is not set"
 * (warning), so the simulated submit → denial → appeal flow was
 * unreachable for every prospect. Obviously fake, format-valid values;
 * nothing here is ever transmitted (the demo practice's submit is a local
 * simulation and the Stedi path is skipped outright for it).
 */
export const DEMO_BILLING_IDENTITY = {
  npi: DEMO_NPI,
  taxId: '00-0000000',
  addressStreet: '123 Demo Way',
  addressCity: 'Springfield',
  addressState: 'NJ',
  addressZip: '07000',
  address: '123 Demo Way, Springfield, NJ 07000',
  phone: '(555) 010-0000',
  billingContactPhone: '(555) 010-0000',
} as const;

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

/**
 * Fill in whatever part of the demo practice's fake billing identity is
 * missing (see DEMO_BILLING_IDENTITY). Goes through storage so the PHI-
 * encrypted practice fields (tax id among them) are written encrypted.
 * Only empty fields are written, so a prospect's own edits to the demo
 * profile are kept, and only the demo practice is ever touched. Returns the
 * number of fields filled in.
 */
export async function ensureDemoBillingIdentity(practiceId: number): Promise<number> {
  try {
    const practice = await storage.getPractice(practiceId);
    if (!practice || !(practice as any).isDemo) return 0;
    const patch: Record<string, string> = {};
    for (const [field, value] of Object.entries(DEMO_BILLING_IDENTITY)) {
      if (!String((practice as any)[field] ?? '').trim()) patch[field] = value;
    }
    const filled = Object.keys(patch).length;
    if (filled === 0) return 0;
    await storage.updatePractice(practiceId, patch as any);
    logger.info('Demo practice billing identity filled in', { practiceId, fields: Object.keys(patch) });
    return filled;
  } catch (error) {
    // Never block a demo login over it — the next call retries.
    logger.warn('Could not fill in the demo practice billing identity', {
      practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
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
  // Every demo login, first provision or not, runs under one session-level
  // advisory lock on a dedicated connection. The repairs below read and then
  // write (the date roll-forward in particular computes a shift from what it
  // reads), so two simultaneous "Try Free Demo" clicks must serialize rather
  // than both apply the same shift. The lock is released on this same
  // connection before it returns to the pool.
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
        npi: DEMO_BILLING_IDENTITY.npi,
        taxId: DEMO_BILLING_IDENTITY.taxId,
        email: 'demo@therapybill.com',
        phone: DEMO_BILLING_IDENTITY.phone,
        billingContactPhone: DEMO_BILLING_IDENTITY.billingContactPhone,
        address: DEMO_BILLING_IDENTITY.address,
        addressStreet: DEMO_BILLING_IDENTITY.addressStreet,
        addressCity: DEMO_BILLING_IDENTITY.addressCity,
        addressState: DEMO_BILLING_IDENTITY.addressState,
        addressZip: DEMO_BILLING_IDENTITY.addressZip,
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

    await runDemoRepairs(practice.id, client);
    return practice;
  } finally {
    // Unlock on the SAME connection, then return it to the pool.
    await client.query('SELECT pg_advisory_unlock($1)', [DEMO_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

/**
 * The login-time repairs, in order, for an already-seeded demo practice.
 * `client` is the connection holding the demo advisory lock; the date
 * roll-forward runs its transaction on it.
 */
async function runDemoRepairs(practiceId: number, client: PoolClient): Promise<void> {
  await normalizeDemoRates(practiceId);
  await repairDemoRowFlags(practiceId);
  await ensureDemoBillingIdentity(practiceId);
  await ensureDemoFixturePatients(practiceId);
  const therapistId = await ensureDemoTherapist(practiceId);
  await repairDemoSeededAppointments(practiceId, therapistId);
  await repairDemoSeededClaimDates(practiceId);
  await ensureDemoClaimPayers(practiceId);
  await ensureDemoClaimLineItems(practiceId);
  await ensureDemoPaymentRecords(practiceId);
  await repairDemoPostingMarkers(practiceId);
  await keepDemoDatesCurrent(practiceId, { client });
}

/**
 * Demo-only (#497): the seeded ERA lines written before the post-success
 * marker existed carry only auto_posted_at, which the remittance page now
 * reads as "needs manual review". Their postings were written by the
 * backfill in the same transaction as the lines, so they are confirmed:
 * stamp the marker on exactly those lines (DEMO-CHK remittances of the demo
 * practice, matched, auto-posted, non-denied, unmarked). Touches no money.
 */
export async function repairDemoPostingMarkers(practiceId: number): Promise<number> {
  try {
    const pool = await getPool();
    const result = await pool.query(
      `UPDATE remittance_line_items l
          SET denial_error = $2
         FROM remittance_advice r
        WHERE r.id = l.remittance_id
          AND r.practice_id = $1
          AND r.check_number LIKE 'DEMO-CHK-%'
          AND l.status = 'matched'
          AND l.claim_id IS NOT NULL
          AND l.auto_posted_at IS NOT NULL
          AND l.denial_error IS NULL
          AND l.denial_applied_at IS NULL
          AND (l.claim_status_code IS NULL OR l.claim_status_code <> '4')`,
      [practiceId, POSTING_CONFIRMED_MARKER],
    );
    if (result.rowCount) {
      logger.info('Demo remittance lines stamped as posting-confirmed', { practiceId, updated: result.rowCount });
    }
    return result.rowCount ?? 0;
  } catch (error) {
    logger.warn('Could not stamp demo remittance lines as posting-confirmed', {
      practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
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
/**
 * Stored in appointments.notes by the seed (and stamped onto pre-marker
 * seeded rows by repairDemoSeededAppointments). The only thing the date
 * roll-forward matches on: a hand-booked appointment that happens to share
 * the seed title and therapist is never moved.
 */
export const DEMO_SEED_APPOINTMENT_MARKER = 'seeded-demo-appointment';
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
/** The full seed shape, used only to stamp the marker onto rows seeded before it existed. */
export function isSeededDemoAppointmentShape(
  appt: { title?: string | null; durationMinutes?: number | null },
  start: Date,
  therapistId: string | null | undefined,
  demoTherapistId: string,
  timeZone: string,
): boolean {
  if (appt.title !== DEMO_SEED_APPOINTMENT_TITLE) return false;
  if (therapistId !== demoTherapistId) return false;
  if ((appt.durationMinutes ?? 45) !== 45) return false;
  const local = zonedTimeString(start, timeZone); // HH:mm
  const hour = parseInt(local.slice(0, 2), 10);
  return local.slice(3, 5) === '00' && hour >= SEED_FIRST_HOUR && hour <= SEED_LAST_HOUR;
}

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
      // Rows seeded before the marker existed: stamp it when the row has the
      // whole seed shape (seed title, the demo therapist, 45 minutes, on the
      // hour, 9-14 practice time, no notes of its own). A hand-booked
      // appointment would have to match all of that to be mistaken for one.
      const effectiveStart = (patch.startTime as Date | undefined) ?? start;
      const effectiveTherapist = (patch.therapistId as string | undefined) ?? appt.therapistId;
      if (!appt.notes && isSeededDemoAppointmentShape(appt, effectiveStart, effectiveTherapist, therapistId, tz)) {
        patch.notes = DEMO_SEED_APPOINTMENT_MARKER;
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
/** Every seeded submitOffset is serviceOffset + this; the payment backfill and the date repair rely on it. */
export const DEMO_SEED_SUBMIT_OFFSET_DAYS = 2;
/** The newest seeded paid claim is paid this many days before "today" (the largest paidOffset below). keepDemoDatesCurrent holds it there. */
export const DEMO_NEWEST_PAID_OFFSET_DAYS = -6;
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
      notes: DEMO_SEED_APPOINTMENT_MARKER,
      startTime: start,
      endTime: end,
      durationMinutes: 45,
      status: a.status,
    } as any);
  }

  // Claims across the revenue cycle. createdAt is the end of the day of
  // service, so the row's history reads created → submitted → paid; without
  // it every claim was "created" at seed time, after its own submittedAt
  // (QA demo pass 2026-11-19, item 2). updatedAt is the latest milestone.
  // The claims table has no date-of-service column (line items carry it), so
  // the service day lives only in createdAt and the submitOffset above.
  for (let i = 0; i < DEMO_CLAIMS.length; i++) {
    const c = DEMO_CLAIMS[i];
    const createdAt = dayAt(c.serviceOffset, 17);
    const submittedAt = c.submitOffset != null ? dayAt(c.submitOffset) : null;
    const paidAt = c.paidOffset != null ? dayAt(c.paidOffset) : null;
    await storage.createClaim({
      practiceId,
      patientId: patientIds[c.patientIdx],
      isDemo: false,
      claimNumber: `DEMO-${practiceId}-${1000 + i}`,
      totalAmount: c.total,
      submittedAmount: c.status === 'draft' ? null : c.total,
      paidAmount: c.paid,
      status: c.status,
      submittedAt,
      paidAt,
      createdAt,
      updatedAt: paidAt ?? submittedAt ?? createdAt,
      denialReason: c.status === 'denied' ? 'CO-197: Precertification/authorization absent' : null,
    } as any);
  }
}

/** Whole calendar days from `fromDay` to `toDay` (YYYY-MM-DD), positive when `toDay` is later. */
export function calendarDaysBetween(fromDay: string, toDay: string): number {
  const [fy, fm, fd] = fromDay.split('-').map(Number);
  const [ty, tm, td] = toDay.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * DST-aware shift of a stored-UTC `timestamp` column by whole days in the
 * practice zone: the wall-clock time is preserved (10:00 EDT in October
 * becomes 10:00 EST in November). `daysParam` / `tzParam` are placeholders.
 */
export function shiftTimestampByLocalDaysSql(column: string, daysParam: string, tzParam: string): string {
  return `((((${column}) AT TIME ZONE 'UTC') AT TIME ZONE ${tzParam}) + make_interval(days => ${daysParam}::int)) AT TIME ZONE ${tzParam} AT TIME ZONE 'UTC'`;
}

/**
 * Keep the seeded demo on today's calendar.
 *
 * Every seeded date is an offset from the moment the practice was seeded,
 * so a demo seeded weeks ago drifts: by 2026-11-19 the live practice
 * (seeded 2026-11-01) had its newest payment 24 days old and nothing at all
 * in November, so Accounting ("This Month"), ERA/835 and Deposits opened
 * empty even though the payment rows were there (post-deploy check
 * 2026-11-19). Appointments seeded "this week" were likewise weeks past.
 *
 * If the newest seeded paid claim is older than its intended
 * DEMO_NEWEST_PAID_OFFSET_DAYS, every seeded row moves forward by the same
 * whole number of days, so relative order and spacing are unchanged: the
 * DEMO-* claims (created, submitted, paid) and their line items, the demo
 * ERAs and their lines, the ERA postings, the copays the backfill wrote
 * (their description's service date rewritten), and the appointments that
 * carry DEMO_SEED_APPOINTMENT_MARKER (shifted in the practice zone, so a
 * 10:00 visit stays at 10:00 across a DST change). Hand-made demo data is
 * left alone.
 *
 * Concurrency and atomicity (review of #491): everything, the anchor read
 * included, happens in ONE transaction that first takes the demo advisory
 * lock (transaction-scoped; re-entrant for a caller already holding the
 * session lock), so two simultaneous logins cannot both apply the shift,
 * and a failure anywhere, the appointment update included, rolls the whole
 * shift back so the next login repairs it in full. Refuses a practice that
 * is not the demo practice. A no-op once current; never blocks a login.
 */
export async function keepDemoDatesCurrent(
  practiceId: number,
  opts: { client?: PoolClient; now?: Date } = {},
): Promise<number> {
  const ownClient = !opts.client;
  let client: PoolClient | undefined = opts.client;
  try {
    const practice = await storage.getPractice(practiceId);
    if (!practice?.isDemo) {
      logger.warn('Refusing to roll dates forward: not the demo practice', { practiceId });
      return 0;
    }
    const tz = getBusinessTimeZone();
    const pool = await getPool();
    const conn: PoolClient = client ?? (client = await pool.connect());

    try {
      await conn.query('BEGIN');
      await conn.query('SELECT pg_advisory_xact_lock($1)', [DEMO_LOCK_KEY]);

      // Anchor read under the lock, inside the transaction.
      const anchor = await conn.query(
        `SELECT max(paid_at) AS newest_paid_at
           FROM claims
          WHERE practice_id = $1 AND claim_number LIKE 'DEMO-%' AND status = 'paid' AND paid_at IS NOT NULL`,
        [practiceId],
      );
      const newestPaidAt = anchor.rows?.[0]?.newest_paid_at;
      if (!newestPaidAt) {
        await conn.query('COMMIT');
        return 0;
      }
      const newestDay = zonedDateString(new Date(newestPaidAt), tz);
      const intendedDay = zonedDateString(zonedAddDays(opts.now ?? new Date(), DEMO_NEWEST_PAID_OFFSET_DAYS, tz), tz);
      const drift = calendarDaysBetween(newestDay, intendedDay);
      if (drift <= 0) {
        await conn.query('COMMIT');
        return 0;
      }

      const args = [practiceId, drift];
      await conn.query(
        `UPDATE claims
            SET created_at = created_at + make_interval(days => $2::int),
                updated_at = updated_at + make_interval(days => $2::int),
                submitted_at = submitted_at + make_interval(days => $2::int),
                paid_at = paid_at + make_interval(days => $2::int)
          WHERE practice_id = $1 AND claim_number LIKE 'DEMO-%'`,
        args,
      );
      await conn.query(
        `UPDATE claim_line_items
            SET date_of_service = date_of_service + $2::int,
                updated_at = updated_at + make_interval(days => $2::int)
          WHERE claim_id IN (SELECT id FROM claims WHERE practice_id = $1 AND claim_number LIKE 'DEMO-%')`,
        args,
      );
      await conn.query(
        `UPDATE remittance_line_items
            SET service_date = service_date + $2::int,
                matched_at = matched_at + make_interval(days => $2::int),
                auto_posted_at = auto_posted_at + make_interval(days => $2::int),
                created_at = created_at + make_interval(days => $2::int)
          WHERE remittance_id IN (
            SELECT id FROM remittance_advice WHERE practice_id = $1 AND check_number LIKE 'DEMO-CHK-%'
          )`,
        args,
      );
      await conn.query(
        `UPDATE remittance_advice
            SET received_date = received_date + $2::int,
                check_date = check_date + $2::int,
                processed_at = processed_at + make_interval(days => $2::int),
                created_at = created_at + make_interval(days => $2::int)
          WHERE practice_id = $1 AND check_number LIKE 'DEMO-CHK-%'`,
        args,
      );
      await conn.query(
        `UPDATE payment_postings
            SET payment_date = payment_date + $2::int,
                posted_at = posted_at + make_interval(days => $2::int),
                created_at = created_at + make_interval(days => $2::int)
          WHERE practice_id = $1 AND check_number LIKE 'DEMO-CHK-%'`,
        args,
      );
      await conn.query(
        `UPDATE payment_transactions
            SET processed_at = processed_at + make_interval(days => $2::int),
                created_at = created_at + make_interval(days => $2::int),
                updated_at = updated_at + make_interval(days => $2::int)
          WHERE practice_id = $1
            AND category = 'copay' AND processor = 'manual'
            AND description LIKE 'Copay for date of service%'
            AND claim_id IN (SELECT id FROM claims WHERE practice_id = $1 AND claim_number LIKE 'DEMO-%')`,
        args,
      );
      // The copay description quotes the service date; rewrite it from the
      // (already shifted) remittance line so the text matches the data.
      await conn.query(
        `UPDATE payment_transactions t
            SET description = 'Copay for date of service ' || l.service_date::text || ' (claim ' || c.claim_number || ')'
           FROM claims c
           JOIN remittance_line_items l ON l.claim_id = c.id
          WHERE t.claim_id = c.id
            AND t.practice_id = $1
            AND c.claim_number LIKE 'DEMO-%'
            AND t.category = 'copay' AND t.processor = 'manual'
            AND t.description LIKE 'Copay for date of service%'`,
        [practiceId],
      );
      const appointments = await conn.query(
        `UPDATE appointments
            SET start_time = ${shiftTimestampByLocalDaysSql('start_time', '$2', '$3')},
                end_time = ${shiftTimestampByLocalDaysSql('end_time', '$2', '$3')},
                updated_at = now()
          WHERE practice_id = $1 AND notes = $4`,
        [practiceId, drift, tz, DEMO_SEED_APPOINTMENT_MARKER],
      );
      await conn.query('COMMIT');

      logger.info('Demo seeded dates rolled forward to today', {
        practiceId,
        days: drift,
        appointmentsShifted: appointments.rowCount ?? 0,
      });
      return drift;
    } catch (error) {
      await conn.query('ROLLBACK').catch(() => {});
      throw error;
    }
  } catch (error) {
    logger.warn('Could not roll demo seeded dates forward', {
      practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  } finally {
    if (ownClient && client) client.release();
  }
}

/**
 * Payer catalog rows the seeded demo payers map to. The insurances table is
 * a global catalog (Medicare, Aetna, Cigna, UnitedHealth, Blue Cross Blue
 * Shield, ... plus whatever practices add), while the seed names realistic
 * plans on the patient chart. A claim with no insuranceId showed its payer
 * as "Unknown" in the claims list and detail (QA demo pass 2026-11-19,
 * DEMO-2-1006), and the denial risk analysis had no claim payer to reason
 * about. Exact match first, then a prefix match either way, so
 * "UnitedHealthcare" finds the catalog's "UnitedHealth" and "Horizon BCBS
 * of New Jersey" falls back to the generic Blue Cross Blue Shield row.
 */
const DEMO_PAYER_ALIASES: Record<string, string[]> = {
  'unitedhealthcare': ['unitedhealthcare', 'unitedhealth', 'united healthcare', 'uhc'],
  'horizon bcbs of new jersey': [
    'horizon bcbs of new jersey',
    'horizon blue cross blue shield of new jersey',
    'horizon bcbs',
    'blue cross blue shield',
    'bcbs',
  ],
};

export function matchDemoPayer(
  payerName: string | null | undefined,
  catalog: Array<{ id: number; name: string | null }>,
): number | null {
  const key = (payerName ?? '').trim().toLowerCase();
  if (!key) return null;
  const aliases = DEMO_PAYER_ALIASES[key] ?? [key];
  const names = catalog.map((i) => ({ id: i.id, name: (i.name ?? '').trim().toLowerCase() })).filter((i) => i.name);
  // Most specific alias first; for each, an exact name beats a prefix match.
  for (const alias of aliases) {
    const exact = names.find((i) => i.name === alias);
    if (exact) return exact.id;
    const partial = names.find((i) => i.name.startsWith(alias) || alias.startsWith(i.name));
    if (partial) return partial.id;
  }
  return null;
}

/**
 * Link every DEMO-* claim that has no payer to the catalog row matching its
 * patient's chart plan. Runs on every demo login; a no-op once linked.
 * Never blocks a demo login.
 */
export async function ensureDemoClaimPayers(practiceId: number): Promise<number> {
  let linked = 0;
  try {
    const claims = await storage.getClaims(practiceId);
    const pending = (claims ?? []).filter((c: any) => !c.insuranceId && String(c.claimNumber ?? '').startsWith('DEMO-'));
    if (pending.length === 0) return 0;
    const catalog = await storage.getInsurances();
    const payerByPatient = new Map<number, number | null>();
    for (const claim of pending) {
      let insuranceId = payerByPatient.get(claim.patientId);
      if (insuranceId === undefined) {
        const patient = await storage.getPatient(claim.patientId);
        insuranceId =
          patient && patient.practiceId === practiceId
            ? matchDemoPayer((patient as any).insuranceProvider, catalog as any)
            : null;
        payerByPatient.set(claim.patientId, insuranceId);
      }
      if (!insuranceId) continue;
      await storage.updateClaim(claim.id, { insuranceId } as any);
      linked++;
    }
    if (linked) logger.info('Demo claims linked to payer catalog rows', { practiceId, linked });
  } catch (error) {
    logger.warn('Could not link demo claims to payers', {
      practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return linked;
}

/**
 * One-time repair for demo practices seeded before the createdAt fix above:
 * their claims carry created_at = seed time, which is AFTER the back-dated
 * submitted_at/paid_at, so the claim detail showed a claim submitted before
 * it existed. Rebuilds created_at as the seed intends (service day, two
 * days before submission: every seeded submitOffset is serviceOffset + 2)
 * and updated_at as the latest milestone. Scope: the demo practice's own
 * DEMO-* claims whose created_at is still after submitted_at, so hand-made
 * demo claims and already-repaired rows are untouched. Never blocks a demo
 * login.
 */
export async function repairDemoSeededClaimDates(practiceId: number): Promise<number> {
  try {
    const pool = await getPool();
    const result = await pool.query(
      `UPDATE claims
          SET created_at = submitted_at - interval '2 days',
              updated_at = COALESCE(paid_at, submitted_at)
        WHERE practice_id = $1
          AND claim_number LIKE 'DEMO-%'
          AND submitted_at IS NOT NULL
          AND created_at > submitted_at`,
      [practiceId],
    );
    if (result.rowCount) {
      logger.info('Repaired demo seeded claim dates', { practiceId, repaired: result.rowCount });
    }
    return result.rowCount ?? 0;
  } catch (error) {
    logger.warn('Could not repair demo seeded claim dates', {
      practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Payment records behind the seeded paid claims (QA demo pass 2026-11-19,
 * item 1).
 *
 * seedDemoData sets paidAmount/paidAt on three claims and nothing else, so
 * the dashboard (which sums claims.paidAmount) showed $686.50 collected while
 * every screen that reads the money's paper trail showed $0: ERA/835
 * (remittance_advice + remittance_line_items), Deposits (remittances in the
 * period, awaiting or matched to a deposit) and Accounting
 * (payment_transactions). The Recovery Ledger is not a collections view (it
 * reads appeal outcomes and underpayment recoveries) and is left alone.
 *
 * For each paid DEMO-* claim that has no payment posting, this writes what
 * the real ERA path (ingestRemittance → autoMatchRemittance → postPayment)
 * would have left behind, dated to the claim's paidAt:
 *   - one processed remittance_advice (the payer's check), idempotent on the
 *     (practice_id, file_hash) unique index;
 *   - one matched, auto-posted remittance_line_items row for the claim, PHI
 *     fields encrypted like the ingestion service does;
 *   - one 'era' payment_postings row;
 *   - a completed patient copay in payment_transactions for the patient
 *     responsibility on the line (the Accounting page reads only that table;
 *     an insurance payment never lands there in the real flow either).
 * Amounts reconcile: paid + patient responsibility + contractual adjustment
 * = charged. postPayment itself is not used: it recomputes the claim status
 * from paid vs charged (which would flip these to 'partial') and stamps
 * paidAt = now.
 *
 * Runs on every ensureDemoPractice call, so the production demo practice
 * picks it up on the next demo login; a no-op once every paid claim has a
 * posting. Each claim's rows are written in one transaction. Never blocks a
 * demo login.
 */
export const DEMO_PATIENT_RESPONSIBILITY = 25;
/** Fallback CPT for a demo remittance line when its claim has no line item to take the code from. */
export const DEMO_ERA_CPT = '97530';

/**
 * Service lines for the seeded claims (read-only billing pass 2026-11-19):
 * the seed set each claim's total but created no claim_line_items, so the
 * claim detail showed "$289 billed" with no lines while its ERA line named
 * CPT 97530 at $289. Line persistence itself is fine (a hand-made draft
 * shows its lines); this is a seed gap, repaired here on every login.
 *
 * One line per claim, matching the seed's totals the way the earlier demo
 * dataset did: $289 = 97530 (therapeutic activities), $216 = 97110
 * (therapeutic exercises), $150 = 97140 (manual therapy); ICD-10 F82;
 * modifier GO. The charge is the claim's own total (the catalog's base
 * rate is recorded as standardRate, with an override reason when they
 * differ) so the lines reconcile with the claim and its ERA. The date of
 * service is the claim's created day in the practice zone, the seed's
 * service day. A demo ERA line whose CPT does not match the claim's line
 * is corrected to it.
 */
export const DEMO_LINE_BY_TOTAL: Record<string, string> = { '289.00': '97530', '216.00': '97110', '150.00': '97140' };
export const DEMO_LINE_ICD10 = 'F82';
export const DEMO_LINE_MODIFIER = 'GO';

export function demoCptForTotal(totalAmount: string | number | null | undefined): string {
  const key = Number(totalAmount ?? 0).toFixed(2);
  return DEMO_LINE_BY_TOTAL[key] ?? DEMO_ERA_CPT;
}

export async function ensureDemoClaimLineItems(practiceId: number): Promise<number> {
  let created = 0;
  try {
    const demoClaims = ((await storage.getClaims(practiceId)) ?? []).filter((c: any) => String(c.claimNumber ?? '').startsWith('DEMO-'));
    if (demoClaims.length === 0) return 0;
    const linesByClaim = await storage.getClaimLineItemsForClaims(demoClaims.map((c: any) => c.id));
    const missing = demoClaims.filter((c: any) => (linesByClaim.get(c.id) ?? []).length === 0);
    if (missing.length === 0) return 0;

    const [cptCodes, icd10Codes] = await Promise.all([storage.getCptCodes(), storage.getIcd10Codes()]);
    const cptByCode = new Map<string, any>(cptCodes.map((c: any) => [String(c.code), c]));
    const icd = icd10Codes.find((i: any) => i.code === DEMO_LINE_ICD10) ?? null;
    const tz = getBusinessTimeZone();
    const pool = await getPool();

    for (const claim of missing) {
      const code = demoCptForTotal(claim.totalAmount);
      const cpt = cptByCode.get(code);
      if (!cpt) {
        logger.warn('Demo claim line not created: CPT missing from the catalog', { practiceId, claimId: claim.id, code });
        continue;
      }
      const total = Number(claim.totalAmount ?? 0).toFixed(2);
      const standardRate = cpt.baseRate != null ? Number(cpt.baseRate).toFixed(2) : null;
      const serviceDay = zonedDateString(new Date(claim.createdAt ?? Date.now()), tz);
      await storage.createClaimLineItem({
        claimId: claim.id,
        cptCodeId: cpt.id,
        icd10CodeId: icd?.id ?? null,
        units: 1,
        rate: total,
        amount: total,
        standardRate,
        rateOverrideReason: standardRate && standardRate !== total ? 'Seeded demo charge' : null,
        dateOfService: serviceDay,
        modifier: DEMO_LINE_MODIFIER,
        notes: null,
      } as any);
      created++;
      // The demo ERA line for this claim (written before the claim had a line) names the fallback CPT; align it.
      await pool.query(
        `UPDATE remittance_line_items l
            SET cpt_code = $2
           FROM remittance_advice r
          WHERE l.remittance_id = r.id
            AND r.practice_id = $1
            AND r.check_number LIKE 'DEMO-CHK-%'
            AND l.claim_id = $3
            AND l.cpt_code IS DISTINCT FROM $2`,
        [practiceId, code, claim.id],
      );
    }
    if (created) logger.info('Demo claim service lines created', { practiceId, created });
  } catch (error) {
    logger.warn('Could not create demo claim service lines', {
      practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return created;
}

export function demoEraFileHash(practiceId: number, claimNumber: string): string {
  return crypto.createHash('sha256').update(`demo-era:${practiceId}:${claimNumber}`).digest('hex');
}

const money = (n: number): string => n.toFixed(2);

/** CPT for a demo remittance line: the claim's first service line's code, else the fallback. */
async function demoEraCptForClaim(claimId: number): Promise<string> {
  try {
    const lines = await storage.getClaimLineItems(claimId);
    const first = lines?.[0];
    if (!first) return DEMO_ERA_CPT;
    const cpt = (await storage.getCptCodes()).find((c: any) => c.id === (first as any).cptCodeId);
    return cpt?.code ? String(cpt.code) : DEMO_ERA_CPT;
  } catch {
    return DEMO_ERA_CPT;
  }
}

export async function ensureDemoPaymentRecords(practiceId: number): Promise<number> {
  let created = 0;
  try {
    const pool = await getPool();
    const pending = await pool.query(
      `SELECT c.id, c.claim_number, c.patient_id, c.total_amount, c.paid_amount, c.paid_at, c.submitted_at
         FROM claims c
        WHERE c.practice_id = $1
          AND c.status = 'paid'
          AND c.claim_number LIKE 'DEMO-%'
          AND c.paid_amount IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM payment_postings p WHERE p.claim_id = c.id AND p.reversed = false
          )
        ORDER BY c.id`,
      [practiceId],
    );
    const tz = getBusinessTimeZone();
    for (const row of pending.rows ?? []) {
      const total = Number(row.total_amount);
      const paid = Number(row.paid_amount);
      if (!(paid > 0) || !(total >= paid)) continue;
      const patient = await storage.getPatient(row.patient_id);
      if (!patient || patient.practiceId !== practiceId) continue;
      // The remittance line names the claim's own service code when it has one.
      const eraCpt = await demoEraCptForClaim(row.id);

      const writeOff = total - paid;
      const patientResp = writeOff >= DEMO_PATIENT_RESPONSIBILITY ? DEMO_PATIENT_RESPONSIBILITY : 0;
      const contractual = writeOff - patientResp;
      const allowed = paid + patientResp;
      const paidAt = row.paid_at ? new Date(row.paid_at) : new Date();
      const paidDay = zonedDateString(paidAt, tz);
      // The claims table carries no date of service (claim_line_items does,
      // and the seeded claims have none). The seed submits each claim two
      // days after its service day, so the line's service date is derived
      // from submitted_at; a claim never submitted falls back to its paid day.
      // (Post-deploy 2026-11-19: this query selected c.date_of_service, which
      // does not exist, so the whole backfill failed before writing a row.)
      const serviceDay = row.submitted_at
        ? zonedDateString(zonedAddDays(new Date(row.submitted_at), -DEMO_SEED_SUBMIT_OFFSET_DAYS, tz), tz)
        : paidDay;
      const claimNumber = String(row.claim_number);
      const checkNumber = `DEMO-CHK-${claimNumber.replace(/^DEMO-/, '')}`;
      const payerName = (patient as any).insuranceProvider || 'Demo Health Plan';
      const line = encryptRemittanceLineItem({
        patientName: `${patient.lastName}, ${patient.firstName}`,
        memberId: (patient as any).insuranceId ?? null,
      });
      const reasonCodes = [
        { code: 'CO-45', description: 'Charge exceeds fee schedule/maximum allowable or contracted/legislated fee arrangement' },
        ...(patientResp > 0 ? [{ code: 'PR-3', description: 'Co-payment amount' }] : []),
      ];

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const era = await client.query(
          `INSERT INTO remittance_advice
             (practice_id, received_date, payer_name, check_number, check_date, total_payment_amount,
              status, processed_at, file_hash, created_at)
           VALUES ($1, $2, $3, $4, $2, $5, 'processed', $6, $7, $6)
           ON CONFLICT (practice_id, file_hash) DO UPDATE SET status = EXCLUDED.status
           RETURNING id`,
          [practiceId, paidDay, payerName, checkNumber, money(paid), paidAt, demoEraFileHash(practiceId, claimNumber)],
        );
        const remittanceId = era.rows?.[0]?.id;
        if (!remittanceId) throw new Error('remittance_advice insert returned no id');

        await client.query(
          `INSERT INTO remittance_line_items
             (remittance_id, claim_id, patient_name, member_id, service_date, cpt_code,
              charged_amount, allowed_amount, paid_amount, adjustment_amount,
              patient_responsibility, contractual_adjustment, adjustment_reason_codes,
              status, claim_reference, match_type, matched_at, auto_posted_at, created_at, denial_error)
           SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb,
                  'matched', $14, 'claim_number', $15, $15, $15, $16
            WHERE NOT EXISTS (SELECT 1 FROM remittance_line_items WHERE remittance_id = $1)`,
          [
            remittanceId, row.id, line.patientName, line.memberId, serviceDay, eraCpt,
            money(total), money(allowed), money(paid), money(writeOff),
            money(patientResp), money(contractual), JSON.stringify(reasonCodes),
            claimNumber, paidAt,
            // Post-success marker (#497): this line's posting is written in
            // the same transaction below, so the line is confirmed, not
            // "needs manual review".
            POSTING_CONFIRMED_MARKER,
          ],
        );

        await client.query(
          `INSERT INTO payment_postings
             (practice_id, claim_id, payer_name, check_number, payment_date, payment_amount,
              adjustment_amount, adjustment_reason, patient_responsibility, allowed_amount,
              copay_amount, source, posted_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'CO-45', $8, $9, $8, 'era', $10, $10)`,
          [
            practiceId, row.id, payerName, checkNumber, paidDay, money(paid),
            money(contractual), money(patientResp), money(allowed), paidAt,
          ],
        );

        if (patientResp > 0) {
          const copayAt = zonedAddDays(paidAt, 2, tz);
          await client.query(
            `INSERT INTO payment_transactions
               (patient_id, practice_id, claim_id, amount, type, category, description,
                processor, status, processed_at, created_at, updated_at)
             SELECT $1, $2, $3, $4, 'payment', 'copay', $5, 'manual', 'completed', $6, $6, $6
              WHERE NOT EXISTS (
                SELECT 1 FROM payment_transactions WHERE claim_id = $3 AND type = 'payment'
              )`,
            [
              row.patient_id, practiceId, row.id, money(patientResp),
              `Copay for date of service ${serviceDay} (claim ${claimNumber})`,
              copayAt,
            ],
          );
        }

        await client.query('COMMIT');
        created++;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
    if (created) {
      logger.info('Demo payment records created for paid claims', { practiceId, created });
    }
  } catch (error) {
    logger.warn('Could not create demo payment records', {
      practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return created;
}
