import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbState: { selects: any[][]; inserts: any[] } = {
  selects: [],
  inserts: [],
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
          return { then: (resolve: any) => resolve([]) };
        },
      }),
    },
  };
});

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import {
  ensureUnderpaymentFollowUp,
  generateUnderpaymentFollowUps,
  generateUnderpaymentFollowUpsForAllPractices,
} from '../services/underpaymentPipelineService';

beforeEach(() => {
  vi.clearAllMocks();
  mockDbState.selects = [];
  mockDbState.inserts = [];
});

describe('underpaymentPipelineService.ensureUnderpaymentFollowUp', () => {
  it('ignores gaps at or below the noise threshold', async () => {
    const created = await ensureUnderpaymentFollowUp({
      claimId: 1,
      practiceId: 7,
      expectedAmount: 100,
      paidAmount: 96, // $4 gap
    });
    expect(created).toBe(false);
    expect(mockDbState.inserts).toHaveLength(0);
  });

  it('does not create a duplicate when an active follow-up exists', async () => {
    mockDbState.selects = [[{ id: 1 }]];
    const created = await ensureUnderpaymentFollowUp({
      claimId: 1,
      practiceId: 7,
      expectedAmount: 100,
      paidAmount: 50,
    });
    expect(created).toBe(false);
    expect(mockDbState.inserts).toHaveLength(0);
  });

  it('creates an urgent follow-up for a large underpayment', async () => {
    mockDbState.selects = [[]];
    const created = await ensureUnderpaymentFollowUp({
      claimId: 1,
      practiceId: 7,
      claimNumber: 'CLM-1',
      expectedAmount: 200,
      paidAmount: 50, // $150 gap
    });
    expect(created).toBe(true);
    expect(mockDbState.inserts).toHaveLength(1);
    expect(mockDbState.inserts[0].vals).toMatchObject({
      claimId: 1,
      followUpType: 'underpayment',
      priority: 'urgent',
    });
  });

  it.each([
    [60, 'high'],
    [30, 'medium'],
    [10, 'low'],
  ])('maps a $%d gap to %s priority', async (gap, expectedPriority) => {
    mockDbState.selects = [[]];
    await ensureUnderpaymentFollowUp({
      claimId: 1,
      practiceId: 7,
      expectedAmount: 100,
      paidAmount: 100 - gap,
    });
    expect(mockDbState.inserts[0].vals.priority).toBe(expectedPriority);
  });
});

describe('underpaymentPipelineService.generateUnderpaymentFollowUps', () => {
  it('creates a follow-up for each underpaid claim found', async () => {
    mockDbState.selects = [
      // sweep query result
      [{ id: 1, claimNumber: 'CLM-1', expectedAmount: '100', paidAmount: '40' }],
      // ensureUnderpaymentFollowUp's existing-follow-up check
      [],
    ];
    const created = await generateUnderpaymentFollowUps(7);
    expect(created).toBe(1);
    expect(mockDbState.inserts).toHaveLength(1);
  });

  it('creates nothing when no claims are underpaid', async () => {
    mockDbState.selects = [[]];
    const created = await generateUnderpaymentFollowUps(7);
    expect(created).toBe(0);
  });
});

describe('underpaymentPipelineService.generateUnderpaymentFollowUpsForAllPractices', () => {
  it('handles an empty practice list', async () => {
    mockDbState.selects = [[]];
    const result = await generateUnderpaymentFollowUpsForAllPractices();
    expect(result).toEqual({ practices: 0, followUpsCreated: 0 });
  });
});
