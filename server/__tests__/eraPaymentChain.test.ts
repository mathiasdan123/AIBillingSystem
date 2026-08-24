/**
 * ERA → payment_postings → collections basis.
 *
 * Two defects this pins, both found by the money-path sweep (2026-08-24):
 *
 * 1. ERA matching never wrote a payment_postings row. That table is what A/R,
 *    patient statements and the 6%-of-collections basis all read from, so
 *    every insurance dollar collected via 835 contributed $0 to the fee — and
 *    the monthly billing run reported it as a normal "skipped, no collections"
 *    month rather than an error.
 *
 * 2. The claim's paidAmount was OVERWRITTEN per ERA line instead of summed,
 *    and any nonzero payment marked the claim fully 'paid'. A 3-line claim
 *    paid $60/$60/$60 recorded $60; a $0.01 payment closed a $200 claim and
 *    dropped it out of A/R forever.
 *
 * postPayment already had the correct behaviour — it sums non-reversed
 * postings inside a transaction. The ERA path simply bypassed it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTx, state } = vi.hoisted(() => {
  const state: any = { postings: [], claim: null, claimUpdates: [] };
  return { mockTx: {}, state };
});

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Minimal in-memory stand-in for the query builder postPayment uses.
vi.mock('../db', () => {
  const chain = (rows: any[]) => {
    const c: any = {
      from: () => c,
      where: () => c,
      limit: () => Promise.resolve(rows),
      then: (res: any) => res(rows),
    };
    return c;
  };
  const tx: any = {
    select: (shape?: any) => {
      // postPayment makes two selects: the claim lookup, then the SUM.
      if (shape && 'totalPaid' in shape) {
        const total = state.postings
          .filter((p: any) => !p.reversed)
          .reduce((sum: number, p: any) => sum + Math.round(parseFloat(p.paymentAmount) * 100), 0);
        return chain([{ totalPaid: (total / 100).toFixed(2) }]);
      }
      return chain([state.claim]);
    },
    insert: () => ({
      values: (v: any) => ({
        returning: () => {
          state.postings.push({ ...v, reversed: false });
          return Promise.resolve([{ id: state.postings.length, ...v }]);
        },
      }),
    }),
    update: () => ({
      set: (v: any) => ({
        where: () => {
          state.claimUpdates.push(v);
          return Promise.resolve();
        },
      }),
    }),
  };
  return {
    db: { transaction: (fn: any) => fn(tx) },
    getDb: () => ({}),
  };
});

import { postPayment } from '../services/paymentPostingService';

beforeEach(() => {
  state.postings = [];
  state.claimUpdates = [];
  state.claim = { id: 7, practiceId: 1, totalAmount: '200.00', status: 'submitted', paidAt: null };
});

const line = (amount: string) => ({
  claimId: 7,
  payerName: 'Horizon BCBS NJ',
  checkNumber: 'CHK1',
  paymentDate: '2026-08-15',
  paymentAmount: amount,
  adjustmentAmount: '0.00',
}) as any;

describe('ERA payments become payment_postings rows', () => {
  it('writes a posting the collections basis can see', async () => {
    await postPayment(1, line('80.00'));

    expect(state.postings).toHaveLength(1);
    expect(state.postings[0].paymentAmount).toBe('80.00');
    // practiceId is stamped by the service, not trusted from the caller.
    expect(state.postings[0].practiceId).toBe(1);
  });
});

describe('claim paidAmount sums instead of overwriting', () => {
  it('accumulates a multi-line ERA rather than keeping only the last line', async () => {
    await postPayment(1, line('60.00'));
    await postPayment(1, line('60.00'));
    await postPayment(1, line('60.00'));

    const last = state.claimUpdates[state.claimUpdates.length - 1];
    expect(last.paidAmount).toBe('180.00'); // was '60.00' before the fix
  });

  it('a partial payment leaves the claim in A/R as partial, not paid', async () => {
    await postPayment(1, line('0.01'));

    const last = state.claimUpdates[state.claimUpdates.length - 1];
    expect(last.status).toBe('partial'); // was 'paid' — claim vanished from A/R
    expect(last.paidAmount).toBe('0.01');
  });

  it('marks the claim paid only when the payments actually cover it', async () => {
    await postPayment(1, line('120.00'));
    expect(state.claimUpdates.at(-1).status).toBe('partial');

    await postPayment(1, line('80.00'));
    expect(state.claimUpdates.at(-1).status).toBe('paid');
    expect(state.claimUpdates.at(-1).paidAmount).toBe('200.00');
  });
});
