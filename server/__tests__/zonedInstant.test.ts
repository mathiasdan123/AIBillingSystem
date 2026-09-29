/**
 * zonedInstant — appointment instants must be anchored to the practice
 * timezone, not the server's. The old pattern new Date(`${date}T${time}`)
 * parsed in the server's local zone (UTC on ECS), so a "3:00 PM" Eastern
 * appointment landed at 3:00 PM UTC = 11:00 AM Eastern.
 */
import { describe, it, expect } from 'vitest';
import { zonedInstant } from '../utils/timezone';
import { zonedTimeString } from '../utils/dateOnly';

describe('zonedInstant', () => {
  it('books 15:00 Eastern at 19:00 UTC in summer (EDT)', () => {
    const d = zonedInstant('2026-07-14', '15:00', 'America/New_York');
    expect(d.toISOString()).toBe('2026-07-14T19:00:00.000Z');
  });

  it('books 15:00 Eastern at 20:00 UTC in winter (EST)', () => {
    const d = zonedInstant('2026-01-14', '15:00', 'America/New_York');
    expect(d.toISOString()).toBe('2026-01-14T20:00:00.000Z');
  });

  it('the result is independent of the server timezone (regression)', () => {
    // The instant depends only on inputs — same answer whatever process.env.TZ
    // is. The vitest process TZ is whatever the runner uses; the important
    // property is that the wall clock round-trips through the target zone.
    const d = zonedInstant('2026-10-05', '09:30', 'America/New_York');
    expect(zonedTimeString(d, 'America/New_York')).toBe('09:30');
    // And the calendar day in the target zone is the requested one.
    expect(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
    ).toBe('2026-10-05');
  });

  it('handles HH:MM:SS times', () => {
    const d = zonedInstant('2026-07-14', '15:30:45', 'America/New_York');
    expect(d.toISOString()).toBe('2026-07-14T19:30:45.000Z');
  });

  it('resolves times across the spring-forward DST boundary sanely', () => {
    // 2026-03-08 02:30 does not exist in America/New_York (clocks jump
    // 02:00→03:00). The two-pass offset resolution must return a valid
    // instant on that calendar day, not throw and not drift a full day.
    const d = zonedInstant('2026-03-08', '02:30', 'America/New_York');
    expect(Number.isNaN(d.getTime())).toBe(false);
    expect(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
    ).toBe('2026-03-08');
  });

  it('malformed input propagates to an Invalid Date (old constructor contract)', () => {
    expect(Number.isNaN(zonedInstant('garbage', '15:00', 'America/New_York').getTime())).toBe(true);
    expect(Number.isNaN(zonedInstant('2026-07-14', 'noon', 'America/New_York').getTime())).toBe(true);
  });

  it('defaults to the practice timezone from TIMEZONE env', () => {
    const prev = process.env.TIMEZONE;
    try {
      process.env.TIMEZONE = 'America/Los_Angeles';
      const d = zonedInstant('2026-07-14', '15:00');
      expect(d.toISOString()).toBe('2026-07-14T22:00:00.000Z'); // PDT = UTC-7
    } finally {
      if (prev === undefined) delete process.env.TIMEZONE;
      else process.env.TIMEZONE = prev;
    }
  });
});
