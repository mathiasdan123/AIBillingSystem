import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock storage + logger + stediService before importing the module under test.
// The reaper exposes a `ReapDeps` injection seam so we can swap selectors /
// writers per-test without touching the DB or the network.
// ---------------------------------------------------------------------------

const mockGetAllPracticeIds = vi.fn();
const mockCreateAuditLog = vi.fn();

vi.mock('../storage', () => ({
  storage: {
    getAllPracticeIds: (...a: any[]) => mockGetAllPracticeIds(...a),
    createAuditLog: (...a: any[]) => mockCreateAuditLog(...a),
  },
}));

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// stediService.checkClaimStatus is injected per-test; we still need the named
// type exports + the function as a callable for the default deps path.
vi.mock('../services/stediService', () => ({
  checkClaimStatus: vi.fn(),
}));

// The db module is touched by the default selector / writer functions, which
// we always override in tests. Mock it so importing the service doesn't open
// a connection.
vi.mock('../db', () => ({ db: {} }));

// Mock the denial pipeline so we can assert it's called without executing it.
const mockRunDenialPipeline = vi.fn();
vi.mock('../services/denialPipelineService', () => ({
  runDenialPipeline: (...a: any[]) => mockRunDenialPipeline(...a),
}));

import {
  runClaimStatusReap,
  mapStediBucketToReaperStatus,
  type StaleClaimRow,
} from '../services/claimStatusReaperService';

function row(overrides: Partial<StaleClaimRow> = {}): StaleClaimRow {
  return {
    id: 1,
    practiceId: 1,
    patientId: 100,
    insuranceId: 10,
    claimNumber: 'CLM-001',
    clearinghouseClaimId: 'STEDI-001',
    status: 'submitted',
    totalAmount: '150.00',
    submittedAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48h ago
    lastStatusCheckAt: null,
    patientFirstName: 'Jane',
    patientLastName: 'Doe',
    patientDateOfBirth: '1990-01-01',
    patientInsuranceId: 'MEMBER123',
    insurancePayerCode: '60054',
    insuranceName: 'Aetna',
    practiceNpi: '1234567890',
    practiceTaxId: '12-3456789',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllPracticeIds.mockResolvedValue([1]);
  mockCreateAuditLog.mockResolvedValue({ id: 1 });
  mockRunDenialPipeline.mockResolvedValue(undefined);
});

describe('mapStediBucketToReaperStatus', () => {
  it('maps Stedi buckets to the 4-value reaper enum', () => {
    expect(mapStediBucketToReaperStatus('paid')).toBe('paid');
    expect(mapStediBucketToReaperStatus('finalized_denied')).toBe('denied');
    expect(mapStediBucketToReaperStatus('pending')).toBe('pending');
    expect(mapStediBucketToReaperStatus('received')).toBe('pending');
    expect(mapStediBucketToReaperStatus('returned_for_correction')).toBe('pending');
    // Rejection-likes stay 'submitted' so the biller fixes & resubmits
    expect(mapStediBucketToReaperStatus('rejected')).toBe('submitted');
    expect(mapStediBucketToReaperStatus('rejected_invalid_data')).toBe('submitted');
    expect(mapStediBucketToReaperStatus('error_submission')).toBe('submitted');
    expect(mapStediBucketToReaperStatus('unknown')).toBe('submitted');
  });
});

describe('runClaimStatusReap', () => {
  it('only polls claims that pass the selector filter (submitted + older than threshold)', async () => {
    // The selector is the filter. Pass two stale rows in to confirm the
    // reaper polls each one exactly once and respects the cutoff that gets
    // handed to the selector.
    const getStaleSubmittedClaims = vi.fn(async (pid: number, cutoff: Date) => {
      expect(pid).toBe(1);
      // Default olderThanHours = 24 → cutoff ≈ now - 24h
      const expected = Date.now() - 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5_000);
      return [row({ id: 1 }), row({ id: 2, claimNumber: 'CLM-002' })];
    });
    const checker = vi.fn().mockResolvedValue({
      claimId: 'x',
      status: 'pending',
      raw: {},
    });
    const applyClaimTransition = vi.fn();
    const recordStatusCheck = vi.fn();
    const markPolled = vi.fn();

    const result = await runClaimStatusReap(
      {},
      {
        checkClaimStatus: checker as any,
        getStaleSubmittedClaims,
        applyClaimTransition,
        recordStatusCheck,
        markPolled,
      },
    );

    expect(checker).toHaveBeenCalledTimes(2);
    expect(result.totals.polled).toBe(2);
    expect(result.totals.transitionedToPending).toBe(2);
    expect(markPolled).toHaveBeenCalledTimes(2);
  });

  it('transitions a claim to paid on a Stedi "paid" bucket', async () => {
    const getStaleSubmittedClaims = vi.fn().mockResolvedValue([row()]);
    const checker = vi.fn().mockResolvedValue({
      claimId: 'CLM-001',
      status: 'paid',
      statusCategoryCode: 'F1',
      statusCategoryValue: 'Finalized / Payment complete',
      paidAmount: 120.5,
      paidDate: '2026-05-27',
      raw: { ok: true },
    });
    const applyClaimTransition = vi.fn();
    const recordStatusCheck = vi.fn();

    const result = await runClaimStatusReap(
      {},
      {
        checkClaimStatus: checker as any,
        getStaleSubmittedClaims,
        applyClaimTransition,
        recordStatusCheck,
        markPolled: vi.fn(),
      },
    );

    expect(applyClaimTransition).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: 'paid',
        paidAmount: '120.5',
        clearinghouseStatus: 'F1',
      }),
    );
    expect(recordStatusCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        claimId: 1,
        previousStatus: 'submitted',
        newStatus: 'paid',
        statusCategoryCode: 'F1',
      }),
    );
    expect(result.totals.transitionedToPaid).toBe(1);
    expect(result.totals.unchanged).toBe(0);
  });

  it('transitions a claim to denied on a Stedi "finalized_denied" bucket and stashes the reason', async () => {
    const getStaleSubmittedClaims = vi.fn().mockResolvedValue([row()]);
    const checker = vi.fn().mockResolvedValue({
      claimId: 'CLM-001',
      status: 'finalized_denied',
      statusCategoryCode: 'F4',
      statusCategoryValue: 'Finalized / Denied',
      denialReason: 'Service not covered under plan',
      raw: {},
    });
    const applyClaimTransition = vi.fn();

    const result = await runClaimStatusReap(
      {},
      {
        checkClaimStatus: checker as any,
        getStaleSubmittedClaims,
        applyClaimTransition,
        recordStatusCheck: vi.fn(),
        markPolled: vi.fn(),
      },
    );

    expect(applyClaimTransition).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: 'denied',
        denialReason: 'Service not covered under plan',
      }),
    );
    expect(result.totals.transitionedToDenied).toBe(1);
    // Denied claim ID collected in the practice summary
    expect(result.practices[0].deniedClaimIds).toEqual([1]);
  });

  it('transitions a claim to pending on a Stedi "pending" bucket', async () => {
    const getStaleSubmittedClaims = vi.fn().mockResolvedValue([row()]);
    const checker = vi.fn().mockResolvedValue({
      claimId: 'CLM-001',
      status: 'pending',
      statusCategoryCode: 'P1',
      raw: {},
    });
    const applyClaimTransition = vi.fn();

    const result = await runClaimStatusReap(
      {},
      {
        checkClaimStatus: checker as any,
        getStaleSubmittedClaims,
        applyClaimTransition,
        recordStatusCheck: vi.fn(),
        markPolled: vi.fn(),
      },
    );

    expect(applyClaimTransition).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'pending' }),
    );
    expect(result.totals.transitionedToPending).toBe(1);
  });

  it('counts unchanged when Stedi returns "unknown" or a rejection (stays "submitted")', async () => {
    const getStaleSubmittedClaims = vi.fn().mockResolvedValue([
      row({ id: 1 }),
      row({ id: 2 }),
    ]);
    const checker = vi
      .fn()
      .mockResolvedValueOnce({ claimId: 'x', status: 'unknown', raw: {} })
      .mockResolvedValueOnce({ claimId: 'x', status: 'rejected', raw: {} });
    const applyClaimTransition = vi.fn();

    const result = await runClaimStatusReap(
      {},
      {
        checkClaimStatus: checker as any,
        getStaleSubmittedClaims,
        applyClaimTransition,
        recordStatusCheck: vi.fn(),
        markPolled: vi.fn(),
      },
    );

    expect(applyClaimTransition).not.toHaveBeenCalled();
    expect(result.totals.unchanged).toBe(2);
    expect(result.totals.transitionedToPaid).toBe(0);
  });

  it('tolerates per-claim errors — one bad Stedi call does not break the rest', async () => {
    const getStaleSubmittedClaims = vi.fn().mockResolvedValue([
      row({ id: 1 }),
      row({ id: 2, claimNumber: 'CLM-002' }),
      row({ id: 3, claimNumber: 'CLM-003' }),
    ]);
    const checker = vi
      .fn()
      .mockResolvedValueOnce({ claimId: 'x', status: 'paid', paidAmount: 10, raw: {} })
      .mockRejectedValueOnce(new Error('Stedi 502 Bad Gateway'))
      .mockResolvedValueOnce({ claimId: 'x', status: 'pending', raw: {} });
    const markPolled = vi.fn();

    const result = await runClaimStatusReap(
      {},
      {
        checkClaimStatus: checker as any,
        getStaleSubmittedClaims,
        applyClaimTransition: vi.fn(),
        recordStatusCheck: vi.fn(),
        markPolled,
      },
    );

    expect(checker).toHaveBeenCalledTimes(3);
    expect(result.totals.polled).toBe(3);
    expect(result.totals.transitionedToPaid).toBe(1);
    expect(result.totals.transitionedToPending).toBe(1);
    expect(result.totals.errors).toBe(1);
    expect(result.practices[0].errors[0].error).toContain('Stedi 502');
    // Even the errored claim was marked polled so it doesn't get
    // re-attempted within the same window.
    expect(markPolled).toHaveBeenCalledTimes(3);
  });

  it('is idempotent across re-runs — the selector filters out already-polled claims', async () => {
    // The selector is the source of truth for "what to reap". Simulate the
    // real DB filter: when a claim's lastStatusCheckAt is fresher than the
    // cutoff, the selector simply omits it from the result set.
    const getStaleSubmittedClaims = vi.fn(async (_pid: number, cutoff: Date) => {
      const fresh = row({
        id: 99,
        lastStatusCheckAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1h ago
      });
      // Filter the way the SQL where-clause does
      const lastCheck = fresh.lastStatusCheckAt;
      if (lastCheck && lastCheck >= cutoff) return [];
      return [fresh];
    });
    const checker = vi.fn();

    const result = await runClaimStatusReap(
      {},
      {
        checkClaimStatus: checker as any,
        getStaleSubmittedClaims,
        applyClaimTransition: vi.fn(),
        recordStatusCheck: vi.fn(),
        markPolled: vi.fn(),
      },
    );

    expect(checker).not.toHaveBeenCalled();
    expect(result.totals.polled).toBe(0);
  });

  it('writes an audit_log row per practice with eventCategory=claim_status_reap', async () => {
    const getStaleSubmittedClaims = vi.fn().mockResolvedValue([row()]);
    const checker = vi.fn().mockResolvedValue({ status: 'paid', raw: {}, paidAmount: 50 });

    await runClaimStatusReap(
      {},
      {
        checkClaimStatus: checker as any,
        getStaleSubmittedClaims,
        applyClaimTransition: vi.fn(),
        recordStatusCheck: vi.fn(),
        markPolled: vi.fn(),
      },
    );

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCategory: 'claim_status_reap',
        eventType: 'reap_completed',
        practiceId: 1,
        details: expect.objectContaining({
          polled: 1,
          transitionedToPaid: 1,
        }),
      }),
    );
  });

  it('scopes to a single practice when practiceId is supplied', async () => {
    const getStaleSubmittedClaims = vi.fn().mockResolvedValue([]);
    await runClaimStatusReap(
      { practiceId: 42, olderThanHours: 48 },
      {
        checkClaimStatus: vi.fn() as any,
        getStaleSubmittedClaims,
        applyClaimTransition: vi.fn(),
        recordStatusCheck: vi.fn(),
        markPolled: vi.fn(),
      },
    );

    expect(mockGetAllPracticeIds).not.toHaveBeenCalled();
    expect(getStaleSubmittedClaims).toHaveBeenCalledWith(42, expect.any(Date));
    const cutoff = getStaleSubmittedClaims.mock.calls[0][1] as Date;
    const expected = Date.now() - 48 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5_000);
  });

  it('catches missing-required-field errors at the per-claim level (does not throw)', async () => {
    const getStaleSubmittedClaims = vi.fn().mockResolvedValue([
      row({ id: 1, claimNumber: null }), // missing claimNumber → throws inside processClaim
      row({ id: 2 }),
    ]);
    const checker = vi.fn().mockResolvedValue({ status: 'paid', raw: {}, paidAmount: 1 });

    const result = await runClaimStatusReap(
      {},
      {
        checkClaimStatus: checker as any,
        getStaleSubmittedClaims,
        applyClaimTransition: vi.fn(),
        recordStatusCheck: vi.fn(),
        markPolled: vi.fn(),
      },
    );

    // Bad claim contributed one error; good claim still transitioned.
    expect(result.totals.errors).toBe(1);
    expect(result.totals.transitionedToPaid).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Denial pipeline handoff
  // ---------------------------------------------------------------------------

  it('calls runDenialPipeline with denied claim IDs after the reap', async () => {
    // Two claims — one denied, one paid — only the denied one feeds the pipeline.
    const getStaleSubmittedClaims = vi.fn().mockResolvedValue([
      row({ id: 10, claimNumber: 'CLM-010' }),
      row({ id: 11, claimNumber: 'CLM-011' }),
    ]);
    const checker = vi
      .fn()
      .mockResolvedValueOnce({
        claimId: 'CLM-010',
        status: 'finalized_denied',
        denialReason: 'Not medically necessary',
        raw: {},
      })
      .mockResolvedValueOnce({
        claimId: 'CLM-011',
        status: 'paid',
        paidAmount: 100,
        raw: {},
      });

    await runClaimStatusReap(
      {},
      {
        checkClaimStatus: checker as any,
        getStaleSubmittedClaims,
        applyClaimTransition: vi.fn(),
        recordStatusCheck: vi.fn(),
        markPolled: vi.fn(),
      },
    );

    expect(mockRunDenialPipeline).toHaveBeenCalledOnce();
    expect(mockRunDenialPipeline).toHaveBeenCalledWith([10]);
  });

  it('aggregates denied claim IDs across multiple practices', async () => {
    // Two practices, each returning one denied claim.
    mockGetAllPracticeIds.mockResolvedValue([1, 2]);
    const getStaleSubmittedClaims = vi.fn(async (pid: number) => [
      row({ id: pid === 1 ? 21 : 22, practiceId: pid }),
    ]);
    const checker = vi.fn().mockResolvedValue({
      status: 'finalized_denied',
      denialReason: 'Excluded service',
      raw: {},
    });

    await runClaimStatusReap(
      {},
      {
        checkClaimStatus: checker as any,
        getStaleSubmittedClaims,
        applyClaimTransition: vi.fn(),
        recordStatusCheck: vi.fn(),
        markPolled: vi.fn(),
      },
    );

    expect(mockRunDenialPipeline).toHaveBeenCalledOnce();
    // IDs from both practices are merged
    expect(mockRunDenialPipeline).toHaveBeenCalledWith(expect.arrayContaining([21, 22]));
    expect(mockRunDenialPipeline.mock.calls[0][0]).toHaveLength(2);
  });

  it('does NOT call runDenialPipeline when no claims are denied', async () => {
    const getStaleSubmittedClaims = vi.fn().mockResolvedValue([row({ id: 30 })]);
    const checker = vi.fn().mockResolvedValue({ status: 'paid', paidAmount: 50, raw: {} });

    await runClaimStatusReap(
      {},
      {
        checkClaimStatus: checker as any,
        getStaleSubmittedClaims,
        applyClaimTransition: vi.fn(),
        recordStatusCheck: vi.fn(),
        markPolled: vi.fn(),
      },
    );

    expect(mockRunDenialPipeline).not.toHaveBeenCalled();
  });

  it('does NOT call runDenialPipeline when no stale claims exist', async () => {
    const getStaleSubmittedClaims = vi.fn().mockResolvedValue([]);

    await runClaimStatusReap(
      {},
      {
        checkClaimStatus: vi.fn() as any,
        getStaleSubmittedClaims,
        applyClaimTransition: vi.fn(),
        recordStatusCheck: vi.fn(),
        markPolled: vi.fn(),
      },
    );

    expect(mockRunDenialPipeline).not.toHaveBeenCalled();
  });

  it('continues normally if runDenialPipeline throws — reap result is still returned', async () => {
    const getStaleSubmittedClaims = vi.fn().mockResolvedValue([row({ id: 40 })]);
    const checker = vi.fn().mockResolvedValue({
      status: 'finalized_denied',
      denialReason: 'Plan lapsed',
      raw: {},
    });
    mockRunDenialPipeline.mockRejectedValueOnce(new Error('Pipeline boom'));

    const result = await runClaimStatusReap(
      {},
      {
        checkClaimStatus: checker as any,
        getStaleSubmittedClaims,
        applyClaimTransition: vi.fn(),
        recordStatusCheck: vi.fn(),
        markPolled: vi.fn(),
      },
    );

    // The reap itself still succeeded and reported the denial.
    expect(result.totals.transitionedToDenied).toBe(1);
    // Pipeline was attempted
    expect(mockRunDenialPipeline).toHaveBeenCalledWith([40]);
  });
});
