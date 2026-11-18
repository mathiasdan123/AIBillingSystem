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

import { ensureDemoPractice, DEMO_THERAPIST, isProcessZoneSeedTime, repairDemoSeededAppointments } from '../services/demoPractice';
import { zonedDateString } from '../utils/timezone';
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
