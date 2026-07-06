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
 *
 * ensureDemoPractice() is idempotent: it creates the practice + a representative
 * dataset once, then returns the existing one on every later call.
 */

import { storage } from '../storage';
import logger from './logger';
import type { Practice } from '@shared/schema';

export const DEMO_PRACTICE_NAME = 'Bright Steps Pediatric Therapy (Demo)';
// Clearly-fake placeholder NPI. The demo practice never bills for real, and
// submit_claim refuses demo practices, so this is never sent to a payer.
const DEMO_NPI = '0000000001';

/** A day at a fixed clock time, offset from today. */
function dayAt(offsetDays: number, hour = 10, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d;
}
/** YYYY-MM-DD offset from today. */
function isoDate(offsetDays: number): string {
  return dayAt(offsetDays).toISOString().split('T')[0];
}

/**
 * Find or create the isolated demo practice, seeding a representative dataset
 * the first time. Safe to call on every demo-login.
 */
export async function ensureDemoPractice(): Promise<Practice> {
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

  // Seed the dataset only if this practice has no patients yet (idempotent).
  const existingPatients = await storage.getPatients(practice.id);
  if (existingPatients.length === 0) {
    await seedDemoData(practice.id);
    logger.info('Demo practice dataset seeded', { practiceId: practice.id });
  }

  return practice;
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

// Representative claim mix so the dashboard shows revenue, a clean-claim /
// denial rate, and AR aging. amounts in dollars.
const DEMO_CLAIMS = [
  { patientIdx: 0, status: 'paid', total: '289.00', paid: '241.13', serviceOffset: -38 },
  { patientIdx: 1, status: 'paid', total: '216.00', paid: '198.72', serviceOffset: -31 },
  { patientIdx: 2, status: 'paid', total: '289.00', paid: '246.65', serviceOffset: -24 },
  { patientIdx: 3, status: 'submitted', total: '216.00', paid: null, serviceOffset: -12 },
  { patientIdx: 4, status: 'submitted', total: '289.00', paid: null, serviceOffset: -9 },
  { patientIdx: 5, status: 'denied', total: '150.00', paid: null, serviceOffset: -20 },
  { patientIdx: 0, status: 'denied', total: '216.00', paid: null, serviceOffset: -15 },
  { patientIdx: 1, status: 'draft', total: '289.00', paid: null, serviceOffset: -2 },
  { patientIdx: 2, status: 'draft', total: '216.00', paid: null, serviceOffset: -1 },
];

async function seedDemoData(practiceId: number): Promise<void> {
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
      isDemo: false,
      title: 'Occupational Therapy',
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
      denialReason: c.status === 'denied' ? 'CO-197: Precertification/authorization absent' : null,
    } as any);
  }
}
