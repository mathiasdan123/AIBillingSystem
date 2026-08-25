/**
 * Shared remittance ingestion — the duplicate guards.
 *
 * This is the single point where a remittance becomes real. The automated
 * poller re-reads transactions by design (the poll window overlaps so nothing
 * is ever skipped), so "have I seen this already?" is asked constantly and
 * must be right every time. A wrong answer either loses a payment or posts one
 * that never happened.
 *
 * Three guards, in order of authority:
 *   1. stediTransactionId — exact, for polled ERAs
 *   2. fileHash           — exact, for identical content
 *   3. payer+check+date   — same money re-exported in another format
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  existing: [] as any[],
  selectWheres: [] as any[],
  inserted: [] as any[],
  lineItemInserts: [] as any[],
}));

vi.mock('../db', () => {
  const db: any = {
    select: () => ({
      from: () => ({
        where: (cond: any) => {
          H.selectWheres.push(cond);
          const next = H.existing.shift();
          return { limit: () => Promise.resolve(next ? [next] : []) };
        },
      }),
    }),
    insert: (table: any) => ({
      values: (v: any) => {
        if (Array.isArray(v)) {
          H.lineItemInserts.push(...v);
          return Promise.resolve([]);
        }
        H.inserted.push(v);
        return { returning: () => Promise.resolve([{ id: 777, ...v }]) };
      },
    }),
  };
  return { db, getDb: () => db };
});
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ingestRemittance, hashRemittance } from '../services/remittanceIngestionService';

const REMITTANCE = {
  payerName: 'Horizon BCBS NJ',
  payerId: '22099',
  checkNumber: 'CHK-1',
  checkDate: '2026-08-20',
  totalPaymentAmount: 160,
  lineItems: [
    {
      patientName: 'Eliyahu Stein',
      memberId: 'M1',
      serviceDate: '2026-08-12',
      cptCode: '97153',
      chargedAmount: 250,
      allowedAmount: 200,
      paidAmount: 160,
      adjustmentAmount: 90,
      patientResponsibility: 40,
      contractualAdjustment: 50,
      adjustmentReasonCodes: ['45', '2'],
      remarkCodes: [],
    },
  ],
};

const opts = (over: any = {}) => ({ encryptLineItem: (i: any) => i, ...over });

beforeEach(() => {
  H.existing = [];
  H.selectWheres = [];
  H.inserted = [];
  H.lineItemInserts = [];
});

describe('ingestRemittance', () => {
  it('creates the remittance and its line items', async () => {
    const result = await ingestRemittance(1, REMITTANCE as any, opts());

    expect(result).toEqual({ status: 'created', remittanceId: 777 });
    expect(H.inserted[0].payerName).toBe('Horizon BCBS NJ');
    expect(H.inserted[0].totalPaymentAmount).toBe('160.00');
    expect(H.lineItemInserts).toHaveLength(1);
  });

  it('refuses a transaction id it has already ingested', async () => {
    H.existing = [{ id: 500 }]; // first guard hits

    const result = await ingestRemittance(
      1,
      REMITTANCE as any,
      opts({ stediTransactionId: 'txn-1' }),
    );

    expect(result).toEqual({ status: 'duplicate', reason: 'transaction_id', remittanceId: 500 });
    expect(H.inserted).toHaveLength(0);
  });

  it('refuses identical content re-uploaded', async () => {
    // No stediTransactionId, so the txn guard issues no query at all — the
    // hash guard is the FIRST select.
    H.existing = [{ id: 501 }];

    const result = await ingestRemittance(1, REMITTANCE as any, opts());

    expect(result).toEqual({ status: 'duplicate', reason: 'file_hash', remittanceId: 501 });
  });

  it('refuses the same check re-exported in a different format', async () => {
    H.existing = [null, { id: 502 }]; // hash differs, check guard hits
    const different = { ...REMITTANCE, totalPaymentAmount: 160.0001 };

    const result = await ingestRemittance(1, different as any, opts());

    expect(result).toEqual({ status: 'duplicate', reason: 'check_number', remittanceId: 502 });
  });

  it('lets an operator override the check-number guard', async () => {
    // Hash guard misses; the check guard is skipped entirely by the override.
    H.existing = [null];

    const result = await ingestRemittance(
      1,
      REMITTANCE as any,
      opts({ allowDuplicateCheck: true }),
    );

    // A payer genuinely can reuse a check number across remittances; the
    // override exists for that, and only a human may use it.
    expect(result.status).toBe('created');
  });

  it('records the transaction id on the row so later runs can dedupe', async () => {
    await ingestRemittance(1, REMITTANCE as any, opts({ stediTransactionId: 'txn-9' }));

    expect(H.inserted[0].stediTransactionId).toBe('txn-9');
  });

  it('leaves stediTransactionId null for a manual upload', async () => {
    await ingestRemittance(1, REMITTANCE as any, opts());

    // NULLs do not collide in a Postgres unique index, so manual uploads never
    // block each other.
    expect(H.inserted[0].stediTransactionId).toBeNull();
  });

  it('hashes the raw payload, not the normalized view', async () => {
    const raw = { some: 'stedi envelope' };
    await ingestRemittance(1, REMITTANCE as any, opts({ rawData: raw }));

    expect(H.inserted[0].fileHash).toBe(hashRemittance(raw));
  });

  it('encrypts line-item PHI before storage', async () => {
    const encryptLineItem = vi.fn((i: any) => ({ ...i, patientName: 'ENC' }));

    await ingestRemittance(1, REMITTANCE as any, opts({ encryptLineItem }));

    expect(encryptLineItem).toHaveBeenCalledTimes(1);
    expect(H.lineItemInserts[0].patientName).toBe('ENC');
  });
});
