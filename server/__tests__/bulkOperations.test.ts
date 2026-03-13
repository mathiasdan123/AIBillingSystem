import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock functions before vi.mock calls
const getClaim = vi.fn();
const getClaims = vi.fn();
const updateClaim = vi.fn();

// Mock storage module
vi.mock('../storage', () => ({
  storage: {
    getClaim: (id: number) => getClaim(id),
    getClaims: (practiceId: number) => getClaims(practiceId),
    updateClaim: (id: number, data: any) => updateClaim(id, data),
  },
}));

// Mock logger
vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  bulkSubmitClaims,
  bulkUpdateClaimStatus,
  bulkExportClaims,
} from '../services/bulkOperationsService';
import type { Claim } from '../../shared/schema';

// Helper to create a mock claim
function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 1,
    practiceId: 1,
    patientId: 10,
    sessionId: null,
    claimNumber: 'CLM-001',
    insuranceId: null,
    totalAmount: '150.00',
    submittedAmount: null,
    paidAmount: null,
    expectedAmount: null,
    optimizedAmount: null,
    status: 'draft',
    submittedAt: null,
    paidAt: null,
    denialReason: null,
    aiReviewScore: null,
    aiReviewNotes: null,
    reimbursementOptimizationId: null,
    clearinghouseClaimId: null,
    clearinghouseStatus: null,
    clearinghouseResponse: null,
    clearinghouseSubmittedAt: null,
    billingOrder: 'primary',
    primaryClaimId: null,
    primaryPaidAmount: null,
    primaryAdjustmentAmount: null,
    cobData: null,
    denialPrediction: null,
    createdAt: new Date('2026-01-15T00:00:00Z'),
    updatedAt: new Date('2026-01-15T00:00:00Z'),
    ...overrides,
  } as Claim;
}

describe('bulkSubmitClaims', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should submit all valid draft claims', async () => {
    const claim1 = makeClaim({ id: 1, practiceId: 1, status: 'draft' });
    const claim2 = makeClaim({ id: 2, practiceId: 1, status: 'draft', claimNumber: 'CLM-002' });

    getClaim.mockImplementation((id: number) => {
      if (id === 1) return claim1;
      if (id === 2) return claim2;
      return undefined;
    });
    updateClaim.mockResolvedValue({});

    const results = await bulkSubmitClaims([1, 2], 1);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(expect.objectContaining({ claimId: 1, success: true }));
    expect(results[1]).toEqual(expect.objectContaining({ claimId: 2, success: true }));
    expect(updateClaim).toHaveBeenCalledTimes(2);
  });

  it('should reject claims not belonging to the practice', async () => {
    const claim = makeClaim({ id: 1, practiceId: 2, status: 'draft' });
    getClaim.mockResolvedValue(claim);

    const results = await bulkSubmitClaims([1], 1);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('does not belong to this practice');
    expect(updateClaim).not.toHaveBeenCalled();
  });

  it('should reject non-draft claims', async () => {
    const claim = makeClaim({ id: 1, practiceId: 1, status: 'submitted' });
    getClaim.mockResolvedValue(claim);

    const results = await bulkSubmitClaims([1], 1);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain("'submitted' status");
  });

  it('should handle claim not found', async () => {
    getClaim.mockResolvedValue(undefined);

    const results = await bulkSubmitClaims([999], 1);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Claim not found');
  });

  it('should handle partial failures - one succeeds, one fails', async () => {
    const draftClaim = makeClaim({ id: 1, practiceId: 1, status: 'draft' });
    const submittedClaim = makeClaim({ id: 2, practiceId: 1, status: 'paid' });

    getClaim.mockImplementation((id: number) => {
      if (id === 1) return draftClaim;
      if (id === 2) return submittedClaim;
      return undefined;
    });
    updateClaim.mockResolvedValue({});

    const results = await bulkSubmitClaims([1, 2], 1);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(updateClaim).toHaveBeenCalledTimes(1);
  });

  it('should handle storage error during update without stopping batch', async () => {
    const claim1 = makeClaim({ id: 1, practiceId: 1, status: 'draft' });
    const claim2 = makeClaim({ id: 2, practiceId: 1, status: 'draft', claimNumber: 'CLM-002' });

    getClaim.mockImplementation((id: number) => {
      if (id === 1) return claim1;
      if (id === 2) return claim2;
      return undefined;
    });
    updateClaim
      .mockRejectedValueOnce(new Error('Database error'))
      .mockResolvedValueOnce({});

    const results = await bulkSubmitClaims([1, 2], 1);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Database error');
    expect(results[1].success).toBe(true);
  });
});

describe('bulkUpdateClaimStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should update status for all valid claims', async () => {
    const claim1 = makeClaim({ id: 1, practiceId: 1 });
    const claim2 = makeClaim({ id: 2, practiceId: 1 });

    getClaim.mockImplementation((id: number) => {
      if (id === 1) return claim1;
      if (id === 2) return claim2;
      return undefined;
    });
    updateClaim.mockResolvedValue({});

    const results = await bulkUpdateClaimStatus([1, 2], 'paid', 1);

    expect(results).toHaveLength(2);
    expect(results.every(r => r.success)).toBe(true);
    expect(updateClaim).toHaveBeenCalledTimes(2);
    // Verify paidAt is set for 'paid' status
    expect(updateClaim).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'paid', paidAt: expect.any(Date) }));
  });

  it('should reject invalid status for all claims', async () => {
    const results = await bulkUpdateClaimStatus([1, 2], 'invalid_status', 1);

    expect(results).toHaveLength(2);
    expect(results.every(r => !r.success)).toBe(true);
    expect(results[0].error).toContain("Invalid status 'invalid_status'");
    expect(getClaim).not.toHaveBeenCalled();
  });

  it('should handle claim not found', async () => {
    getClaim.mockResolvedValue(undefined);

    const results = await bulkUpdateClaimStatus([999], 'draft', 1);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Claim not found');
  });

  it('should reject claims from other practices', async () => {
    const claim = makeClaim({ id: 1, practiceId: 99 });
    getClaim.mockResolvedValue(claim);

    const results = await bulkUpdateClaimStatus([1], 'submitted', 1);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('does not belong to this practice');
  });

  it('should handle partial failures gracefully', async () => {
    const claim1 = makeClaim({ id: 1, practiceId: 1 });
    const claim2 = makeClaim({ id: 2, practiceId: 1 });

    getClaim.mockImplementation((id: number) => {
      if (id === 1) return claim1;
      if (id === 2) return claim2;
      return undefined;
    });
    updateClaim
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Connection lost'));

    const results = await bulkUpdateClaimStatus([1, 2], 'denied', 1);

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toBe('Connection lost');
  });

  it('should set submittedAt when status is submitted', async () => {
    const claim = makeClaim({ id: 1, practiceId: 1 });
    getClaim.mockResolvedValue(claim);
    updateClaim.mockResolvedValue({});

    await bulkUpdateClaimStatus([1], 'submitted', 1);

    expect(updateClaim).toHaveBeenCalledWith(1, expect.objectContaining({
      status: 'submitted',
      submittedAt: expect.any(Date),
    }));
  });
});

describe('bulkExportClaims', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleClaims: Claim[] = [
    makeClaim({
      id: 1,
      claimNumber: 'CLM-001',
      patientId: 10,
      status: 'draft',
      totalAmount: '100.00',
      createdAt: new Date('2026-01-10T00:00:00Z'),
    }),
    makeClaim({
      id: 2,
      claimNumber: 'CLM-002',
      patientId: 11,
      status: 'submitted',
      totalAmount: '200.00',
      submittedAmount: '200.00',
      createdAt: new Date('2026-02-15T00:00:00Z'),
      submittedAt: new Date('2026-02-16T00:00:00Z'),
    }),
    makeClaim({
      id: 3,
      claimNumber: 'CLM-003',
      patientId: 12,
      status: 'paid',
      totalAmount: '300.00',
      paidAmount: '280.00',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      paidAt: new Date('2026-03-10T00:00:00Z'),
    }),
  ];

  it('should export all claims as CSV with headers', async () => {
    getClaims.mockResolvedValue(sampleClaims);

    const csv = await bulkExportClaims(1, {});

    const lines = csv.split('\n');
    expect(lines[0]).toBe('ID,Claim Number,Patient ID,Status,Total Amount,Submitted Amount,Paid Amount,Billing Order,Created At,Submitted At,Paid At');
    expect(lines).toHaveLength(4); // header + 3 rows
    expect(lines[1]).toContain('CLM-001');
    expect(lines[2]).toContain('CLM-002');
    expect(lines[3]).toContain('CLM-003');
  });

  it('should filter by status', async () => {
    getClaims.mockResolvedValue(sampleClaims);

    const csv = await bulkExportClaims(1, { status: 'paid' });

    const lines = csv.split('\n');
    expect(lines).toHaveLength(2); // header + 1 matching row
    expect(lines[1]).toContain('CLM-003');
  });

  it('should filter by dateFrom', async () => {
    getClaims.mockResolvedValue(sampleClaims);

    const csv = await bulkExportClaims(1, { dateFrom: '2026-02-01' });

    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 matching rows
    expect(lines[1]).toContain('CLM-002');
    expect(lines[2]).toContain('CLM-003');
  });

  it('should filter by dateTo', async () => {
    getClaims.mockResolvedValue(sampleClaims);

    const csv = await bulkExportClaims(1, { dateTo: '2026-01-31' });

    const lines = csv.split('\n');
    expect(lines).toHaveLength(2); // header + 1 matching row
    expect(lines[1]).toContain('CLM-001');
  });

  it('should return only headers when no claims match filters', async () => {
    getClaims.mockResolvedValue(sampleClaims);

    const csv = await bulkExportClaims(1, { status: 'nonexistent' });

    const lines = csv.split('\n');
    expect(lines).toHaveLength(1); // header only
  });

  it('should escape CSV values containing commas', async () => {
    const claimWithComma = makeClaim({
      id: 1,
      claimNumber: 'CLM,WITH,COMMAS',
      status: 'draft',
      createdAt: new Date('2026-01-10T00:00:00Z'),
    });
    getClaims.mockResolvedValue([claimWithComma]);

    const csv = await bulkExportClaims(1, {});

    const lines = csv.split('\n');
    expect(lines[1]).toContain('"CLM,WITH,COMMAS"');
  });

  it('should handle empty claims list', async () => {
    getClaims.mockResolvedValue([]);

    const csv = await bulkExportClaims(1, {});

    const lines = csv.split('\n');
    expect(lines).toHaveLength(1); // header only
  });
});
