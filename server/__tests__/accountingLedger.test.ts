/**
 * Accounting ledger (QA demo pass 2026-11-19): the Accounting page read
 * `stats.totalRevenue` / `insuranceRevenue` / `patientRevenue` and
 * `t.paymentType` / `transactionDate` / `paymentMethod`, none of which the
 * API returned. The ledger merges patient payments and insurance postings
 * into one row shape; the route attaches patient names; the stats endpoint
 * now returns the figures the page shows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

import { buildLedger, periodBounds, isoDay } from '../services/accountingLedger';

const { storageStub } = vi.hoisted(() => ({
  storageStub: {
    getPaymentTransactions: vi.fn(),
    getPaymentPostingsForPeriod: vi.fn(),
    getPatientsByIds: vi.fn(),
    getPaymentStats: vi.fn(),
  },
}));
vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'biller-1' } };
    req.userPracticeId = 7;
    req.userRole = 'billing';
    next();
  },
}));

import paymentsRouter from '../routes/payments';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', paymentsRouter);
  return app;
}

describe('periodBounds', () => {
  it('covers the whole end day for a date-only endDate (the page sends "To: today")', () => {
    const b = periodBounds('2026-11-01', '2026-11-19');
    expect(b.start?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(b.end?.toISOString()).toBe('2026-11-19T23:59:59.999Z');
    expect(b.startDay).toBe('2026-11-01');
    expect(b.endDay).toBe('2026-11-19');
  });

  it('passes a full timestamp through and ignores garbage', () => {
    const b = periodBounds('2026-11-01T12:00:00Z', 'nope');
    expect(b.start?.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(b.end).toBeUndefined();
    expect(periodBounds()).toEqual({});
  });

  it('isoDay reads the calendar day of a Date or a date string', () => {
    expect(isoDay(new Date('2026-11-13T15:00:00.000Z'))).toBe('2026-11-13');
    expect(isoDay('2026-11-13')).toBe('2026-11-13');
    expect(isoDay(null)).toBeNull();
    expect(isoDay('soon')).toBeNull();
  });
});

describe('buildLedger', () => {
  it('merges patient payments and insurance postings into one shape, newest first, with names', () => {
    const rows = buildLedger(
      [
        { id: 1, patientId: 102, claimId: 42, amount: '25.00', type: 'payment', category: 'copay', processor: 'manual', status: 'completed', processedAt: new Date('2026-11-15T14:00:00.000Z'), createdAt: new Date('2026-11-15T14:00:00.000Z') },
        { id: 2, patientId: 103, claimId: null, amount: '10.00', type: 'refund', category: null, processor: 'stripe', status: 'completed', processedAt: null, createdAt: new Date('2026-11-18T09:00:00.000Z') },
        { id: 3, patientId: 999, claimId: null, amount: '40.00', type: 'payment', category: 'self_pay', processor: 'cash', status: 'pending', processedAt: null, createdAt: new Date('2026-11-18T09:00:00.000Z') },
      ],
      [
        { id: 501, claimId: 42, payerName: 'UnitedHealthcare', paymentDate: '2026-11-13', paymentAmount: '246.65', checkNumber: 'DEMO-CHK-99-1002', source: 'era' },
        { id: 502, claimId: 43, payerName: null, paymentDate: '2026-11-18', paymentAmount: '100.00', checkNumber: '1234', source: 'manual' },
      ],
      new Map([[102, 'Mia Example'], [103, 'Liam Demo']]),
    );
    expect(rows.map((r) => r.id)).toEqual(['txn-2', 'txn-3', 'posting-502', 'txn-1', 'posting-501']);
    expect(rows.find((r) => r.id === 'txn-1')).toEqual({
      id: 'txn-1', source: 'patient', date: '2026-11-15', amount: 25, type: 'payment', category: 'copay',
      method: 'manual', status: 'completed', party: 'Mia Example', patientId: 102, claimId: 42, checkNumber: null,
    });
    expect(rows.find((r) => r.id === 'posting-501')).toEqual({
      id: 'posting-501', source: 'insurance', date: '2026-11-13', amount: 246.65, type: 'payment', category: 'insurance',
      method: 'era', status: 'completed', party: 'UnitedHealthcare', patientId: null, claimId: 42, checkNumber: 'DEMO-CHK-99-1002',
    });
    // A refund keeps its type; a manual posting with a check number reads as a check; unknown patient and payer get neutral labels.
    expect(rows.find((r) => r.id === 'txn-2')?.type).toBe('refund');
    expect(rows.find((r) => r.id === 'posting-502')).toMatchObject({ method: 'check', party: 'Insurance' });
    expect(rows.find((r) => r.id === 'txn-3')).toMatchObject({ party: 'Patient', status: 'pending' });
  });
});

describe('GET /api/payment-transactions/ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageStub.getPaymentTransactions.mockResolvedValue([
      { id: 1, patientId: 102, claimId: 42, amount: '25.00', type: 'payment', category: 'copay', processor: 'manual', status: 'completed', processedAt: new Date('2026-11-15T14:00:00.000Z') },
    ]);
    storageStub.getPaymentPostingsForPeriod.mockResolvedValue([
      { id: 501, claimId: 42, payerName: 'UnitedHealthcare', paymentDate: '2026-11-13', paymentAmount: '246.65', checkNumber: 'CHK-1', source: 'era' },
    ]);
    storageStub.getPatientsByIds.mockResolvedValue(new Map([[102, { id: 102, firstName: 'Mia', lastName: 'Example' }]]));
  });

  it('scopes both sources to the caller practice and the period, and attaches patient names', async () => {
    const res = await request(makeApp()).get('/api/payment-transactions/ledger?startDate=2026-11-01&endDate=2026-11-19').expect(200);
    expect(storageStub.getPaymentTransactions).toHaveBeenCalledWith(7, {
      startDate: new Date('2026-11-01T00:00:00.000Z'),
      endDate: new Date('2026-11-19T23:59:59.999Z'),
    });
    expect(storageStub.getPaymentPostingsForPeriod).toHaveBeenCalledWith(7, '2026-11-01', '2026-11-19');
    expect(storageStub.getPatientsByIds).toHaveBeenCalledWith([102]);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: 'txn-1', party: 'Mia Example', date: '2026-11-15' });
    expect(res.body[1]).toMatchObject({ id: 'posting-501', party: 'UnitedHealthcare', amount: 246.65 });
  });

  it('ignores a ?practiceId for another practice', async () => {
    await request(makeApp()).get('/api/payment-transactions/ledger?practiceId=2').expect(200);
    expect(storageStub.getPaymentTransactions.mock.calls[0][0]).toBe(7);
    expect(storageStub.getPaymentPostingsForPeriod.mock.calls[0][0]).toBe(7);
  });

  it('the stats route covers the whole end day', async () => {
    storageStub.getPaymentStats.mockResolvedValue({ totalRevenue: 1 });
    await request(makeApp()).get('/api/payment-transactions/stats?startDate=2026-11-01&endDate=2026-11-19').expect(200);
    expect(storageStub.getPaymentStats).toHaveBeenCalledWith(7, new Date('2026-11-01T00:00:00.000Z'), new Date('2026-11-19T23:59:59.999Z'));
  });
});
