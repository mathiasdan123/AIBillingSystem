import { describe, it, expect, vi } from 'vitest';

// The route module pulls in the storage layer, which wants a live DB at
// import time. Only the pure parser is under test here.
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../replitAuth', () => ({ isAuthenticated: (_r: any, _s: any, n: any) => n() }));

const { parseRateInput } = await import('../routes/sessions');

/**
 * These values become the dollar amount on an 837P. The parser is the only
 * thing between a typo in a text box and a wrong charge going to a payer.
 */
describe('parseRateInput', () => {
  it('normalizes to a fixed-2 string', () => {
    expect(parseRateInput(550, 'Billed charge')).toBe('550.00');
    expect(parseRateInput('550', 'Billed charge')).toBe('550.00');
    expect(parseRateInput('550.5', 'Billed charge')).toBe('550.50');
  });

  it('accepts currency formatting a user would actually type', () => {
    expect(parseRateInput('$550', 'Billed charge')).toBe('550.00');
    expect(parseRateInput('1,250.75', 'Billed charge')).toBe('1250.75');
  });

  it('distinguishes "not provided" from "cleared"', () => {
    expect(parseRateInput(undefined, 'Billed charge')).toBeUndefined();
    expect(parseRateInput(null, 'Billed charge')).toBeNull();
    expect(parseRateInput('', 'Billed charge')).toBeNull();
  });

  it('allows an explicit zero rather than treating it as cleared', () => {
    expect(parseRateInput(0, 'Billed charge')).toBe('0.00');
    expect(parseRateInput('0', 'Billed charge')).toBe('0.00');
  });

  it('rejects values that are not numbers', () => {
    expect(() => parseRateInput('abc', 'Billed charge')).toThrow(/must be a number/);
    expect(() => parseRateInput('12abc', 'Billed charge')).toThrow(/must be a number/);
  });

  it('rejects negative charges', () => {
    expect(() => parseRateInput(-1, 'Billed charge')).toThrow(/cannot be negative/);
  });

  it('rejects an implausibly large charge (fat-finger guard)', () => {
    expect(() => parseRateInput(100001, 'Billed charge')).toThrow(/over \$100,000/);
  });

  it('names the offending field in the error', () => {
    expect(() => parseRateInput('nope', 'Cash rate')).toThrow(/^Cash rate/);
  });
});
