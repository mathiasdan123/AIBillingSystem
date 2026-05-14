import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Chainable db mock. `mockDbState.selects` is a FIFO queue consumed in call
 * order: analyzeClaimForFixes does (1) claim lookup, (2) line-item lookup;
 * applyAutoFixableCorrections then adds (3) existing-corrections lookup.
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
          return { then: (resolve: any) => resolve([]) };
        },
      }),
      update: (table: any) => ({
        set: (data: any) => ({
          where: () => {
            mockDbState.updates.push({ table, data });
            return { then: (resolve: any) => resolve([]) };
          },
        }),
      }),
    },
  };
});

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import {
  analyzeClaimForFixes,
  applyAutoFixableCorrections,
} from '../services/claimAutoFixService';

const deniedClaim = { id: 1, status: 'denied', practiceId: 7, denialReason: '' };

beforeEach(() => {
  vi.clearAllMocks();
  mockDbState.selects = [];
  mockDbState.inserts = [];
  mockDbState.updates = [];
});

describe('claimAutoFixService.analyzeClaimForFixes', () => {
  it('returns nothing when the claim does not exist', async () => {
    mockDbState.selects = [[]];
    expect(await analyzeClaimForFixes(1)).toEqual([]);
  });

  it('returns nothing when the claim is not denied', async () => {
    mockDbState.selects = [[{ id: 1, status: 'paid' }]];
    expect(await analyzeClaimForFixes(1)).toEqual([]);
  });

  it('emits an advisory (non-auto-applicable) correction from the denial text', async () => {
    mockDbState.selects = [
      [{ ...deniedClaim, denialReason: 'claim denied: missing modifier' }],
      [], // no line items
    ];
    const corrections = await analyzeClaimForFixes(1);
    expect(corrections).toHaveLength(1);
    expect(corrections[0].correctionType).toBe('modifier_fix');
    expect(corrections[0].autoApplicable).toBeFalsy();
  });

  it('flags a missing therapy modifier as auto-applicable when discipline is known', async () => {
    mockDbState.selects = [
      [deniedClaim],
      [
        {
          id: 10,
          cptCodeId: 1,
          icd10CodeId: 50,
          modifier: null,
          cptCode: '97110',
          therapyCategory: 'PT',
        },
      ],
    ];
    const corrections = await analyzeClaimForFixes(1);
    expect(corrections).toHaveLength(1);
    expect(corrections[0].autoApplicable).toBe(true);
    expect(corrections[0].apply).toEqual({ field: 'modifier', value: 'GP' });
    expect(corrections[0].lineItemId).toBe(10);
  });

  it('does not auto-apply when a modifier is present but not the expected one', async () => {
    mockDbState.selects = [
      [deniedClaim],
      [
        {
          id: 10,
          cptCodeId: 1,
          icd10CodeId: 50,
          modifier: '59',
          cptCode: '97165',
          therapyCategory: 'OT',
        },
      ],
    ];
    const corrections = await analyzeClaimForFixes(1);
    expect(corrections).toHaveLength(1);
    expect(corrections[0].autoApplicable).toBeFalsy();
  });

  it('backfills a missing line-item diagnosis from an unambiguous sibling', async () => {
    mockDbState.selects = [
      [deniedClaim],
      [
        { id: 10, cptCodeId: 1, icd10CodeId: null, modifier: 'GP', cptCode: '97110', therapyCategory: 'PT' },
        { id: 11, cptCodeId: 2, icd10CodeId: 50, modifier: 'GP', cptCode: '97140', therapyCategory: 'PT' },
      ],
    ];
    const corrections = await analyzeClaimForFixes(1);
    const dxFix = corrections.find(c => c.correctionType === 'info_update');
    expect(dxFix?.autoApplicable).toBe(true);
    expect(dxFix?.apply).toEqual({ field: 'icd10CodeId', value: 50 });
  });

  it('does not auto-apply a missing diagnosis when there is no sibling to copy', async () => {
    mockDbState.selects = [
      [deniedClaim],
      [
        { id: 10, cptCodeId: 1, icd10CodeId: null, modifier: 'GP', cptCode: '97110', therapyCategory: 'PT' },
      ],
    ];
    const corrections = await analyzeClaimForFixes(1);
    const dxFix = corrections.find(c => c.correctionType === 'info_update');
    expect(dxFix?.autoApplicable).toBeFalsy();
  });
});

describe('claimAutoFixService.applyAutoFixableCorrections', () => {
  it('applies the fix to the line item and persists an `applied` correction', async () => {
    mockDbState.selects = [
      [deniedClaim], // analyze: claim
      [
        { id: 10, cptCodeId: 1, icd10CodeId: 50, modifier: null, cptCode: '97110', therapyCategory: 'PT' },
      ], // analyze: line items
      [], // applyAutoFixableCorrections: no existing corrections
    ];

    const result = await applyAutoFixableCorrections(1, 7);

    expect(result.fixesApplied).toBe(1);
    expect(result.correctionsPersisted).toBe(1);
    // Line item was updated with the GP modifier.
    expect(mockDbState.updates).toHaveLength(1);
    expect(mockDbState.updates[0].data).toEqual({ modifier: 'GP' });
    // Correction persisted as `applied`.
    expect(mockDbState.inserts).toHaveLength(1);
    expect(mockDbState.inserts[0].vals.status).toBe('applied');
  });

  it('dedupes against corrections already persisted for the claim', async () => {
    mockDbState.selects = [
      [deniedClaim],
      [
        { id: 10, cptCodeId: 1, icd10CodeId: 50, modifier: null, cptCode: '97110', therapyCategory: 'PT' },
      ],
      [
        // Same type + suggestedValue the analyzer will produce → skipped.
        {
          correctionType: 'modifier_fix',
          suggestedValue: 'Add GP modifier (PT discipline)',
        },
      ],
    ];

    const result = await applyAutoFixableCorrections(1, 7);

    expect(result.fixesApplied).toBe(0);
    expect(result.correctionsPersisted).toBe(0);
    expect(mockDbState.updates).toHaveLength(0);
    expect(mockDbState.inserts).toHaveLength(0);
  });
});
