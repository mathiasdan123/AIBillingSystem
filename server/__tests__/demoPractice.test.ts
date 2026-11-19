import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage, mockClient, mockPool } = vi.hoisted(() => {
  // Fake pooled client for the pg_advisory_lock path.
  const mockClient = { query: vi.fn().mockResolvedValue({}), release: vi.fn() };
  return {
    mockStorage: {
      getDemoPractice: vi.fn(),
      createPractice: vi.fn(),
      getPatients: vi.fn(),
      getPatientsByEmail: vi.fn(),
      createPatient: vi.fn(),
      createAppointment: vi.fn(),
      createClaim: vi.fn(),
      getTherapistsByPractice: vi.fn(),
      upsertUser: vi.fn(),
      getAppointments: vi.fn(),
      updateAppointment: vi.fn(),
      getPatient: vi.fn(),
      getClaims: vi.fn(async () => []),
      getInsurances: vi.fn(async () => []),
      updateClaim: vi.fn(),
    },
    mockClient,
    // pool.query is the un-pooled path used by normalizeDemoRates and
    // repairDemoRowFlags; pool.connect serves the advisory-lock path.
    mockPool: {
      connect: vi.fn(async () => mockClient),
      query: vi.fn(async () => ({ rowCount: 0 })),
    },
  };
});
vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../db', () => ({ getPool: vi.fn(async () => mockPool) }));

// ensureDemoPaymentRecords encrypts the remittance line's PHI fields with the
// real helper; give it a key when the environment has none.
if (!process.env.PHI_ENCRYPTION_KEY) {
  process.env.PHI_ENCRYPTION_KEY = 'a'.repeat(64);
}

import {
  ensureDemoPractice,
  DEMO_THERAPIST,
  DEMO_PATIENT_RESPONSIBILITY,
  demoEraFileHash,
  ensureDemoPaymentRecords,
  ensureDemoClaimPayers,
  keepDemoDatesCurrent,
  calendarDaysBetween,
  DEMO_SEED_SUBMIT_OFFSET_DAYS,
  DEMO_NEWEST_PAID_OFFSET_DAYS,
  matchDemoPayer,
  isProcessZoneSeedTime,
  repairDemoSeededAppointments,
  repairDemoSeededClaimDates,
} from '../services/demoPractice';
import { decryptRemittanceLineItem } from '../services/phiEncryptionService';
import { zonedAddDays, zonedDateString } from '../utils/timezone';
import { getTableColumns } from 'drizzle-orm';
import { claims, remittanceAdvice, remittanceLineItems, paymentPostings, paymentTransactions, practiceCptRates } from '@shared/schema';
import { zonedTimeString } from '../utils/dateOnly';

describe('ensureDemoPractice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let nextPatientId = 100;
    mockStorage.createPatient.mockImplementation(async () => ({ id: nextPatientId++ }));
    mockStorage.createAppointment.mockResolvedValue({ id: 1 });
    mockStorage.createClaim.mockResolvedValue({ id: 1 });
    // Default: no fixture patient exists yet.
    mockStorage.getPatientsByEmail.mockResolvedValue([]);
    // Default: nothing to repair.
    mockStorage.getAppointments.mockResolvedValue([]);
    mockStorage.updateAppointment.mockImplementation(async (id: number, patch: any) => ({ id, ...patch }));
    // Default: no therapist user yet. Like the real table, an upserted
    // therapist is visible to the next getTherapistsByPractice call.
    const therapistUsers: any[] = [];
    mockStorage.getTherapistsByPractice.mockImplementation(async () => [...therapistUsers]);
    mockStorage.upsertUser.mockImplementation(async (u: any) => {
      therapistUsers.push({ id: u.id, role: u.role });
      return { id: u.id };
    });
  });

  it('creates an isolated demo practice (isDemo=true, sandbox) and seeds it when none exists', async () => {
    mockStorage.getDemoPractice.mockResolvedValue(undefined);
    mockStorage.createPractice.mockResolvedValue({ id: 99, isDemo: true });
    mockStorage.getPatients.mockResolvedValue([]); // empty → seed

    const practice = await ensureDemoPractice();

    expect(practice.id).toBe(99);
    // The created practice must be flagged as an isolated demo sandbox.
    const createArg = mockStorage.createPractice.mock.calls[0][0];
    expect(createArg.isDemo).toBe(true);
    expect(createArg.sandboxMode).toBe(true);
    // Seeded a representative dataset scoped to the demo practice id.
    expect(mockStorage.createPatient).toHaveBeenCalled();
    expect(mockStorage.createPatient.mock.calls[0][0].practiceId).toBe(99);
    expect(mockStorage.createClaim).toHaveBeenCalled();
    // Seeded patients are NOT row-level demo (so the demo dashboard shows data).
    expect(mockStorage.createPatient.mock.calls[0][0].isDemo).toBe(false);
    // Provisioning is serialized under an advisory lock and the connection is released.
    const queries = mockClient.query.mock.calls.map((c) => c[0]);
    expect(queries.some((q: string) => q.includes('pg_advisory_lock'))).toBe(true);
    expect(queries.some((q: string) => q.includes('pg_advisory_unlock'))).toBe(true);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('is idempotent: reuses the existing demo practice and does not re-seed', async () => {
    mockStorage.getDemoPractice.mockResolvedValue({ id: 99, isDemo: true });
    mockStorage.getPatients.mockResolvedValue([{ id: 1 }]); // already has data
    // Fixture already present in THIS practice → nothing to add.
    mockStorage.getPatientsByEmail.mockResolvedValue([{ id: 2, practiceId: 99 }]);

    const practice = await ensureDemoPractice();

    expect(practice.id).toBe(99);
    expect(mockStorage.createPractice).not.toHaveBeenCalled();
    expect(mockStorage.createPatient).not.toHaveBeenCalled();
    expect(mockStorage.createClaim).not.toHaveBeenCalled();
  });

  // ---- QA fixture patients (therapybill-qa #2) ----

  it('seeds the blank-DOB fixture patient (Riley Nodob, dateOfBirth null) on a fresh demo practice', async () => {
    mockStorage.getDemoPractice.mockResolvedValue(undefined);
    mockStorage.createPractice.mockResolvedValue({ id: 99, isDemo: true });
    mockStorage.getPatients.mockResolvedValue([]);

    await ensureDemoPractice();

    const fixture = mockStorage.createPatient.mock.calls
      .map((c) => c[0])
      .find((p: any) => p.email === 'riley.nodob@example.com');
    expect(fixture).toBeDefined();
    expect(fixture.dateOfBirth).toBeNull();
    expect(fixture.practiceId).toBe(99);
    expect(fixture.isDemo).toBe(false);
    // Every realistic seed patient still has a DOB; only the fixture is blank.
    const blank = mockStorage.createPatient.mock.calls.filter((c) => c[0].dateOfBirth == null);
    expect(blank).toHaveLength(1);
  });

  it('adds the blank-DOB fixture to an ALREADY seeded demo practice that lacks it, without reseeding', async () => {
    mockStorage.getDemoPractice.mockResolvedValue({ id: 99, isDemo: true });
    mockStorage.getPatients.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mockStorage.getPatientsByEmail.mockResolvedValue([]); // not there yet

    await ensureDemoPractice();

    expect(mockStorage.createPatient).toHaveBeenCalledTimes(1);
    expect(mockStorage.createPatient.mock.calls[0][0]).toMatchObject({
      practiceId: 99,
      email: 'riley.nodob@example.com',
      dateOfBirth: null,
      isDemo: false,
    });
    expect(mockStorage.createClaim).not.toHaveBeenCalled();
    expect(mockStorage.createAppointment).not.toHaveBeenCalled();
  });

  it('does not treat the same fixture email in ANOTHER practice as present', async () => {
    mockStorage.getDemoPractice.mockResolvedValue({ id: 99, isDemo: true });
    mockStorage.getPatients.mockResolvedValue([{ id: 1 }]);
    mockStorage.getPatientsByEmail.mockResolvedValue([{ id: 5, practiceId: 7 }]);

    await ensureDemoPractice();

    expect(mockStorage.createPatient).toHaveBeenCalledTimes(1);
    expect(mockStorage.createPatient.mock.calls[0][0].practiceId).toBe(99);
  });

  // ---- Demo therapist (QA sweep 2026-11-18: empty therapist picker) ----

  it('seeds a therapist user on a fresh demo practice and assigns every seeded appointment to them', async () => {
    mockStorage.getDemoPractice.mockResolvedValue(undefined);
    mockStorage.createPractice.mockResolvedValue({ id: 99, isDemo: true });
    mockStorage.getPatients.mockResolvedValue([]);

    await ensureDemoPractice();

    const upserts = mockStorage.upsertUser.mock.calls.map((c) => c[0]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      id: 'demo-therapist-99',
      practiceId: 99,
      role: 'therapist',
      email: DEMO_THERAPIST.email,
    });
    const appts = mockStorage.createAppointment.mock.calls.map((c) => c[0]);
    expect(appts.length).toBeGreaterThan(0);
    for (const a of appts) expect(a.therapistId).toBe('demo-therapist-99');
  });

  it('adds the therapist to an ALREADY seeded demo practice that has none, and only once', async () => {
    mockStorage.getDemoPractice.mockResolvedValue({ id: 99, isDemo: true });
    mockStorage.getPatients.mockResolvedValue([{ id: 1 }]);
    mockStorage.getPatientsByEmail.mockResolvedValue([{ id: 2, practiceId: 99 }]);

    await ensureDemoPractice();
    expect(mockStorage.upsertUser).toHaveBeenCalledTimes(1);
    expect(mockStorage.upsertUser.mock.calls[0][0]).toMatchObject({ id: 'demo-therapist-99', role: 'therapist' });

    // Next login: the therapist exists → nothing to upsert.
    mockStorage.upsertUser.mockClear();
    mockStorage.getTherapistsByPractice.mockResolvedValue([{ id: 'demo-therapist-99', role: 'therapist' }]);
    await ensureDemoPractice();
    expect(mockStorage.upsertUser).not.toHaveBeenCalled();
  });

  // ---- Seeded appointment times are practice wall clock, not process-zone ----

  it('seeds appointments at 9:00 AM practice time (America/New_York) regardless of the process timezone', async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'UTC'; // what ECS runs as
    try {
      mockStorage.getDemoPractice.mockResolvedValue(undefined);
      mockStorage.createPractice.mockResolvedValue({ id: 99, isDemo: true });
      mockStorage.getPatients.mockResolvedValue([]);

      await ensureDemoPractice();

      const appts = mockStorage.createAppointment.mock.calls.map((c) => c[0]);
      // Plan entry 0 is seeded at hour 9 + (0 % 6) = 9:00, offset -7 days.
      const first = appts[0];
      expect(first.startTime).toBeInstanceOf(Date);
      expect(zonedTimeString(first.startTime, 'America/New_York')).toBe('09:00');
      expect(zonedTimeString(first.endTime, 'America/New_York')).toBe('09:45');
      // Under the old setHours() seed this was 09:00 UTC = 04:00/05:00 Eastern.
      expect(first.startTime.getUTCHours()).not.toBe(9);
      // Offset -7 lands on the practice calendar day a week ago, not the UTC one.
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      expect(zonedDateString(first.startTime, 'America/New_York')).toBe(
        zonedDateString(weekAgo, 'America/New_York'),
      );
    } finally {
      if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
    }
  });

  // ---- One-time repair of appointments seeded at 09:00Z by the old code ----

  describe('repair of process-zone seeded appointments (PR #465 follow-up)', () => {
    const NY = 'America/New_York';
    // What the old seed wrote on a UTC ECS task for "9:00" and "12:00".
    const OLD_9 = new Date('2026-11-10T09:00:00.000Z'); // 4:00 AM EST
    const OLD_12_SUMMER = new Date('2026-07-14T12:00:00.000Z'); // 8:00 AM EDT
    // 14:00Z IS 9:00 AM EST -- exactly what the new seed (and a visitor
    // booking 9 AM) writes. Must never be touched.
    const NEW_9 = new Date('2026-11-10T14:00:00.000Z');
    const seeded = (id: number, start: Date, extra: any = {}) => ({
      id,
      practiceId: 99,
      title: 'Occupational Therapy',
      startTime: start,
      endTime: new Date(start.getTime() + 45 * 60 * 1000),
      therapistId: null,
      status: 'scheduled',
      ...extra,
    });

    it('isProcessZoneSeedTime: exact-hour 09:00Z-14:00Z instants at an absurd local hour, nothing else', () => {
      expect(isProcessZoneSeedTime(OLD_9, NY)).toBe(true);
      expect(isProcessZoneSeedTime(OLD_12_SUMMER, NY)).toBe(true);
      expect(isProcessZoneSeedTime(NEW_9, NY)).toBe(false);
      // Not on the hour → hand-made.
      expect(isProcessZoneSeedTime(new Date('2026-11-10T09:30:00.000Z'), NY)).toBe(false);
      // Outside the seed's hour band.
      expect(isProcessZoneSeedTime(new Date('2026-11-10T08:00:00.000Z'), NY)).toBe(false);
      expect(isProcessZoneSeedTime(new Date('2026-11-10T15:00:00.000Z'), NY)).toBe(false);
      // A UTC practice: old and new seed coincide, nothing is old-shaped.
      expect(isProcessZoneSeedTime(OLD_9, 'UTC')).toBe(false);
    });

    it('moves 09:00Z rows to 9:00 AM practice time on the same local day, keeps duration, assigns the therapist', async () => {
      mockStorage.getAppointments.mockResolvedValue([seeded(1, OLD_9), seeded(2, OLD_12_SUMMER)]);

      const out = await repairDemoSeededAppointments(99, 'demo-therapist-99');

      expect(out).toEqual({ retimed: 2, assigned: 2 });
      expect(mockStorage.getAppointments).toHaveBeenCalledWith(99);
      const [id1, p1] = mockStorage.updateAppointment.mock.calls[0];
      expect(id1).toBe(1);
      expect(zonedTimeString(p1.startTime, NY)).toBe('09:00');
      expect(zonedDateString(p1.startTime, NY)).toBe('2026-11-10');
      expect(p1.endTime.getTime() - p1.startTime.getTime()).toBe(45 * 60 * 1000);
      expect(p1.therapistId).toBe('demo-therapist-99');
      const [, p2] = mockStorage.updateAppointment.mock.calls[1];
      expect(zonedTimeString(p2.startTime, NY)).toBe('12:00');
      expect(zonedDateString(p2.startTime, NY)).toBe('2026-07-14');
    });

    it('leaves rows already at local 9:00 untouched and is a no-op on a second pass', async () => {
      mockStorage.getAppointments.mockResolvedValue([seeded(3, NEW_9, { therapistId: 'demo-therapist-99' })]);

      const out = await repairDemoSeededAppointments(99, 'demo-therapist-99');

      expect(out).toEqual({ retimed: 0, assigned: 0 });
      expect(mockStorage.updateAppointment).not.toHaveBeenCalled();
    });

    it('only assigns the therapist (no re-time) on a seeded row that is correctly timed but unassigned', async () => {
      mockStorage.getAppointments.mockResolvedValue([seeded(4, NEW_9)]);
      const out = await repairDemoSeededAppointments(99, 'demo-therapist-99');
      expect(out).toEqual({ retimed: 0, assigned: 1 });
      const [, patch] = mockStorage.updateAppointment.mock.calls[0];
      expect(patch).toEqual({ therapistId: 'demo-therapist-99' });
    });

    it('never touches an appointment a demo visitor created by hand (different title), even at an odd hour', async () => {
      mockStorage.getAppointments.mockResolvedValue([
        seeded(5, OLD_9, { title: 'Individual Therapy' }),
        seeded(6, OLD_9, { title: 'Speech Therapy' }),
      ]);
      const out = await repairDemoSeededAppointments(99, 'demo-therapist-99');
      expect(out).toEqual({ retimed: 0, assigned: 0 });
      expect(mockStorage.updateAppointment).not.toHaveBeenCalled();
    });

    it('runs from ensureDemoPractice, scoped to the demo practice id, on the already-seeded fast path', async () => {
      mockStorage.getDemoPractice.mockResolvedValue({ id: 99, isDemo: true });
      mockStorage.getPatients.mockResolvedValue([{ id: 1 }]);
      mockStorage.getPatientsByEmail.mockResolvedValue([{ id: 2, practiceId: 99 }]);
      mockStorage.getTherapistsByPractice.mockResolvedValue([{ id: 'demo-therapist-99', role: 'therapist' }]);
      mockStorage.getAppointments.mockResolvedValue([seeded(7, OLD_9)]);

      await ensureDemoPractice();

      expect(mockStorage.getAppointments).toHaveBeenCalledTimes(1);
      expect(mockStorage.getAppointments).toHaveBeenCalledWith(99);
      expect(mockStorage.updateAppointment).toHaveBeenCalledTimes(1);
      const [id, patch] = mockStorage.updateAppointment.mock.calls[0];
      expect(id).toBe(7);
      expect(zonedTimeString(patch.startTime, NY)).toBe('09:00');
      expect(patch.therapistId).toBe('demo-therapist-99');
    });

    it('a storage failure during repair is logged and does not break the demo login', async () => {
      mockStorage.getAppointments.mockRejectedValue(new Error('db down'));
      await expect(repairDemoSeededAppointments(99, 'demo-therapist-99')).resolves.toEqual({ retimed: 0, assigned: 0 });
    });
  });
});

describe('seeded claim dates (QA demo pass 2026-11-19, item 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let nextPatientId = 100;
    mockStorage.createPatient.mockImplementation(async () => ({ id: nextPatientId++ }));
    mockStorage.createAppointment.mockResolvedValue({ id: 1 });
    mockStorage.createClaim.mockResolvedValue({ id: 1 });
    mockStorage.getPatientsByEmail.mockResolvedValue([]);
    mockStorage.getAppointments.mockResolvedValue([]);
    mockStorage.getTherapistsByPractice.mockResolvedValue([{ id: 'demo-therapist-99', role: 'therapist' }]);
    mockStorage.getDemoPractice.mockResolvedValue(undefined);
    mockStorage.createPractice.mockResolvedValue({ id: 99, isDemo: true });
    mockStorage.getPatients.mockResolvedValue([]);
  });

  it('creates every claim before it is submitted, and submitted before it is paid', async () => {
    await ensureDemoPractice();
    const claims = mockStorage.createClaim.mock.calls.map((c) => c[0]);
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(claim.createdAt).toBeInstanceOf(Date);
      // Created at the end of the day of service, in the practice zone.
      // The claims table has no date-of-service column; the service day is the
      // created day, two days before submission for every seeded claim.
      expect(claim.dateOfService).toBeUndefined();
      if (claim.submittedAt) {
        expect(zonedDateString(zonedAddDays(claim.submittedAt, -DEMO_SEED_SUBMIT_OFFSET_DAYS, 'America/New_York'), 'America/New_York'))
          .toBe(zonedDateString(claim.createdAt, 'America/New_York'));
      }
      if (claim.submittedAt) expect(claim.createdAt.getTime()).toBeLessThan(claim.submittedAt.getTime());
      if (claim.paidAt) expect(claim.submittedAt.getTime()).toBeLessThan(claim.paidAt.getTime());
      expect(claim.updatedAt.getTime()).toBeGreaterThanOrEqual(claim.createdAt.getTime());
    }
    expect(claims.filter((c) => c.submittedAt).length).toBeGreaterThan(0);
  });

  it('repairs an already-seeded practice: only DEMO-* claims created after their own submittedAt', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 7 });
    const repaired = await repairDemoSeededClaimDates(99);
    expect(repaired).toBe(7);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(params).toEqual([99]);
    expect(sql).toMatch(/UPDATE claims/);
    expect(sql).toMatch(/claim_number LIKE 'DEMO-%'/);
    expect(sql).toMatch(/created_at > submitted_at/);
    expect(sql).toMatch(/created_at = submitted_at - interval '2 days'/);
  });

  it('runs both repairs on every login to an already-seeded practice', async () => {
    mockStorage.getDemoPractice.mockResolvedValue({ id: 99, isDemo: true });
    mockStorage.getPatients.mockResolvedValue([{ id: 1 }]);
    mockStorage.getPatientsByEmail.mockResolvedValue([{ id: 2, practiceId: 99 }]);
    await ensureDemoPractice();
    const sqls = mockPool.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((q) => q.includes('created_at > submitted_at'))).toBe(true);
    expect(sqls.some((q) => q.includes('FROM claims c') && q.includes('payment_postings'))).toBe(true);
  });
});

describe('ensureDemoPaymentRecords (QA demo pass 2026-11-19, item 1)', () => {
  const paidAt = new Date('2026-11-13T15:00:00.000Z');
  const paidClaim = {
    id: 42,
    claim_number: 'DEMO-99-1002',
    patient_id: 102,
    total_amount: '289.00',
    paid_amount: '246.65',
    paid_at: paidAt,
    submitted_at: new Date('2026-10-28T14:00:00.000Z'), // service day 2026-10-26 (two days earlier, Eastern)
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getPatient.mockResolvedValue({
      id: 102,
      practiceId: 99,
      firstName: 'Mia',
      lastName: 'Example',
      insuranceProvider: 'UnitedHealthcare',
      insuranceId: 'DEMO1002',
    });
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO remittance_advice/.test(sql)) return { rows: [{ id: 501 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
  });

  it('is a no-op when every paid demo claim already has a posting', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await ensureDemoPaymentRecords(99)).toBe(0);
    expect(mockPool.connect).not.toHaveBeenCalled();
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(params).toEqual([99]);
    expect(sql).toMatch(/status = 'paid'/);
    expect(sql).toMatch(/NOT EXISTS/);
  });

  it('writes the ERA, matched line item, posting and patient copay for a paid claim, in one transaction', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [paidClaim], rowCount: 1 });

    expect(await ensureDemoPaymentRecords(99)).toBe(1);

    const calls = mockClient.query.mock.calls.map(([sql, params]) => ({ sql: String(sql), params }));
    const order = calls.map((c) => c.sql.split(/\s+/).slice(0, 3).join(' '));
    expect(order[0]).toBe('BEGIN');
    expect(order[order.length - 1]).toBe('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);

    const era = calls.find((c) => /INSERT INTO remittance_advice/.test(c.sql))!;
    expect(era.sql).toMatch(/ON CONFLICT \(practice_id, file_hash\)/);
    expect(era.params).toEqual([
      99, '2026-11-13', 'UnitedHealthcare', 'DEMO-CHK-99-1002', '246.65', paidAt,
      demoEraFileHash(99, 'DEMO-99-1002'),
    ]);

    const line = calls.find((c) => /INSERT INTO remittance_line_items/.test(c.sql))!;
    const [remittanceId, claimId, patientName, memberId, serviceDate, cpt, charged, allowed, paid, adjustment, patientResp, contractual, reasonCodes, claimRef] = line.params;
    expect([remittanceId, claimId, serviceDate, cpt, claimRef]).toEqual([501, 42, '2026-10-26', '97530', 'DEMO-99-1002']);
    // PHI fields are stored encrypted and round-trip through the real decryptor.
    expect(patientName).not.toContain('Example');
    expect(decryptRemittanceLineItem({ patientName, memberId })).toMatchObject({ patientName: 'Example, Mia', memberId: 'DEMO1002' });
    expect([charged, allowed, paid, adjustment, patientResp, contractual]).toEqual([
      '289.00', '271.65', '246.65', '42.35', '25.00', '17.35',
    ]);
    // paid + patient responsibility + contractual write-off = charged
    expect(Number(paid) + Number(patientResp) + Number(contractual)).toBeCloseTo(Number(charged), 2);
    expect(JSON.parse(reasonCodes).map((r: any) => r.code)).toEqual(['CO-45', 'PR-3']);
    expect(line.sql).toMatch(/'matched', \$14, 'claim_number'/);

    const posting = calls.find((c) => /INSERT INTO payment_postings/.test(c.sql))!;
    expect(posting.params).toEqual([
      99, 42, 'UnitedHealthcare', 'DEMO-CHK-99-1002', '2026-11-13', '246.65',
      '17.35', '25.00', '271.65', paidAt,
    ]);
    expect(posting.sql).toMatch(/'era'/);

    const copay = calls.find((c) => /INSERT INTO payment_transactions/.test(c.sql))!;
    expect(copay.sql).toMatch(/'payment', 'copay'/);
    expect(copay.sql).toMatch(/'completed'/);
    expect(copay.params.slice(0, 4)).toEqual([102, 99, 42, String(DEMO_PATIENT_RESPONSIBILITY.toFixed(2))]);
    expect(zonedDateString(copay.params[5], 'America/New_York')).toBe('2026-11-15');
  });

  it('rolls back the claim and keeps going when a statement fails, without throwing', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [paidClaim], rowCount: 1 });
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO remittance_advice/.test(sql)) return { rows: [{ id: 501 }], rowCount: 1 };
      if (/INSERT INTO payment_postings/.test(sql)) throw new Error('boom');
      return { rows: [], rowCount: 1 };
    });
    expect(await ensureDemoPaymentRecords(99)).toBe(0);
    const sqls = mockClient.query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('skips a claim whose patient is not in the demo practice', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [paidClaim], rowCount: 1 });
    mockStorage.getPatient.mockResolvedValue({ id: 102, practiceId: 1, firstName: 'Real', lastName: 'Person' });
    expect(await ensureDemoPaymentRecords(99)).toBe(0);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });
});

describe('demo claim payers (QA demo pass 2026-11-19, item 8: DEMO-2-1006 payer "Unknown")', () => {
  const catalog = [
    { id: 1, name: 'Medicare' }, { id: 4, name: 'Aetna' }, { id: 5, name: 'Cigna' },
    { id: 6, name: 'UnitedHealth' }, { id: 3, name: 'Blue Cross Blue Shield' },
  ];

  it('maps the seeded chart plans to catalog rows, exact first, then by prefix, then by alias', () => {
    expect(matchDemoPayer('Aetna', catalog)).toBe(4);
    expect(matchDemoPayer('UnitedHealthcare', catalog)).toBe(6);
    expect(matchDemoPayer('Horizon BCBS of New Jersey', catalog)).toBe(3);
    expect(matchDemoPayer('Horizon BCBS of New Jersey', [...catalog, { id: 9, name: 'Horizon BCBS of NJ' }])).toBe(9);
    expect(matchDemoPayer('Some Unknown Plan', catalog)).toBeNull();
    expect(matchDemoPayer(null, catalog)).toBeNull();
  });

  it('links DEMO-* claims without a payer to their patient plan, once per patient, and leaves others alone', async () => {
    vi.clearAllMocks();
    mockStorage.getClaims.mockResolvedValue([
      { id: 1, claimNumber: 'DEMO-99-1000', patientId: 100, insuranceId: null },
      { id: 2, claimNumber: 'DEMO-99-1001', patientId: 100, insuranceId: null },
      { id: 3, claimNumber: 'DEMO-99-1002', patientId: 101, insuranceId: 4 },
      { id: 4, claimNumber: 'CLM-7', patientId: 102, insuranceId: null },
      { id: 5, claimNumber: 'DEMO-99-1003', patientId: 103, insuranceId: null },
    ]);
    mockStorage.getInsurances.mockResolvedValue(catalog);
    mockStorage.getPatient.mockImplementation(async (id: number) =>
      id === 100 ? { id, practiceId: 99, insuranceProvider: 'UnitedHealthcare' }
      : id === 103 ? { id, practiceId: 1, insuranceProvider: 'Aetna' }
      : undefined,
    );
    expect(await ensureDemoClaimPayers(99)).toBe(2);
    expect(mockStorage.updateClaim).toHaveBeenCalledTimes(2);
    expect(mockStorage.updateClaim).toHaveBeenCalledWith(1, { insuranceId: 6 });
    expect(mockStorage.updateClaim).toHaveBeenCalledWith(2, { insuranceId: 6 });
    expect(mockStorage.getPatient).toHaveBeenCalledTimes(2); // 100 once, 103 once
  });

  it('is a no-op (and does not load the catalog) when every demo claim has a payer', async () => {
    vi.clearAllMocks();
    mockStorage.getClaims.mockResolvedValue([{ id: 1, claimNumber: 'DEMO-99-1000', patientId: 100, insuranceId: 4 }]);
    expect(await ensureDemoClaimPayers(99)).toBe(0);
    expect(mockStorage.getInsurances).not.toHaveBeenCalled();
  });
});

describe('raw SQL in the demo repairs names only columns that exist (post-deploy 2026-11-19)', () => {
  // The payment backfill selected c.date_of_service from claims; that column
  // belongs to claim_line_items. Postgres refused the query, the catch-all
  // logged a warning, and the production demo got no payment rows. The unit
  // tests mocked pg and could not see it. This check runs every raw statement
  // the repairs issue through the mocks and verifies each column reference
  // against the Drizzle schema.
  const dbColumns = (table: any) => new Set(Object.values(getTableColumns(table)).map((c: any) => c.name as string));
  const tables: Record<string, Set<string>> = {
    claims: dbColumns(claims),
    remittance_advice: dbColumns(remittanceAdvice),
    remittance_line_items: dbColumns(remittanceLineItems),
    payment_postings: dbColumns(paymentPostings),
    payment_transactions: dbColumns(paymentTransactions),
    practice_cpt_rates: dbColumns(practiceCptRates),
  };

  function checkStatement(sql: string) {
    const problems: string[] = [];
    // INSERT INTO table (col, ...)
    for (const m of sql.matchAll(/INSERT INTO\s+(\w+)\s*\(([^)]*)\)/g)) {
      const cols = tables[m[1]];
      expect(cols, `unknown table ${m[1]}`).toBeDefined();
      for (const col of m[2].split(',').map((c) => c.trim()).filter(Boolean)) {
        if (!cols.has(col)) problems.push(`${m[1]}.${col}`);
      }
    }
    // UPDATE table SET ... / FROM table alias ... : alias.col and bare col = / IS / LIKE / >
    for (const m of sql.matchAll(/(?:UPDATE|FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?([a-z]))?/g)) {
      const cols = tables[m[1]];
      if (!cols) continue;
      const alias = m[2];
      if (alias) {
        for (const ref of sql.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))) {
          if (!cols.has(ref[1])) problems.push(`${m[1]}.${ref[1]} (as ${alias}.${ref[1]})`);
        }
      }
    }
    return problems;
  }

  it('every SELECT, INSERT and UPDATE the repairs issue references real columns', async () => {
    vi.clearAllMocks();
    const statements: string[] = [];
    mockPool.query.mockImplementation(async (sql: string) => {
      statements.push(String(sql));
      return /FROM claims c/.test(sql)
        ? { rows: [{ id: 42, claim_number: 'DEMO-99-1002', patient_id: 102, total_amount: '289.00', paid_amount: '246.65', paid_at: new Date('2026-11-13T15:00:00.000Z'), submitted_at: new Date('2026-10-28T14:00:00.000Z') }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    });
    mockClient.query.mockImplementation(async (sql: string) => {
      statements.push(String(sql));
      return /INSERT INTO remittance_advice/.test(sql) ? { rows: [{ id: 501 }], rowCount: 1 } : { rows: [], rowCount: 1 };
    });
    mockStorage.getPatient.mockResolvedValue({ id: 102, practiceId: 99, firstName: 'Mia', lastName: 'Example', insuranceProvider: 'UnitedHealthcare', insuranceId: 'DEMO1002' });

    expect(await ensureDemoPaymentRecords(99)).toBe(1);
    await repairDemoSeededClaimDates(99);
    await ensureDemoClaimPayers(99);
    // A demo seeded 30 days ago: every statement of the roll-forward runs too.
    mockPool.query.mockImplementationOnce(async (sql: string) => {
      statements.push(String(sql));
      return { rows: [{ newest_paid_at: new Date(Date.now() - 36 * 24 * 60 * 60 * 1000) }], rowCount: 1 };
    });
    await keepDemoDatesCurrent(99, 'demo-therapist-99');

    expect(statements.length).toBeGreaterThan(4);
    const problems = statements.flatMap(checkStatement);
    expect(problems).toEqual([]);
    // The exact regression: no statement touches claims.date_of_service.
    expect(statements.some((q) => /date_of_service/.test(q) && /FROM claims/.test(q))).toBe(false);
  });

  it('a statement naming a column that does not exist is caught by the guard', () => {
    expect(checkStatement('SELECT c.id, c.date_of_service FROM claims c WHERE c.practice_id = $1')).toEqual(['claims.date_of_service (as c.date_of_service)']);
    expect(checkStatement('INSERT INTO payment_postings (practice_id, bogus_col) VALUES ($1, $2)')).toEqual(['payment_postings.bogus_col']);
  });
});

describe('keepDemoDatesCurrent (post-deploy 2026-11-19: a demo seeded weeks ago shows empty month views)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getAppointments.mockResolvedValue([]);
    mockClient.query.mockImplementation(async () => ({ rows: [], rowCount: 1 }));
  });

  it('calendarDaysBetween counts whole days', () => {
    expect(calendarDaysBetween('2026-10-26', '2026-11-13')).toBe(18);
    expect(calendarDaysBetween('2026-11-13', '2026-11-13')).toBe(0);
    expect(calendarDaysBetween('2026-11-13', '2026-11-10')).toBe(-3);
  });

  it('is a no-op while the newest seeded payment is at its intended age', async () => {
    const newest = new Date(Date.now() + DEMO_NEWEST_PAID_OFFSET_DAYS * DAY);
    mockPool.query.mockResolvedValueOnce({ rows: [{ newest_paid_at: newest }], rowCount: 1 });
    expect(await keepDemoDatesCurrent(99, 'demo-therapist-99')).toBe(0);
    expect(mockPool.connect).not.toHaveBeenCalled();
    expect(mockStorage.updateAppointment).not.toHaveBeenCalled();
  });

  it('does nothing for a practice with no seeded paid claim', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ newest_paid_at: null }], rowCount: 1 });
    expect(await keepDemoDatesCurrent(99)).toBe(0);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('rolls every seeded row forward by the same whole number of days, in one transaction, and shifts seeded appointments in the practice zone', async () => {
    // Newest payment 24 days old (the live state on 2026-11-19): 18 days behind its intended 6.
    const newest = new Date(Date.now() - 24 * DAY);
    mockPool.query.mockResolvedValueOnce({ rows: [{ newest_paid_at: newest }], rowCount: 1 });
    const start = new Date('2026-11-05T15:00:00.000Z'); // 10:00 Eastern (EST)
    mockStorage.getAppointments.mockResolvedValue([
      { id: 1, title: 'Occupational Therapy', therapistId: 'demo-therapist-99', startTime: start, endTime: new Date(start.getTime() + 45 * 60 * 1000) },
      { id: 2, title: 'Hand-booked visit', therapistId: 'demo-therapist-99', startTime: start, endTime: null },
    ]);

    const drift = await keepDemoDatesCurrent(99, 'demo-therapist-99');
    expect(drift).toBe(18);

    const calls = mockClient.query.mock.calls.map(([sql, params]) => ({ sql: String(sql), params }));
    expect(calls[0].sql).toBe('BEGIN');
    expect(calls[calls.length - 1].sql).toBe('COMMIT');
    const updates = calls.filter((c) => /^UPDATE/.test(c.sql.trim()));
    expect(updates.map((c) => c.sql.trim().split(/\s+/)[1])).toEqual([
      'claims', 'remittance_line_items', 'remittance_advice', 'payment_postings', 'payment_transactions',
    ]);
    for (const u of updates) expect(u.params).toEqual([99, 18]);
    // Only seeded rows: DEMO-* claims, DEMO-CHK-* remittances/postings, the backfill's copays.
    expect(updates[0].sql).toMatch(/claim_number LIKE 'DEMO-%'/);
    expect(updates[2].sql).toMatch(/check_number LIKE 'DEMO-CHK-%'/);
    expect(updates[3].sql).toMatch(/check_number LIKE 'DEMO-CHK-%'/);
    expect(updates[4].sql).toMatch(/description LIKE 'Copay for date of service%'/);

    // The seeded appointment moved 18 days and kept its 10:00 Eastern start; the hand-booked one did not move.
    expect(mockStorage.updateAppointment).toHaveBeenCalledTimes(1);
    const [id, patch] = mockStorage.updateAppointment.mock.calls[0];
    expect(id).toBe(1);
    expect(zonedDateString(patch.startTime, 'America/New_York')).toBe('2026-11-23');
    expect(zonedTimeString(patch.startTime, 'America/New_York')).toBe('10:00');
    expect(patch.endTime.getTime() - patch.startTime.getTime()).toBe(45 * 60 * 1000);
  });

  it('rolls back and reports nothing shifted when a statement fails', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ newest_paid_at: new Date(Date.now() - 24 * DAY) }], rowCount: 1 });
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/UPDATE payment_postings/.test(sql)) throw new Error('boom');
      return { rows: [], rowCount: 1 };
    });
    expect(await keepDemoDatesCurrent(99)).toBe(0);
    const sqls = mockClient.query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(mockStorage.updateAppointment).not.toHaveBeenCalled();
  });
});
