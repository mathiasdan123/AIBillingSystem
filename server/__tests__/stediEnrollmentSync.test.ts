import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock storage + stediService BEFORE importing the service under test, so the
// imported module picks up our fakes when invoked without explicit deps.
// ---------------------------------------------------------------------------

const mockGetAllPracticeIds = vi.fn();

vi.mock('../storage', () => ({
  storage: {
    getAllPracticeIds: (...a: any[]) => mockGetAllPracticeIds(...a),
  },
}));

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockGetStediApiKeyForPractice = vi.fn(async () => ({
  apiKey: 'test_key',
  isSandbox: true,
}));
vi.mock('../services/stediService', () => ({
  getStediApiKeyForPractice: (...a: any[]) => mockGetStediApiKeyForPractice(...a),
}));

// db is dep-injected from tests, but the import path needs to resolve so we
// stub it out — the real module would try to open a DB connection at import.
vi.mock('../db', () => ({ db: {} }));

import {
  syncStediEnrollments,
  mapStediStatus,
  mapStediTransactionType,
  normalizeStediResponse,
  type StediEnrollmentRow,
} from '../services/stediEnrollmentSyncService';

// ---------------------------------------------------------------------------
// Tiny in-memory drizzle stub. Records insert/update calls and supports the
// exact fluent shape the service uses. We sequence "which row will be looked
// up next" via a queue, primed in dbForRows() based on the incoming rows.
// ---------------------------------------------------------------------------

type FakeRow = {
  id: number;
  practiceId: number;
  payerName: string;
  payerId: string | null;
  transactionType: 'eligibility' | 'claims' | 'era';
  status: 'not_enrolled' | 'pending' | 'enrolled' | 'rejected';
  notes: string | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
};

function dbForRows(initialRows: FakeRow[] = []) {
  const rows = [...initialRows];
  let nextId = (rows[rows.length - 1]?.id ?? 0) + 1;
  const inserts: any[] = [];
  const updates: Array<{ id: number; set: any }> = [];

  // Queues primed by the test runner: each select/update consumes one entry
  // so the fake "knows" which row the service is operating on.
  const lookupQueue: Array<{
    practiceId: number;
    payerName: string;
    transactionType: string;
  }> = [];
  const updateQueue: Array<{ id: number }> = [];

  const fakeDb = {
    __rows: rows,
    __inserts: inserts,
    __updates: updates,
    __lookupQueue: lookupQueue,
    __updateQueue: updateQueue,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            const w = lookupQueue.shift();
            if (!w) return [];
            const found = rows.find(
              (r) =>
                r.practiceId === w.practiceId &&
                r.payerName === w.payerName &&
                r.transactionType === w.transactionType,
            );
            return found ? [found] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        const newRow: FakeRow = {
          id: nextId++,
          practiceId: v.practiceId,
          payerName: v.payerName,
          payerId: v.payerId ?? null,
          transactionType: v.transactionType,
          status: v.status,
          notes: v.notes ?? null,
          approvedAt: v.approvedAt ?? null,
          rejectedAt: v.rejectedAt ?? null,
          rejectionReason: v.rejectionReason ?? null,
        };
        rows.push(newRow);
        inserts.push(v);
        return Promise.resolve([newRow]);
      },
    }),
    update: () => ({
      set: (data: any) => ({
        where: () => {
          const w = updateQueue.shift();
          if (!w) return Promise.resolve([]);
          const found = rows.find((r) => r.id === w.id);
          if (found) {
            Object.assign(found, data);
            updates.push({ id: found.id, set: data });
          }
          return Promise.resolve(found ? [found] : []);
        },
      }),
    }),
  };
  return fakeDb;
}

/**
 * Prime the fake's queues based on what the service will do per incoming
 * row: it always does select → then either insert OR update.
 */
async function runSync(opts: {
  practiceId?: number;
  incoming: StediEnrollmentRow[];
  initialRows?: FakeRow[];
}) {
  const fakeDb = dbForRows(opts.initialRows ?? []);
  const practiceId = opts.practiceId ?? 1;
  for (const row of opts.incoming) {
    fakeDb.__lookupQueue.push({
      practiceId,
      payerName: row.payerName,
      transactionType: row.transactionType,
    });
    // If a matching existing row exists, the service may also call update.
    const existing = fakeDb.__rows.find(
      (r) =>
        r.practiceId === practiceId &&
        r.payerName === row.payerName &&
        r.transactionType === row.transactionType,
    );
    if (existing) fakeDb.__updateQueue.push({ id: existing.id });
  }
  const result = await syncStediEnrollments(
    { practiceId },
    {
      fetchEnrollments: async () => opts.incoming,
      db: fakeDb as any,
    },
  );
  return { result, fakeDb };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllPracticeIds.mockResolvedValue([1]);
  mockGetStediApiKeyForPractice.mockResolvedValue({ apiKey: 'test_key', isSandbox: true });
});

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe('mapStediStatus', () => {
  it('maps approved/enrolled/active to enrolled', () => {
    expect(mapStediStatus('APPROVED')).toBe('enrolled');
    expect(mapStediStatus('enrolled')).toBe('enrolled');
    expect(mapStediStatus('Active')).toBe('enrolled');
  });
  it('maps rejected/denied/failed to rejected', () => {
    expect(mapStediStatus('REJECTED')).toBe('rejected');
    expect(mapStediStatus('denied')).toBe('rejected');
    expect(mapStediStatus('FAILED')).toBe('rejected');
  });
  it('maps null / empty / cancelled to not_enrolled', () => {
    expect(mapStediStatus(null)).toBe('not_enrolled');
    expect(mapStediStatus(undefined)).toBe('not_enrolled');
    expect(mapStediStatus('NOT_ENROLLED')).toBe('not_enrolled');
    expect(mapStediStatus('CANCELLED')).toBe('not_enrolled');
  });
  it('defaults unknown values to pending so they stay visible', () => {
    expect(mapStediStatus('SUBMITTED')).toBe('pending');
    expect(mapStediStatus('IN_PROGRESS')).toBe('pending');
    expect(mapStediStatus('WAFFLE')).toBe('pending');
  });
});

describe('mapStediTransactionType', () => {
  it('maps eligibility / 270 / 271 to eligibility', () => {
    expect(mapStediTransactionType('eligibility')).toBe('eligibility');
    expect(mapStediTransactionType('270')).toBe('eligibility');
  });
  it('maps claim submission / 837 / claim status / 276 to claims', () => {
    expect(mapStediTransactionType('claim_submission')).toBe('claims');
    expect(mapStediTransactionType('837')).toBe('claims');
    expect(mapStediTransactionType('claim_status')).toBe('claims');
    expect(mapStediTransactionType('276')).toBe('claims');
  });
  it('maps ERA / 835 / remittance to era', () => {
    expect(mapStediTransactionType('ERA')).toBe('era');
    expect(mapStediTransactionType('835')).toBe('era');
    expect(mapStediTransactionType('remittance')).toBe('era');
  });
  it('returns null for unparseable types', () => {
    expect(mapStediTransactionType('garbage')).toBeNull();
    expect(mapStediTransactionType(null)).toBeNull();
  });
});

describe('normalizeStediResponse', () => {
  it('accepts {enrollments: [...]} shape', () => {
    const out = normalizeStediResponse({
      enrollments: [
        { payerName: 'Aetna', payerId: '60054', transactionType: 'eligibility', status: 'APPROVED' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      payerName: 'Aetna',
      status: 'enrolled',
      transactionType: 'eligibility',
    });
  });
  it('drops items missing payerName or unmappable txType', () => {
    const out = normalizeStediResponse({
      enrollments: [
        { payerName: 'Aetna', transactionType: 'eligibility', status: 'PENDING' },
        { transactionType: 'eligibility', status: 'PENDING' }, // no payerName → drop
        { payerName: 'UHC', transactionType: 'mystery', status: 'PENDING' }, // bad tx → drop
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].payerName).toBe('Aetna');
  });
});

// ---------------------------------------------------------------------------
// Service behavior tests
// ---------------------------------------------------------------------------

describe('syncStediEnrollments', () => {
  it('inserts new rows when Stedi returns enrollments not in our table', async () => {
    const { result, fakeDb } = await runSync({
      incoming: [
        { payerName: 'Aetna', payerId: '60054', transactionType: 'eligibility', status: 'enrolled' },
        { payerName: 'UHC', payerId: '87726', transactionType: 'claims', status: 'pending' },
      ],
    });
    expect(result.totals.pulled).toBe(2);
    expect(result.totals.inserted).toBe(2);
    expect(result.totals.updated).toBe(0);
    expect((fakeDb as any).__inserts).toHaveLength(2);
    expect((fakeDb as any).__inserts[0]).toMatchObject({
      payerName: 'Aetna',
      transactionType: 'eligibility',
      status: 'enrolled',
    });
  });

  it('updates status on existing rows (pending → enrolled) and preserves notes', async () => {
    const { result, fakeDb } = await runSync({
      initialRows: [
        {
          id: 1,
          practiceId: 1,
          payerName: 'Aetna',
          payerId: '60054',
          transactionType: 'eligibility',
          status: 'pending',
          notes: 'submitted via Stedi UI 5/10',
          approvedAt: null,
          rejectedAt: null,
          rejectionReason: null,
        },
      ],
      incoming: [
        { payerName: 'Aetna', payerId: '60054', transactionType: 'eligibility', status: 'enrolled' },
      ],
    });

    expect(result.totals.updated).toBe(1);
    expect(result.totals.inserted).toBe(0);
    expect((fakeDb as any).__updates).toHaveLength(1);
    // notes preserved — we never blow away operator-owned fields
    const row = (fakeDb as any).__rows[0];
    expect(row.status).toBe('enrolled');
    expect(row.notes).toBe('submitted via Stedi UI 5/10');
    expect(row.approvedAt).toBeInstanceOf(Date);
  });

  it('counts unchanged rows separately and does not write to DB', async () => {
    const { result, fakeDb } = await runSync({
      initialRows: [
        {
          id: 1,
          practiceId: 1,
          payerName: 'Aetna',
          payerId: '60054',
          transactionType: 'eligibility',
          status: 'enrolled',
          notes: null,
          approvedAt: new Date('2026-01-01'),
          rejectedAt: null,
          rejectionReason: null,
        },
      ],
      incoming: [
        { payerName: 'Aetna', payerId: '60054', transactionType: 'eligibility', status: 'enrolled' },
      ],
    });

    expect(result.totals.unchanged).toBe(1);
    expect(result.totals.updated).toBe(0);
    expect((fakeDb as any).__updates).toHaveLength(0);
  });

  it('does NOT delete local rows when Stedi has no counterpart', async () => {
    // Local has an Aetna row that Stedi did not return. Sync should
    // leave it alone — operators may be tracking pre-application state.
    const initial: FakeRow[] = [
      {
        id: 1,
        practiceId: 1,
        payerName: 'Aetna',
        payerId: '60054',
        transactionType: 'eligibility',
        status: 'pending',
        notes: 'tracking offline',
        approvedAt: null,
        rejectedAt: null,
        rejectionReason: null,
      },
    ];
    const { result, fakeDb } = await runSync({
      initialRows: initial,
      incoming: [], // Stedi returned nothing
    });

    expect(result.totals.pulled).toBe(0);
    expect((fakeDb as any).__rows).toHaveLength(1);
    expect((fakeDb as any).__rows[0].payerName).toBe('Aetna');
    expect((fakeDb as any).__rows[0].notes).toBe('tracking offline');
  });

  it('tolerates Stedi fetch errors per-practice without breaking the whole sync', async () => {
    mockGetAllPracticeIds.mockResolvedValueOnce([1, 2]);
    const fakeDb = dbForRows([]);

    let practiceCalls = 0;
    const result = await syncStediEnrollments(
      {}, // no practiceId → both practices
      {
        fetchEnrollments: async () => {
          practiceCalls++;
          if (practiceCalls === 1) throw new Error('Stedi 502');
          return [];
        },
        db: fakeDb as any,
      },
    );

    expect(result.practices).toHaveLength(2);
    expect(result.practices[0].errors[0].message).toContain('Stedi 502');
    expect(result.practices[1].errors).toHaveLength(0);
    expect(result.totals.errors).toBe(1);
  });

  it('handles empty-account (sandbox, no enrollments) cleanly with pulled=0', async () => {
    const { result } = await runSync({ incoming: [] });
    expect(result.totals.pulled).toBe(0);
    expect(result.totals.inserted).toBe(0);
    expect(result.totals.updated).toBe(0);
    expect(result.totals.errors).toBe(0);
    expect(result.practices[0].errors).toHaveLength(0);
  });
});
