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

import { ensureDemoPractice } from '../services/demoPractice';

describe('ensureDemoPractice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let nextPatientId = 100;
    mockStorage.createPatient.mockImplementation(async () => ({ id: nextPatientId++ }));
    mockStorage.createAppointment.mockResolvedValue({ id: 1 });
    mockStorage.createClaim.mockResolvedValue({ id: 1 });
    // Default: no fixture patient exists yet.
    mockStorage.getPatientsByEmail.mockResolvedValue([]);
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
});
