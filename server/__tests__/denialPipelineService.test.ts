import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Chainable db mock. `mockDbState.selects` is a FIFO queue — each awaited
 * select chain resolves to the next entry. Inserts/updates are captured.
 */
const mockDbState: { selects: any[][]; inserts: any[]; updates: any[] } = {
  selects: [],
  inserts: [],
  updates: [],
};

vi.mock('../db', () => {
  const makeSelectChain = () => {
    const chain: any = {};
    const pass = () => chain;
    chain.from = pass;
    chain.leftJoin = pass;
    chain.innerJoin = pass;
    chain.where = pass;
    chain.orderBy = pass;
    chain.limit = pass;
    chain.then = (resolve: any) => resolve(mockDbState.selects.shift() ?? []);
    return chain;
  };
  return {
    db: {
      select: () => makeSelectChain(),
      insert: (table: any) => ({
        values: (vals: any) => {
          mockDbState.inserts.push({ table, vals });
          return {
            then: (resolve: any) => resolve([]),
            returning: () => ({ then: (resolve: any) => resolve([{ id: 999 }]) }),
          };
        },
      }),
    },
  };
});

// vi.hoisted: these are referenced inside vi.mock factories, which are
// hoisted above normal declarations — so they must be hoisted too.
const { mockStorage, mockGenerateAppeal, mockApplyAutoFix } = vi.hoisted(() => ({
  mockStorage: {
    getClaim: vi.fn(),
    getAppealsByClaimId: vi.fn(),
    getPatient: vi.fn(),
    getClaimLineItems: vi.fn(),
    createAppeal: vi.fn(),
  },
  mockGenerateAppeal: vi.fn(),
  mockApplyAutoFix: vi.fn(),
}));

vi.mock('../storage', () => ({ storage: mockStorage }));

vi.mock('../aiAppealGenerator', () => ({
  appealGenerator: { generateAppeal: mockGenerateAppeal },
}));

vi.mock('../services/claimAutoFixService', () => ({
  applyAutoFixableCorrections: mockApplyAutoFix,
}));

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { processDeniedClaim, runDenialPipeline } from '../services/denialPipelineService';

const deniedClaim = {
  id: 1,
  status: 'denied',
  practiceId: 7,
  patientId: 5,
  claimNumber: 'CLM-1',
  denialReason: 'medical necessity',
  totalAmount: '200.00',
};

function primeHappyPath() {
  mockStorage.getClaim.mockResolvedValue({ ...deniedClaim });
  mockStorage.getAppealsByClaimId.mockResolvedValue([]);
  mockStorage.getPatient.mockResolvedValue({
    firstName: 'A',
    lastName: 'B',
    dateOfBirth: '1990-01-01',
    insuranceProvider: 'X',
    insuranceId: '123',
  });
  mockStorage.getClaimLineItems.mockResolvedValue([]);
  mockGenerateAppeal.mockResolvedValue({
    appealLetter: 'Dear payer...',
    denialCategory: 'medical_necessity',
    keyArguments: ['arg1'],
    successProbability: 60,
    suggestedActions: [],
  });
  mockStorage.createAppeal.mockResolvedValue({ id: 42 });
  mockApplyAutoFix.mockResolvedValue({
    claimId: 1,
    correctionsFound: 0,
    correctionsPersisted: 0,
    fixesApplied: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDbState.selects = [];
  mockDbState.inserts = [];
  mockDbState.updates = [];
});

describe('denialPipelineService.processDeniedClaim', () => {
  it('skips when the claim does not exist', async () => {
    mockStorage.getClaim.mockResolvedValue(undefined);
    const result = await processDeniedClaim(1);
    expect(result.skippedReason).toBe('claim_not_found');
    expect(result.appealCreated).toBe(false);
    expect(mockStorage.createAppeal).not.toHaveBeenCalled();
  });

  it('skips when the claim is not denied', async () => {
    mockStorage.getClaim.mockResolvedValue({ ...deniedClaim, status: 'paid' });
    const result = await processDeniedClaim(1);
    expect(result.skippedReason).toBe('claim_status_paid');
    expect(result.appealCreated).toBe(false);
  });

  it('drafts an appeal, follow-up and runs auto-fix on the happy path', async () => {
    primeHappyPath();
    mockDbState.selects = [[]]; // ensureDenialFollowUp: no existing follow-up

    const result = await processDeniedClaim(1);

    expect(result.appealCreated).toBe(true);
    expect(result.appealId).toBe(42);
    expect(result.followUpCreated).toBe(true);
    expect(result.autoFixesApplied).toBe(0);
    // Appeal is persisted as `ready` — drafted but not yet submitted.
    expect(mockStorage.createAppeal).toHaveBeenCalledWith(
      expect.objectContaining({ claimId: 1, status: 'ready', practiceId: 7 }),
    );
    // One follow-up insert captured.
    expect(mockDbState.inserts).toHaveLength(1);
    expect(mockApplyAutoFix).toHaveBeenCalledWith(1, 7);
  });

  it('does not draft a second appeal when one already exists', async () => {
    primeHappyPath();
    mockStorage.getAppealsByClaimId.mockResolvedValue([{ id: 7 }]);
    mockDbState.selects = [[]]; // follow-up still gets created

    const result = await processDeniedClaim(1);

    expect(result.appealCreated).toBe(false);
    expect(result.skippedReason).toBe('appeal_exists');
    expect(result.appealId).toBe(7);
    expect(mockStorage.createAppeal).not.toHaveBeenCalled();
    expect(result.followUpCreated).toBe(true);
  });

  it('does not create a duplicate follow-up when an active one exists', async () => {
    primeHappyPath();
    mockStorage.getAppealsByClaimId.mockResolvedValue([{ id: 7 }]);
    mockDbState.selects = [[{ id: 99 }]]; // ensureDenialFollowUp finds an active one

    const result = await processDeniedClaim(1);

    expect(result.followUpCreated).toBe(false);
    expect(mockDbState.inserts).toHaveLength(0);
  });
});

describe('denialPipelineService.runDenialPipeline', () => {
  it('returns an empty array for no claim ids', async () => {
    const results = await runDenialPipeline([]);
    expect(results).toEqual([]);
  });

  it('processes each claim id and returns one result per claim', async () => {
    primeHappyPath();
    mockDbState.selects = [[]]; // single claim, single follow-up check
    const results = await runDenialPipeline([1]);
    expect(results).toHaveLength(1);
    expect(results[0].claimId).toBe(1);
    expect(results[0].appealCreated).toBe(true);
  });
});
