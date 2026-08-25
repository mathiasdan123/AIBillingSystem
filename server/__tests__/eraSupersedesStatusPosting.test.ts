/**
 * An ERA posting must SUPERSEDE a 277-derived posting on the same claim.
 *
 * The 276/277 status jobs now record an inferred payment into
 * payment_postings, because writing claims.paidAmount alone left collections,
 * A/R, statements and the 6% basis reading $0.
 *
 * That fix creates a worse hazard in the opposite direction. When the ERA for
 * the same claim finally arrives and posts, a naive insert would leave TWO
 * live postings for one payment. postPayment sums non-reversed postings to
 * recompute claims.paidAmount, so the claim would report double the money —
 * over-reporting collections and over-billing the 6% platform fee. Silently
 * inflating revenue is worse than silently omitting it.
 *
 * So: an 'era' posting reverses any live 'claim_status' posting on that claim,
 * inside the same transaction, before the sum is taken.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state } = vi.hoisted(() => ({
  state: { updates: [] as any[], claimRow: null as any, sumRow: '0' },
}));

vi.mock('../db', () => {
  const makeTx = () => {
    const tx: any = {
      select: (_cols?: any) => ({
        from: () => ({
          where: () =>
            // First select in postPayment fetches the claim; the second is the
            // SUM aggregate. Distinguish by whether columns were requested.
            Promise.resolve(
              _cols ? [{ totalPaid: state.sumRow }] : [state.claimRow],
            ),
        }),
      }),
      insert: () => ({
        values: (v: any) => ({ returning: () => Promise.resolve([{ id: 99, ...v }]) }),
      }),
      update: () => ({
        set: (values: any) => ({
          where: (cond: any) => {
            state.updates.push({ values, cond });
            return Promise.resolve([]);
          },
        }),
      }),
    };
    return tx;
  };
  const db: any = { transaction: async (fn: any) => fn(makeTx()) };
  return { db, getDb: () => db };
});
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/recoveryEventsService', () => ({
  recordUnderpaymentRecovery: vi.fn(),
  recordDenialRiskRemediated: vi.fn(),
}));

import { PgDialect } from 'drizzle-orm/pg-core';
import { postPayment } from '../services/paymentPostingService';

const dialect = new PgDialect();
const sqlOf = (cond: unknown): string => {
  try {
    return dialect.sqlToQuery(cond as never).sql;
  } catch {
    return '';
  }
};

/** The reversal is the update whose SET marks reversed true. */
const reversalUpdates = () => state.updates.filter((u) => u.values?.reversed === true);

beforeEach(() => {
  state.updates = [];
  state.claimRow = { id: 42, practiceId: 1, totalAmount: '150.00', status: 'submitted' };
  state.sumRow = '150.00';
});

describe("postPayment with source 'era'", () => {
  it('reverses a live claim_status posting on the same claim', async () => {
    await postPayment(1, {
      source: 'era',
      claimId: 42,
      payerName: 'Horizon BCBS NJ',
      paymentDate: '2026-08-20',
      paymentAmount: '150.00',
    } as never);

    const reversals = reversalUpdates();
    expect(reversals).toHaveLength(1);
    expect(reversals[0].values.reversalReason).toMatch(/superseded by era/i);
  });

  it('scopes the reversal to claim_status rows only, and only live ones', async () => {
    await postPayment(1, {
      source: 'era',
      claimId: 42,
      payerName: 'Horizon BCBS NJ',
      paymentDate: '2026-08-20',
      paymentAmount: '150.00',
    } as never);

    const where = sqlOf(reversalUpdates()[0].cond);
    // Must not reverse other ERA postings (a claim can legitimately receive
    // two remittances), and must not re-reverse already-reversed rows.
    expect(where).toContain('source');
    expect(where).toContain('claim_id');
    expect(where).toContain('reversed');
  });
});

describe('postPayment from other sources', () => {
  it("does NOT reverse anything for a 'claim_status' posting", async () => {
    await postPayment(1, {
      source: 'claim_status',
      claimId: 42,
      payerName: 'Horizon BCBS NJ',
      paymentDate: '2026-08-20',
      paymentAmount: '150.00',
    } as never);

    expect(reversalUpdates()).toHaveLength(0);
  });

  it('does NOT reverse anything for an untagged manual posting', async () => {
    // Rows predating the source column are ERA/manual; a manual correction
    // must not silently void an inferred posting.
    await postPayment(1, {
      claimId: 42,
      payerName: 'Horizon BCBS NJ',
      paymentDate: '2026-08-20',
      paymentAmount: '150.00',
    } as never);

    expect(reversalUpdates()).toHaveLength(0);
  });
});
