import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need a chainable mock that handles the full Drizzle pipeline:
//   db.select(...).from(...).innerJoin(...).where(...).orderBy(...).limit(...)
//   db.select(...).from(...).where(...).limit(...)
// The trick: every method returns the same chainable object, and the chain
// resolves when awaited. Each test pushes the row set the next chain should
// resolve to via `mockChain.__resolveWith(rows)`.

const queue: any[][] = [];

function makeChain() {
  const chain: any = {};
  const passthrough = () => chain;
  chain.select = passthrough;
  chain.from = passthrough;
  chain.innerJoin = passthrough;
  chain.where = passthrough;
  chain.orderBy = passthrough;
  chain.limit = passthrough;
  // thenable behavior — resolves with the next queued row set
  chain.then = (resolve: any, reject: any) => {
    try {
      const rows = queue.shift() ?? [];
      resolve(rows);
    } catch (e) {
      reject(e);
    }
  };
  return chain;
}

const chain = makeChain();

vi.mock('../db', () => ({
  db: {
    select: () => chain,
  },
}));

vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  findApprovalPrecedents,
  findPrecedentsForDeniedClaim,
  formatPrecedentsForAppeal,
  type ClaimPrecedent,
} from '../services/claimPrecedentService';

beforeEach(() => {
  queue.length = 0;
  vi.clearAllMocks();
});

describe('findApprovalPrecedents', () => {
  it('returns empty array when required args are missing', async () => {
    expect(await findApprovalPrecedents({ practiceId: 0 as any, patientId: 1, cptCode: '97530' })).toEqual([]);
    expect(await findApprovalPrecedents({ practiceId: 1, patientId: 0 as any, cptCode: '97530' })).toEqual([]);
    expect(await findApprovalPrecedents({ practiceId: 1, patientId: 1, cptCode: '' })).toEqual([]);
  });

  it('returns empty when the CPT code does not exist in our cpt_codes table', async () => {
    queue.push([]); // CPT lookup returns no row
    const result = await findApprovalPrecedents({
      practiceId: 1,
      patientId: 10,
      cptCode: 'NONEXISTENT',
    });
    expect(result).toEqual([]);
  });

  it('returns mapped precedents for a known CPT', async () => {
    queue.push([{ id: 42 }]); // CPT lookup
    queue.push([
      {
        claimId: 100,
        claimNumber: 'CLM-100',
        insuranceId: 5,
        paidAmount: '289.00',
        paidAt: new Date('2026-01-15T00:00:00Z'),
        createdAt: new Date('2026-01-10T00:00:00Z'),
        dateOfService: '2026-01-10',
        units: 1,
        modifier: 'GP',
      },
      {
        claimId: 101,
        claimNumber: 'CLM-101',
        insuranceId: 5,
        paidAmount: '289.00',
        paidAt: new Date('2026-02-12T00:00:00Z'),
        createdAt: new Date('2026-02-10T00:00:00Z'),
        dateOfService: '2026-02-10',
        units: 1,
        modifier: null,
      },
    ]);

    const result = await findApprovalPrecedents({
      practiceId: 1,
      patientId: 10,
      insuranceId: 5,
      cptCode: '97530',
      daysBack: 365,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      claimId: 100,
      claimNumber: 'CLM-100',
      insuranceId: 5,
      paidAmount: 289,
      cptCode: '97530',
      units: 1,
      modifier: 'GP',
    });
    expect(result[1]).toMatchObject({
      claimId: 101,
      paidAmount: 289,
      modifier: undefined, // null becomes undefined
    });
  });

  it('looks up ICD when diagnosisCode is provided', async () => {
    queue.push([{ id: 42 }]); // CPT lookup
    queue.push([{ id: 99 }]); // ICD lookup
    queue.push([]); // claims query (empty for this test)

    const result = await findApprovalPrecedents({
      practiceId: 1,
      patientId: 10,
      cptCode: '97530',
      diagnosisCode: 'F84.0',
    });

    expect(result).toEqual([]);
  });

  it('falls through to CPT-only matching when ICD does not exist', async () => {
    queue.push([{ id: 42 }]); // CPT lookup
    queue.push([]); // ICD lookup empty — service should NOT crash
    queue.push([
      {
        claimId: 200,
        claimNumber: 'CLM-200',
        insuranceId: null,
        paidAmount: '150.00',
        paidAt: null,
        createdAt: new Date('2026-03-01'),
        dateOfService: null,
        units: 2,
        modifier: null,
      },
    ]);

    const result = await findApprovalPrecedents({
      practiceId: 1,
      patientId: 10,
      cptCode: '97530',
      diagnosisCode: 'INVALID-ICD',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      claimId: 200,
      paidAmount: 150,
      units: 2,
    });
  });

  it('handles null paidAmount gracefully', async () => {
    queue.push([{ id: 42 }]); // CPT
    queue.push([
      {
        claimId: 300,
        claimNumber: null,
        insuranceId: 5,
        paidAmount: null,
        paidAt: new Date('2026-01-01'),
        createdAt: new Date('2026-01-01'),
        dateOfService: '2026-01-01',
        units: 1,
        modifier: null,
      },
    ]);

    const result = await findApprovalPrecedents({
      practiceId: 1,
      patientId: 10,
      cptCode: '97530',
    });
    expect(result[0].paidAmount).toBeNull();
    expect(result[0].claimNumber).toBeNull();
  });
});

describe('findPrecedentsForDeniedClaim', () => {
  it('returns map with one entry per CPT that has precedents', async () => {
    // First CPT lookup + claims query
    queue.push([{ id: 1 }]);
    queue.push([
      {
        claimId: 100,
        claimNumber: 'A',
        insuranceId: 5,
        paidAmount: '100',
        paidAt: new Date(),
        createdAt: new Date(),
        dateOfService: '2026-01-01',
        units: 1,
        modifier: null,
      },
    ]);
    // Second CPT lookup + claims query (empty)
    queue.push([{ id: 2 }]);
    queue.push([]);

    const map = await findPrecedentsForDeniedClaim({
      practiceId: 1,
      patientId: 10,
      cptCodes: ['97530', '97110'],
    });

    expect(map.size).toBe(1);
    expect(map.get('97530')).toHaveLength(1);
    expect(map.has('97110')).toBe(false);
  });

  it('handles empty CPT array', async () => {
    const map = await findPrecedentsForDeniedClaim({
      practiceId: 1,
      patientId: 10,
      cptCodes: [],
    });
    expect(map.size).toBe(0);
  });
});

describe('formatPrecedentsForAppeal', () => {
  it('returns empty string when no precedents', () => {
    expect(formatPrecedentsForAppeal([])).toBe('');
  });

  it('formats a single precedent with all fields', () => {
    const p: ClaimPrecedent = {
      claimId: 100,
      claimNumber: 'CLM-100',
      insuranceId: 5,
      paidAmount: 289,
      paidAt: new Date('2026-01-15T00:00:00Z'),
      dateOfService: '2026-01-10',
      cptCode: '97530',
      diagnosisCode: 'F84.0',
      units: 1,
    };
    const result = formatPrecedentsForAppeal([p]);
    expect(result).toContain('1 prior claim');
    expect(result).toContain('claim #CLM-100');
    expect(result).toContain('CPT 97530');
    expect(result).toContain('diagnosis F84.0');
    expect(result).toContain('date of service 2026-01-10');
    expect(result).toContain('paid 2026-01-15');
    expect(result).toContain('amount $289.00');
  });

  it('uses plural language for multiple precedents', () => {
    const ps: ClaimPrecedent[] = [
      { claimId: 1, claimNumber: 'A', insuranceId: 5, paidAmount: 100, paidAt: new Date(), dateOfService: '2026-01-01', cptCode: '97530', units: 1 },
      { claimId: 2, claimNumber: 'B', insuranceId: 5, paidAmount: 100, paidAt: new Date(), dateOfService: '2026-02-01', cptCode: '97530', units: 1 },
    ];
    const result = formatPrecedentsForAppeal(ps);
    expect(result).toContain('2 prior claims');
    expect(result).toContain('establish a payment precedent');
  });

  it('caps at 5 precedents in formatted output', () => {
    const ps: ClaimPrecedent[] = Array.from({ length: 10 }, (_, i) => ({
      claimId: i,
      claimNumber: `CLM-${i}`,
      insuranceId: 5,
      paidAmount: 100,
      paidAt: new Date(),
      dateOfService: `2026-01-${String(i + 1).padStart(2, '0')}`,
      cptCode: '97530',
      units: 1,
    }));
    const result = formatPrecedentsForAppeal(ps);
    // Header still says "10 prior claims" (the count is real)
    expect(result).toContain('10 prior claims');
    // But only 5 detail lines appear
    expect(result.split('\n  - ')).toHaveLength(6); // header + 5 lines
  });
});
