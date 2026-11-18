import { describe, it, expect } from 'vitest';
import { formatDateOnly, isoDatePart } from '../dateOnly';

/**
 * Date-only values must render as the stored calendar day in every browser
 * zone. The regression: a UTC-midnight timestamp for 2027-01-17 rendered as
 * Jan 16 in Eastern time through new Date(iso).toLocaleDateString().
 */
describe('dateOnly helpers', () => {
  it('reads the YYYY-MM-DD part of a date-only string or an ISO instant', () => {
    expect(isoDatePart('2027-01-17')).toBe('2027-01-17');
    expect(isoDatePart('2027-01-17T00:00:00.000Z')).toBe('2027-01-17');
    expect(isoDatePart(new Date('2027-01-17T00:00:00.000Z'))).toBe('2027-01-17');
    expect(isoDatePart(null)).toBeNull();
    expect(isoDatePart('next week')).toBeNull();
  });

  it('formats the stored day, not the browser-local day', () => {
    expect(formatDateOnly('2027-01-17T00:00:00.000Z')).toBe('Jan 17, 2027');
    expect(formatDateOnly('2027-01-17')).toBe('Jan 17, 2027');
    // Riley/Ava-style DOB from a date column.
    expect(formatDateOnly('2018-04-11', { month: 'short', day: 'numeric' })).toBe('Apr 11');
  });

  it('returns an empty string for nothing or garbage, never "Invalid Date"', () => {
    expect(formatDateOnly(null)).toBe('');
    expect(formatDateOnly('')).toBe('');
    expect(formatDateOnly('soon')).toBe('');
  });
});
