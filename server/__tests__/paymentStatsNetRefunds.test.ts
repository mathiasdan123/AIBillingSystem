/**
 * Accounting stats (QA demo pass 2026-11-19 follow-up): revenue figures
 * are net of completed refunds, insurance postings are summed by calendar
 * day, and the practice-zone period days are used for the date column.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { paymentTransactions, paymentPostings } from '@shared/schema';

const { dbStub } = vi.hoisted(() => ({
  dbStub: { transactions: [] as any[], postings: [] as any[], postingArgs: [] as any[] },
}));

vi.mock('../db', () => ({
  db: {
    select: () => ({
      from: (table: any) => ({
        where: (cond: any) => {
          const isPostings = table === dbStub.postingsTable;
          const rows = isPostings ? dbStub.postings : dbStub.transactions;
          if (isPostings) dbStub.postingArgs.push(cond);
          const result: any = Promise.resolve(rows);
          result.orderBy = () => Promise.resolve(rows);
          return result;
        },
      }),
    }),
  },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getPaymentStats } from '../storage/payments';

describe('getPaymentStats', () => {
  beforeEach(() => {
    (dbStub as any).postingsTable = paymentPostings;
    expect(paymentTransactions).toBeTruthy();
    dbStub.postingArgs = [];
    dbStub.transactions = [
      { id: 1, amount: '25.00', type: 'payment', status: 'completed', category: 'copay', processor: 'manual' },
      { id: 2, amount: '40.00', type: 'payment', status: 'completed', category: 'self_pay', processor: 'cash' },
      { id: 3, amount: '10.00', type: 'refund', status: 'completed', category: null, processor: 'stripe' },
      { id: 4, amount: '5.00', type: 'refund', status: 'pending', category: null, processor: 'stripe' },
      { id: 5, amount: '30.00', type: 'payment', status: 'pending', category: 'balance', processor: 'manual' },
    ];
    dbStub.postings = [
      { id: 501, paymentAmount: '246.65', reversed: false },
      { id: 502, paymentAmount: '100.00', reversed: null },
    ];
  });

  it('nets completed refunds out of patient and total revenue, and adds insurance postings', async () => {
    const stats = await getPaymentStats(7, new Date('2026-11-01T04:00:00.000Z'), new Date('2026-11-20T04:59:59.999Z'), {
      startDay: '2026-11-01',
      endDay: '2026-11-19',
    });
    expect(stats.totalCollected).toBe(65);
    expect(stats.totalRefunded).toBe(10);
    expect(stats.insuranceCollected).toBe(346.65);
    expect(stats.insurancePostingCount).toBe(2);
    expect(stats.patientRevenue).toBe(55);
    expect(stats.insuranceRevenue).toBe(346.65);
    expect(stats.totalRevenue).toBeCloseTo(401.65, 2);
    // Pending includes the pending refund and the pending payment, as before.
    expect(stats.pendingPayments).toBe(35);
    expect(stats.totalPending).toBe(35);
  });

  it('keeps the existing fields unchanged for other callers', async () => {
    const stats = await getPaymentStats(7);
    expect(stats.transactionCount).toBe(2);
    expect(stats.averagePayment).toBe(32.5);
    expect(stats.byCategory.map((c) => c.category)).toEqual(['self_pay', 'copay']);
    expect(stats.byMethod.map((m) => m.type)).toEqual(['cash', 'manual']);
  });
});
