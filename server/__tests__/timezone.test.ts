import { describe, it, expect } from 'vitest';
import {
  zonedStartOfDay,
  zonedStartOfNextDay,
  zonedAddDays,
  zonedDateString,
} from '../utils/timezone';

const NY = 'America/New_York';

describe('timezone business-day helpers', () => {
  it('floors to business-zone midnight (EDT) — an evening ET instant stays on its own day', () => {
    // 2026-07-14 23:30 EDT === 2026-07-15 03:30 UTC. Naive UTC flooring would
    // bucket this on the 15th; business-zone flooring keeps it on the 14th.
    const evening = new Date('2026-07-15T03:30:00Z');
    expect(zonedStartOfDay(evening, NY).toISOString()).toBe('2026-07-14T04:00:00.000Z');
    expect(zonedDateString(evening, NY)).toBe('2026-07-14');
  });

  it('exclusive next-day bound is the following business midnight', () => {
    const d = new Date('2026-07-14T12:00:00Z');
    expect(zonedStartOfNextDay(d, NY).toISOString()).toBe('2026-07-15T04:00:00.000Z');
  });

  it('handles the DST fall-back boundary (EDT→EST) — Nov 1 2026', () => {
    // Nov 1 2026 is a 25-hour day in NY (clocks fall back). The next business
    // midnight is Nov 2 00:00 EST === 05:00 UTC (offset shifted from -4 to -5).
    const d = new Date('2026-11-01T10:00:00Z');
    expect(zonedStartOfNextDay(d, NY).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('handles the DST spring-forward boundary (EST→EDT) — Mar 8 2026', () => {
    // Mar 8 2026 is a 23-hour day. Next business midnight is Mar 9 00:00 EDT
    // === 04:00 UTC.
    const d = new Date('2026-03-08T12:00:00Z');
    expect(zonedStartOfNextDay(d, NY).toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('zonedAddDays crosses a DST change without drifting off midnight', () => {
    // Start a few days before fall-back, add 5 days, land on a clean midnight.
    const start = new Date('2026-10-30T12:00:00Z');
    const plus5 = zonedAddDays(start, 5, NY); // Oct 30 → Nov 4 (past the Nov 1 change)
    expect(zonedDateString(plus5, NY)).toBe('2026-11-04');
    // Nov 4 is EST (-5) → midnight is 05:00 UTC.
    expect(plus5.toISOString()).toBe('2026-11-04T05:00:00.000Z');
  });

  it('negative zonedAddDays goes back a week to a clean midnight', () => {
    const start = new Date('2026-07-14T12:00:00Z');
    expect(zonedAddDays(start, -7, NY).toISOString()).toBe('2026-07-07T04:00:00.000Z');
  });
});
