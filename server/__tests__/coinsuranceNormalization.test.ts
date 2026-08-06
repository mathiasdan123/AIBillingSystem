/**
 * Tests for normalizeCoinsurancePercent (server/services/stediService.ts).
 *
 * Regression cover for a production failure on 2026-08-06: the raw X12 271
 * EB07 fraction (0.5) was written straight to `eligibility_checks.coinsurance`,
 * an integer column meaning "50 for 50%". Postgres rejected the insert, so a
 * successful eligibility check — with real deductible and out-of-pocket
 * figures — was thrown away and shown to staff as "Failed to check
 * eligibility".
 */

import { describe, it, expect } from 'vitest';
import { normalizeCoinsurancePercent } from '../services/stediService';

describe('normalizeCoinsurancePercent', () => {
  // The spec-compliant path: EB07 is a decimal fraction.
  it.each([
    [0.5, 50],
    [0.2, 20],
    [0.15, 15],
    [0.05, 5],
    [1, 100],
  ])('converts fraction %s to %i%%', (input, expected) => {
    expect(normalizeCoinsurancePercent(input)).toBe(expected);
  });

  // Payers that ignore the spec and send whole percentages already.
  it.each([
    [20, 20],
    [50, 50],
    [100, 100],
  ])('passes through whole percentage %i unchanged', (input, expected) => {
    expect(normalizeCoinsurancePercent(input)).toBe(expected);
  });

  it('always returns an integer, so the integer column accepts it', () => {
    for (const input of [0.155, 0.333, 0.666, 12.4, 12.6]) {
      const out = normalizeCoinsurancePercent(input);
      expect(Number.isInteger(out)).toBe(true);
    }
    expect(normalizeCoinsurancePercent(0.333)).toBe(33);
    expect(normalizeCoinsurancePercent(12.6)).toBe(13);
  });

  it('returns undefined for absent or meaningless values rather than 0', () => {
    // undefined leaves the column NULL ("payer didn't say"), which is honest.
    // 0 would assert "0% coinsurance" — a financial claim we can't support.
    expect(normalizeCoinsurancePercent(null)).toBeUndefined();
    expect(normalizeCoinsurancePercent(undefined)).toBeUndefined();
    expect(normalizeCoinsurancePercent(0)).toBeUndefined();
    expect(normalizeCoinsurancePercent(-1)).toBeUndefined();
    expect(normalizeCoinsurancePercent(NaN)).toBeUndefined();
    expect(normalizeCoinsurancePercent(Infinity)).toBeUndefined();
  });

  it('reads exactly 1 as 100%, the documented ambiguity', () => {
    // 100% coinsurance (patient pays everything) is a real plan configuration;
    // 1% is not. Documented in the helper so the choice is visible.
    expect(normalizeCoinsurancePercent(1)).toBe(100);
  });

  it('produces a value Postgres accepts for an integer column', () => {
    // The exact production input that broke: 0.5 from a commercial payer.
    const out = normalizeCoinsurancePercent(0.5);
    expect(out).toBe(50);
    expect(String(out)).toMatch(/^-?\d+$/); // no decimal point reaches the DB
  });
});
