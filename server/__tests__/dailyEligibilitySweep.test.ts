import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock storage before importing the module under test. Each test resets the
// mocks to a baseline practice + appointment dataset.
// ---------------------------------------------------------------------------

const mockGetAllPracticeIds = vi.fn();
const mockGetPractice = vi.fn();
const mockGetPatient = vi.fn();
const mockGetInsurances = vi.fn();
const mockGetAppointmentsNeedingEligibilityCheck = vi.fn();
const mockGetPatientEligibility = vi.fn();
const mockCreateEligibilityCheck = vi.fn();
const mockCreateAuditLog = vi.fn();

vi.mock('../storage', () => ({
  storage: {
    getAllPracticeIds: (...a: any[]) => mockGetAllPracticeIds(...a),
    getPractice: (...a: any[]) => mockGetPractice(...a),
    getPatient: (...a: any[]) => mockGetPatient(...a),
    getInsurances: (...a: any[]) => mockGetInsurances(...a),
    getAppointmentsNeedingEligibilityCheck: (...a: any[]) =>
      mockGetAppointmentsNeedingEligibilityCheck(...a),
    getPatientEligibility: (...a: any[]) => mockGetPatientEligibility(...a),
    createEligibilityCheck: (...a: any[]) => mockCreateEligibilityCheck(...a),
    createAuditLog: (...a: any[]) => mockCreateAuditLog(...a),
  },
}));

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// We don't want stediService to touch the network. We only need the helper
// pure functions; the actual checkEligibility is injected by the test.
vi.mock('../services/stediService', async () => {
  return {
    checkEligibility: vi.fn(),
    stcsForSpecialty: (s: string | null | undefined) =>
      s === 'MH' ? ['MH', '30'] : ['30'],
    extractReturnedStcsFromRawStediResponse: (raw: any) =>
      Array.isArray(raw?.returnedStcs) ? raw.returnedStcs : [],
    isStcDowngrade: (_sent: string[], _returned: string[]) => false,
  };
});

import { runDailyEligibilitySweep } from '../services/dailyEligibilitySweepService';

const PRACTICE = {
  id: 1,
  name: 'Test Practice',
  npi: '1234567890',
  specialty: 'MH',
};
const AETNA = { id: 10, name: 'Aetna', payerCode: '60054' };
const UHC = { id: 11, name: 'UHC', payerCode: '87726' };

function patient(overrides: any = {}) {
  return {
    id: 100,
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-01-01',
    insuranceId: 'MEMBER123',
    insuranceProvider: 'Aetna',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllPracticeIds.mockResolvedValue([1]);
  mockGetPractice.mockResolvedValue(PRACTICE);
  mockGetInsurances.mockResolvedValue([AETNA, UHC]);
  mockGetPatientEligibility.mockResolvedValue(undefined);
  mockCreateEligibilityCheck.mockResolvedValue({ id: 1 });
  mockCreateAuditLog.mockResolvedValue({ id: 1 });
});

describe('runDailyEligibilitySweep', () => {
  it('only sweeps patients with appointments in window AND active insurance', async () => {
    // Storage helper already filters to patients with insuranceId — our
    // contract is to trust it and call checkEligibility once per patient.
    mockGetAppointmentsNeedingEligibilityCheck.mockResolvedValue([
      { id: 1, patientId: 100 },
      { id: 2, patientId: 100 }, // duplicate patient → de-dupe to one check
      { id: 3, patientId: 200 },
    ]);
    mockGetPatient.mockImplementation(async (id: number) => {
      if (id === 100) return patient();
      if (id === 200) return patient({ id: 200, insuranceId: null }); // no insurance → skip
      return null;
    });

    const checker = vi.fn().mockResolvedValue({
      status: 'active',
      raw: { ok: true },
      copay: { primary: 25 },
      deductible: { individual: 500 },
      coinsurance: 20,
    });

    const result = await runDailyEligibilitySweep({}, { checkEligibility: checker as any });

    expect(checker).toHaveBeenCalledTimes(1);
    expect(mockCreateEligibilityCheck).toHaveBeenCalledTimes(1);
    expect(result.totals.attempted).toBe(1);
    expect(result.totals.succeeded).toBe(1);
    expect(result.totals.skipped).toBe(1);
  });

  it('records inactive coverage as a flagged row with status="inactive"', async () => {
    mockGetAppointmentsNeedingEligibilityCheck.mockResolvedValue([{ id: 1, patientId: 100 }]);
    mockGetPatient.mockResolvedValue(patient());

    const checker = vi.fn().mockResolvedValue({ status: 'inactive', raw: {} });
    const result = await runDailyEligibilitySweep({}, { checkEligibility: checker as any });

    expect(mockCreateEligibilityCheck).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'inactive', processingStatus: 'completed' }),
    );
    expect(result.totals.inactiveFound).toBe(1);
  });

  it('tolerates per-patient Stedi errors — one bad payer does not abort the sweep', async () => {
    mockGetAppointmentsNeedingEligibilityCheck.mockResolvedValue([
      { id: 1, patientId: 100 },
      { id: 2, patientId: 101 },
      { id: 3, patientId: 102 },
    ]);
    mockGetPatient.mockImplementation(async (id: number) =>
      patient({ id, firstName: `P${id}` }),
    );

    const checker = vi
      .fn()
      .mockResolvedValueOnce({ status: 'active', raw: {} })
      .mockRejectedValueOnce(new Error('Stedi 502 from Aetna'))
      .mockResolvedValueOnce({ status: 'active', raw: {} });

    const result = await runDailyEligibilitySweep({}, { checkEligibility: checker as any });

    expect(checker).toHaveBeenCalledTimes(3);
    expect(result.totals.succeeded).toBe(2);
    expect(result.totals.failed).toBe(1);
    expect(result.practices[0].errors).toHaveLength(1);
    expect(result.practices[0].errors[0].error).toContain('Stedi 502');

    // Failure row also written (status='unknown', processingStatus='error')
    expect(mockCreateEligibilityCheck).toHaveBeenCalledWith(
      expect.objectContaining({ processingStatus: 'error', status: 'unknown' }),
    );
  });

  it('is idempotent — re-running the same window does not double-insert', async () => {
    mockGetAppointmentsNeedingEligibilityCheck.mockResolvedValue([{ id: 1, patientId: 100 }]);
    mockGetPatient.mockResolvedValue(patient());
    // Simulate a completed check from earlier today
    mockGetPatientEligibility.mockResolvedValue({
      checkDate: new Date().toISOString(),
      processingStatus: 'completed',
      insuranceId: AETNA.id,
    });

    const checker = vi.fn().mockResolvedValue({ status: 'active', raw: {} });
    const result = await runDailyEligibilitySweep({}, { checkEligibility: checker as any });

    expect(checker).not.toHaveBeenCalled();
    expect(mockCreateEligibilityCheck).not.toHaveBeenCalled();
    expect(result.totals.skipped).toBe(1);
    expect(result.totals.attempted).toBe(0);
  });

  it('writes an audit_log row per practice on completion', async () => {
    mockGetAppointmentsNeedingEligibilityCheck.mockResolvedValue([{ id: 1, patientId: 100 }]);
    mockGetPatient.mockResolvedValue(patient());
    const checker = vi.fn().mockResolvedValue({ status: 'active', raw: {} });

    await runDailyEligibilitySweep({}, { checkEligibility: checker as any });

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCategory: 'eligibility_sweep',
        eventType: 'sweep_completed',
        practiceId: 1,
      }),
    );
  });

  it('scopes to a single practice when practiceId is supplied', async () => {
    mockGetAppointmentsNeedingEligibilityCheck.mockResolvedValue([]);

    await runDailyEligibilitySweep({ practiceId: 42 }, {
      checkEligibility: vi.fn() as any,
    });

    expect(mockGetAllPracticeIds).not.toHaveBeenCalled();
    expect(mockGetAppointmentsNeedingEligibilityCheck).toHaveBeenCalledWith(42, 7 * 24);
  });
});
