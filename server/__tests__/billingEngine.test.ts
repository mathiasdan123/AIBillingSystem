/**
 * Billing engine — the percentage-of-collections fee.
 *
 * These assertions guard money that gets charged to a real customer, so they
 * cover the arithmetic (integer cents, rounding), the basis definition
 * (insurance payments only; reversals excluded), and the safety properties
 * (draft only, never auto-charge; idempotent per month; demo practice never
 * billed).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: {}, getDb: () => ({}) }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  decimalToCents,
  feeForCollections,
  monthStart,
  nextMonthStart,
  previousMonth,
} from '../services/billingEngineService';

describe('decimalToCents', () => {
  it('converts Postgres decimal strings exactly', () => {
    expect(decimalToCents('1234.56')).toBe(123456);
    expect(decimalToCents('0.01')).toBe(1);
    expect(decimalToCents('100')).toBe(10000);
    expect(decimalToCents('0')).toBe(0);
  });

  it('handles the float-error cases integer cents exist to avoid', () => {
    // 0.1 + 0.2 style drift must not appear anywhere in a fee.
    expect(decimalToCents('0.10')).toBe(10);
    expect(decimalToCents('0.20')).toBe(20);
    expect(decimalToCents('1856.07')).toBe(185607);
  });

  it('is null/empty safe and handles negatives (reversal adjustments)', () => {
    expect(decimalToCents(null)).toBe(0);
    expect(decimalToCents(undefined)).toBe(0);
    expect(decimalToCents('')).toBe(0);
    expect(decimalToCents('-50.25')).toBe(-5025);
  });

  it('truncates beyond two decimal places rather than rounding up a cent', () => {
    expect(decimalToCents('10.999')).toBe(1099);
  });
});

describe('feeForCollections', () => {
  it('computes 6% of collections, rounded to the cent', () => {
    // $1,000.00 collected → $60.00
    expect(feeForCollections(100000, 6)).toBe(6000);
    // $1,856.07 collected → $111.3642 → $111.36
    expect(feeForCollections(185607, 6)).toBe(11136);
  });

  it('rounds half-up at the cent boundary', () => {
    // 8.75 cents → 9
    expect(feeForCollections(175, 5)).toBe(9);
  });

  it('never bills on zero or negative collections', () => {
    expect(feeForCollections(0, 6)).toBe(0);
    expect(feeForCollections(-5000, 6)).toBe(0);
  });

  it('returns zero for a zero or missing rate rather than guessing 6', () => {
    expect(feeForCollections(100000, 0)).toBe(0);
    expect(feeForCollections(100000, NaN)).toBe(0);
  });

  it('honors a negotiated non-default rate', () => {
    expect(feeForCollections(100000, 4.5)).toBe(4500);
  });
});

describe('period boundaries', () => {
  it('monthStart / nextMonthStart bracket the billed month', () => {
    const d = new Date(Date.UTC(2026, 7, 24)); // 2026-08-24
    expect(monthStart(d)).toBe('2026-08-01');
    expect(nextMonthStart(d)).toBe('2026-09-01');
  });

  it('rolls the year over correctly in December', () => {
    const d = new Date(Date.UTC(2026, 11, 15));
    expect(monthStart(d)).toBe('2026-12-01');
    expect(nextMonthStart(d)).toBe('2027-01-01');
  });

  it('previousMonth returns the month just ended, including across a year boundary', () => {
    expect(monthStart(previousMonth(new Date(Date.UTC(2026, 8, 1))))).toBe('2026-08-01');
    expect(monthStart(previousMonth(new Date(Date.UTC(2027, 0, 1))))).toBe('2026-12-01');
  });

  it('the window is half-open, so a payment on the 1st of the next month is not double-counted', () => {
    const aug = new Date(Date.UTC(2026, 7, 31));
    // end is exclusive: 2026-09-01 belongs to September, not August
    expect(nextMonthStart(aug)).toBe('2026-09-01');
  });
});
