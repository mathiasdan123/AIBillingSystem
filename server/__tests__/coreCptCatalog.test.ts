import { describe, it, expect } from 'vitest';
import { CORE_CPT_CODES } from '../cptCatalog';

/**
 * Guards the CPT catalog every practice bills from.
 *
 * Background: the reference-data seed block is guarded by "if cpt_codes has
 * any rows, return". Production's catalog was populated 2026-03-25 and that
 * guard short-circuited every boot since, so the 9 codes added to the seed
 * afterward never landed — prod ran with 12 of 24 codes and, critically, no
 * speech-language treatment codes at all. A speech visit had no code to
 * attach by any route: the claim UI, the superbill dialog, or Blanche.
 *
 * `ensureCoreCptCodes` now inserts missing codes on every boot from this
 * list. These tests protect the list itself.
 */
describe('CORE_CPT_CODES', () => {
  it('has no duplicate codes', () => {
    const seen = new Map<string, number>();
    for (const entry of CORE_CPT_CODES) {
      seen.set(entry.code, (seen.get(entry.code) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([code]) => code);
    expect(dupes).toEqual([]);
  });

  // The regression this list exists to prevent.
  it.each([
    ['92507', 'individual speech/language treatment'],
    ['92508', 'group speech/language treatment'],
    ['92526', 'swallowing / feeding treatment'],
  ])('includes SLP treatment code %s (%s)', (code) => {
    expect(CORE_CPT_CODES.find((c) => c.code === code)).toBeDefined();
  });

  it('covers evaluation codes for all three disciplines', () => {
    const codes = new Set(CORE_CPT_CODES.map((c) => c.code));
    expect(codes.has('97165')).toBe(true); // OT eval
    expect(codes.has('97161')).toBe(true); // PT eval
    expect(codes.has('92521')).toBe(true); // SLP eval
  });

  it('gives every code a description and a positive billed rate', () => {
    for (const entry of CORE_CPT_CODES) {
      expect(entry.description.trim().length, `${entry.code} description`).toBeGreaterThan(0);
      expect(Number(entry.baseRate), `${entry.code} baseRate`).toBeGreaterThan(0);
      expect(entry.billingUnits, `${entry.code} billingUnits`).toBeGreaterThan(0);
    }
  });

  it('uses well-formed 5-digit CPT codes', () => {
    for (const entry of CORE_CPT_CODES) {
      expect(entry.code, `${entry.code} shape`).toMatch(/^\d{5}$/);
    }
  });
});
