import { describe, it, expect } from 'vitest';
import {
  addDays,
  checkCustomRange,
  inclusiveDays,
  lastDays,
  lastMonths,
  monthsBefore,
  MAX_RANGE_DAYS,
  parseIsoDate,
  toIsoDate,
} from '@/lib/dateRange';

describe('calendar date helpers', () => {
  it('formats local dates without shifting them through UTC', () => {
    // 9:30 PM on Nov 22 in a US zone is already Nov 23 in UTC.
    expect(toIsoDate(new Date(2026, 10, 22, 21, 30))).toBe('2026-11-22');
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('parses real calendar dates and rejects impossible ones', () => {
    expect(parseIsoDate('2026-11-22')?.getDate()).toBe(22);
    expect(parseIsoDate('2026-02-31')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('11/22/2026')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
  });

  it('steps by days and months, clamping to a shorter month', () => {
    expect(toIsoDate(addDays(new Date(2026, 2, 1), -1))).toBe('2026-02-28');
    expect(toIsoDate(monthsBefore(new Date(2026, 4, 31), 3))).toBe('2026-02-28');
    expect(toIsoDate(monthsBefore(new Date(2026, 0, 15), 3))).toBe('2025-10-15');
  });

  it('counts days inclusively', () => {
    expect(inclusiveDays(new Date(2026, 0, 1), new Date(2026, 0, 1))).toBe(1);
    expect(inclusiveDays(new Date(2026, 0, 1), new Date(2026, 0, 31))).toBe(31);
  });
});

describe('preset helpers', () => {
  const today = new Date(2026, 10, 22);
  it('resolves ranges that end today', () => {
    expect(lastDays(30)(today)).toEqual({ start: '2026-10-23', end: '2026-11-22' });
    expect(lastMonths(3)(today)).toEqual({ start: '2026-08-22', end: '2026-11-22' });
  });
});

describe('checkCustomRange', () => {
  it('is quietly incomplete until both dates are chosen', () => {
    expect(checkCustomRange('', '2026-11-22')).toEqual({ ok: false, error: null });
    expect(checkCustomRange('2026-11-01', '')).toEqual({ ok: false, error: null });
  });

  it('accepts a specific start and end, including a single day', () => {
    expect(checkCustomRange('2026-11-05', '2026-11-18')).toEqual({ ok: true, range: { start: '2026-11-05', end: '2026-11-18' } });
    expect(checkCustomRange('2026-11-05', '2026-11-05').ok).toBe(true);
  });

  it('rejects a start after the end', () => {
    const r = checkCustomRange('2026-11-18', '2026-11-05');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/on or before/);
  });

  it('rejects impossible dates', () => {
    const r = checkCustomRange('2026-02-31', '2026-03-05');
    expect(r.ok === false && r.error).toMatch(/valid dates/);
  });

  it('rejects an end date after the allowed maximum', () => {
    const r = checkCustomRange('2026-11-01', '2026-12-01', { maxDate: '2026-11-22' });
    expect(r.ok === false && r.error).toMatch(/future/);
    expect(checkCustomRange('2026-11-01', '2026-11-22', { maxDate: '2026-11-22' }).ok).toBe(true);
  });

  it('rejects a range longer than the maximum', () => {
    const r = checkCustomRange('2020-01-01', '2026-11-22');
    expect(r.ok === false && r.error).toContain(String(MAX_RANGE_DAYS));
  });
});
