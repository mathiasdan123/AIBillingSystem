import { describe, expect, it } from 'vitest';
import {
  businessDaysBetween,
  runMatching,
  type CandidateTransaction,
  type ExpectedDeposit,
} from '../services/reconciliation/matchingEngine';

let idSeq = 1;

function ed(partial: Partial<ExpectedDeposit>): ExpectedDeposit {
  return {
    remittanceId: idSeq++,
    payerName: 'Cigna',
    traceNumber: null,
    effectiveDate: '2026-08-24',
    amountCents: 12000,
    ...partial,
  };
}

function txn(partial: Partial<CandidateTransaction>): CandidateTransaction {
  return {
    bankTransactionId: idSeq++,
    postedDate: '2026-08-26',
    descriptor: 'CIGNA EDI PYMNTS',
    amountCents: 12000,
    pending: false,
    ...partial,
  };
}

const TODAY = { today: '2026-08-28' };

describe('deposit matching engine', () => {
  describe('trace matching', () => {
    it('matches deterministically on the EFT trace number', () => {
      const e = ed({ traceNumber: '882201445', amountCents: 34500 });
      const t = txn({ descriptor: 'CIGNA HCCLAIMPMT TRN*1*882201445*1591111213', amountCents: 34500 });
      const out = runMatching([t], [e], TODAY);
      expect(out.matches).toEqual([
        { bankTransactionId: t.bankTransactionId, kind: 'trace', confidence: 1.0, remittanceIds: [e.remittanceId] },
      ]);
      expect(out.exceptions).toEqual([]);
    });

    it('matches multiple remittances sharing one trace (bundled remittance)', () => {
      const e1 = ed({ traceNumber: '555000111', amountCents: 10000 });
      const e2 = ed({ traceNumber: '555000111', amountCents: 5000 });
      const t = txn({ descriptor: 'AETNA EFT 555000111', amountCents: 15000 });
      const out = runMatching([t], [e1, e2], TODAY);
      expect(out.matches[0]?.remittanceIds.sort()).toEqual([e1.remittanceId, e2.remittanceId].sort());
      expect(out.exceptions).toEqual([]);
    });

    it('raises amount_mismatch when trace links but totals disagree', () => {
      const e = ed({ traceNumber: '777000999', amountCents: 20000 });
      const t = txn({ descriptor: 'UHC EDI 777000999', amountCents: 18000 });
      const out = runMatching([t], [e], TODAY);
      expect(out.matches).toHaveLength(1);
      expect(out.exceptions).toEqual([
        expect.objectContaining({ type: 'amount_mismatch', bankTransactionId: t.bankTransactionId }),
      ]);
    });

    it('does not match a trace embedded in a longer digit run', () => {
      const e = ed({ traceNumber: '1234', amountCents: 12000, effectiveDate: '2026-08-10' });
      const t = txn({ descriptor: 'MISC DEPOSIT 612345', postedDate: '2026-08-11', amountCents: 999 });
      const out = runMatching([t], [e], TODAY);
      expect(out.matches).toEqual([]);
    });
  });

  describe('exact matching', () => {
    it('matches a single remittance on amount + payer + window', () => {
      const e = ed({ payerName: 'Cigna', amountCents: 17500, effectiveDate: '2026-08-24' });
      const t = txn({ descriptor: 'CIGNA EDI PYMNTS 08/26', amountCents: 17500, postedDate: '2026-08-26' });
      const out = runMatching([t], [e], TODAY);
      expect(out.matches[0]).toMatchObject({ kind: 'exact', remittanceIds: [e.remittanceId] });
    });

    it('declines to guess between two identical candidates', () => {
      const e1 = ed({ amountCents: 17500 });
      const e2 = ed({ amountCents: 17500 });
      const t = txn({ amountCents: 17500 });
      const out = runMatching([t], [e1, e2], TODAY);
      expect(out.matches).toEqual([]);
    });

    it('respects the business-day window and flags aged remittances', () => {
      const e = ed({ amountCents: 17500, effectiveDate: '2026-08-03' });
      const t = txn({ amountCents: 17500, postedDate: '2026-08-26' });
      const out = runMatching([t], [e], { today: '2026-08-27' });
      expect(out.matches).toEqual([]);
      expect(out.exceptions).toContainEqual(
        expect.objectContaining({ type: 'missing_deposit', remittanceId: e.remittanceId }),
      );
    });

    it('does not match a deposit posting before the remittance effective date', () => {
      const e = ed({ amountCents: 17500, effectiveDate: '2026-08-27' });
      const t = txn({ amountCents: 17500, postedDate: '2026-08-24' });
      const out = runMatching([t], [e], TODAY);
      expect(out.matches).toEqual([]);
    });
  });

  describe('bundle matching', () => {
    it('matches one deposit to a subset of same-payer remittances summing exactly', () => {
      const e1 = ed({ amountCents: 10000 });
      const e2 = ed({ amountCents: 7500 });
      const e3 = ed({ amountCents: 4200 });
      const t = txn({ amountCents: 17500 });
      const out = runMatching([t], [e1, e2, e3], TODAY);
      expect(out.matches[0]?.kind).toBe('bundle');
      expect(out.matches[0]?.remittanceIds.sort()).toEqual([e1.remittanceId, e2.remittanceId].sort());
    });

    it('does not bundle across payers', () => {
      const e1 = ed({ payerName: 'Cigna', amountCents: 10000 });
      const e2 = ed({ payerName: 'Aetna', amountCents: 7500 });
      const t = txn({ descriptor: 'CIGNA EDI PYMNTS', amountCents: 17500 });
      const out = runMatching([t], [e1, e2], TODAY);
      expect(out.matches).toEqual([]);
    });
  });

  describe('exceptions and hygiene', () => {
    it('does not flag recent awaiting remittances', () => {
      const e = ed({ effectiveDate: '2026-08-26' });
      const out = runMatching([], [e], { today: '2026-08-28' });
      expect(out.exceptions).toEqual([]);
    });

    it('flags payer-looking deposits with no remittance, ignores ordinary revenue', () => {
      const payerish = txn({ descriptor: 'HUMANA HCCLAIMPMT 9911', amountCents: 5000 });
      const ordinary = txn({ descriptor: 'INTEREST PAYMENT', amountCents: 12 });
      const out = runMatching([payerish, ordinary], [], TODAY);
      expect(out.exceptions).toEqual([
        expect.objectContaining({ type: 'unmatched_deposit', bankTransactionId: payerish.bankTransactionId }),
      ]);
    });

    it('skips pending transactions and debits', () => {
      const e = ed({ amountCents: 17500 });
      const pending = txn({ amountCents: 17500, pending: true });
      const debit = txn({ amountCents: -17500 });
      const out = runMatching([pending, debit], [e], TODAY);
      expect(out.matches).toEqual([]);
    });
  });

  describe('businessDaysBetween', () => {
    it('counts weekdays only', () => {
      expect(businessDaysBetween('2026-08-24', '2026-08-31')).toBe(5);
      expect(businessDaysBetween('2026-08-28', '2026-08-31')).toBe(1);
      expect(businessDaysBetween('2026-08-24', '2026-08-24')).toBe(0);
    });
  });
});
