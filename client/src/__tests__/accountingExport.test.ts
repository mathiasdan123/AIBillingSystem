/**
 * Accounting exports (QA demo pass 2026-11-19): the CSV, QuickBooks IIF and
 * tax summary used to read `transactionDate`, `paymentType` and
 * `paymentMethod`, fields the API never returned, so every row carried
 * "undefined". They now build from the ledger rows the page shows.
 */
import { describe, it, expect } from 'vitest';
import { buildPaymentsCsv, buildQuickBooksIif, buildTaxSummary, labelMethod, type AccountingLedgerRow } from '@/lib/accountingExport';

const rows: AccountingLedgerRow[] = [
  { id: 'txn-1', source: 'patient', date: '2026-11-15', amount: 25, type: 'payment', category: 'copay', method: 'manual', status: 'completed', party: 'Mia Example', patientId: 102, claimId: 42, checkNumber: null },
  { id: 'posting-501', source: 'insurance', date: '2026-11-13', amount: 246.65, type: 'payment', category: 'insurance', method: 'era', status: 'completed', party: 'UnitedHealthcare', patientId: null, claimId: 42, checkNumber: 'DEMO-CHK-99-1002' },
  { id: 'txn-2', source: 'patient', date: '2026-11-18', amount: 10, type: 'refund', category: null, method: 'stripe', status: 'completed', party: 'Liam "LD" Demo', patientId: 103, claimId: null, checkNumber: null },
  { id: 'txn-3', source: 'patient', date: '2026-11-18', amount: 40, type: 'payment', category: 'self_pay', method: 'cash', status: 'pending', party: 'Noah Sample', patientId: 104, claimId: null, checkNumber: null },
];

describe('buildPaymentsCsv', () => {
  it('writes every column from real fields, quotes values, and never emits "undefined"', () => {
    const csv = buildPaymentsCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('"Date","Source","Patient / Payer","Amount","Type","Category","Method","Status","Claim","Check #"');
    expect(lines[1]).toBe('"2026-11-15","patient","Mia Example","25.00","payment","copay","Manual","completed","42",""');
    expect(lines[2]).toBe('"2026-11-13","insurance","UnitedHealthcare","246.65","payment","insurance","ERA / EFT","completed","42","DEMO-CHK-99-1002"');
    expect(lines[3]).toContain('"Liam ""LD"" Demo"');
    expect(csv).not.toContain('undefined');
  });
});

describe('buildQuickBooksIif', () => {
  it('posts completed payments as deposits, refunds negative, and skips pending rows', () => {
    const iif = buildQuickBooksIif(rows);
    expect(iif).toContain('TRNS\tDEPOSIT\t2026/11/15\tChecking\tMia Example\t25.00\tcopay payment');
    expect(iif).toContain('TRNS\tDEPOSIT\t2026/11/13\tChecking\tUnitedHealthcare\t246.65\tinsurance payment check DEMO-CHK-99-1002');
    expect(iif).toContain('TRNS\tDEPOSIT\t2026/11/18\tChecking\tLiam "LD" Demo\t-10.00\tpatient refund');
    expect(iif).not.toContain('Noah Sample');
    expect(iif).not.toContain('undefined');
  });
});

describe('buildTaxSummary', () => {
  it('reports the server totals and splits counts by source', () => {
    const text = buildTaxSummary(
      { start: '2026-11-01', end: '2026-11-19' },
      { totalRevenue: 271.65, insuranceRevenue: 246.65, patientRevenue: 25, pendingPayments: 40 },
      rows,
      '2026-11-19',
    );
    expect(text).toContain('Total Revenue: $271.65');
    expect(text).toContain('Insurance Payments (posted ERA / manual postings): $246.65');
    expect(text).toContain('Patient Payments (copays, balances, self-pay): $25.00');
    expect(text).toContain('Pending Patient Payments: $40.00');
    expect(text).toContain('Insurance postings: 1');
    expect(text).toContain('Patient payments: 3');
    expect(text).toContain('Pending: 1');
  });
});

describe('labelMethod', () => {
  it('labels processors for people', () => {
    expect(labelMethod('era')).toBe('ERA / EFT');
    expect(labelMethod('credit_card')).toBe('Credit Card');
    expect(labelMethod(null)).toBe('');
  });
});
