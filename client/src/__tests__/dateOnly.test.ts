/**
 * Date-only rendering (QA 2026-11-18): the appeal drawer showed a deadline
 * stored as 2027-01-17 as "Jan 16" and the letter printed a DOB a day off,
 * because `new Date('YYYY-MM-DD')` is UTC midnight and the browser then
 * formats it in local time. The client suite is pinned to America/New_York,
 * which is exactly the zone where that goes wrong.
 */
import { describe, it, expect } from 'vitest';
import { formatDateOnly, daysUntilDateOnly, parseDateOnly } from '@/lib/dateOnly';

describe('formatDateOnly', () => {
  it('renders 2027-01-17 as January 17, never the 16th, in a US zone', () => {
    expect(formatDateOnly('2027-01-17')).toBe('1/17/2027');
    expect(formatDateOnly('2027-01-17', { month: 'short', day: 'numeric', year: 'numeric' })).toBe('Jan 17, 2027');
    // The exact bug, pinned to the reporter's zone so it fails the same way
    // whatever zone the test process runs in: the naive conversion is a day early.
    expect(new Date('2027-01-17').toLocaleDateString('en-US', { timeZone: 'America/New_York' })).toBe('1/16/2027');
  });

  it('renders a DOB of 2018-04-11 as April 11', () => {
    expect(formatDateOnly('2018-04-11')).toBe('4/11/2018');
  });

  it('accepts a date-only string with a trailing T part and falls back on garbage', () => {
    expect(formatDateOnly('2018-04-11T00:00:00.000Z')).not.toBe('');
    expect(formatDateOnly('not a date', undefined, 'Not set')).toBe('Not set');
    expect(formatDateOnly(null, undefined, 'Not set')).toBe('Not set');
    expect(parseDateOnly('2026-02-31')).toBeNull();
  });
});

describe('daysUntilDateOnly', () => {
  it('counts whole calendar days from today regardless of time of day', () => {
    const lateEvening = new Date(2026, 10, 18, 23, 30); // local 11:30 PM
    expect(daysUntilDateOnly('2026-11-18', lateEvening)).toBe(0);
    expect(daysUntilDateOnly('2026-11-19', lateEvening)).toBe(1);
    expect(daysUntilDateOnly('2026-11-17', lateEvening)).toBe(-1);
    expect(daysUntilDateOnly('2027-01-17', new Date(2026, 10, 18, 9))).toBe(60);
    expect(daysUntilDateOnly(null)).toBeNull();
  });
});
