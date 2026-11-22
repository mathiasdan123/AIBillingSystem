import { describe, it, expect } from 'vitest';
import { parseDateRangeQuery, MAX_RANGE_DAYS } from '../utils/dateRangeParams';

const NY = 'America/New_York';

describe('parseDateRangeQuery', () => {
  it('treats no parameters as "use the default range"', () => {
    expect(parseDateRangeQuery(undefined, undefined, NY)).toEqual({ kind: 'none' });
  });

  it('runs from the start of the first day to the end of the last day in the business time zone', () => {
    const r = parseDateRangeQuery('2026-11-05', '2026-11-18', NY);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    // Nov 5 00:00 EST = 05:00Z; the bound after Nov 18 is Nov 19 00:00 EST = 05:00Z.
    expect(r.start.toISOString()).toBe('2026-11-05T05:00:00.000Z');
    expect(r.endExclusive.toISOString()).toBe('2026-11-19T05:00:00.000Z');
    // Everything on Nov 18, including the evening, is inside the range.
    const lateOnEndDay = new Date('2026-11-19T04:30:00.000Z'); // 11:30 PM EST on Nov 18
    expect(lateOnEndDay < r.endExclusive).toBe(true);
  });

  it('handles daylight saving boundaries', () => {
    const r = parseDateRangeQuery('2026-03-08', '2026-03-08', NY);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    // The day clocks spring forward is 23 hours long.
    expect(r.endExclusive.getTime() - r.start.getTime()).toBe(23 * 3600 * 1000);
  });

  it('accepts a single day', () => {
    expect(parseDateRangeQuery('2026-11-18', '2026-11-18', NY).kind).toBe('ok');
  });

  it('requires both dates', () => {
    expect(parseDateRangeQuery('2026-11-18', undefined, NY).kind).toBe('error');
    expect(parseDateRangeQuery(undefined, '2026-11-18', NY).kind).toBe('error');
    expect(parseDateRangeQuery('', '', NY).kind).toBe('error');
  });

  it('rejects values that are not strings', () => {
    expect(parseDateRangeQuery(['2026-11-01', '2026-11-02'], '2026-11-18', NY).kind).toBe('error');
    expect(parseDateRangeQuery({ a: 1 }, '2026-11-18', NY).kind).toBe('error');
  });

  it('rejects malformed and impossible dates', () => {
    expect(parseDateRangeQuery('11/05/2026', '2026-11-18', NY).kind).toBe('error');
    expect(parseDateRangeQuery('2026-02-31', '2026-03-05', NY).kind).toBe('error');
    expect(parseDateRangeQuery('2026-13-01', '2026-13-02', NY).kind).toBe('error');
  });

  it('rejects a start after the end', () => {
    const r = parseDateRangeQuery('2026-11-18', '2026-11-05', NY);
    expect(r).toEqual({ kind: 'error', message: 'The start date must be on or before the end date.' });
  });

  it('rejects a range longer than the maximum', () => {
    expect(parseDateRangeQuery('2020-01-01', '2026-11-18', NY).kind).toBe('error');
    // Exactly the maximum is allowed.
    const start = '2023-01-01';
    const end = new Date(Date.parse(`${start}T00:00:00Z`) + (MAX_RANGE_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
    expect(parseDateRangeQuery(start, end, NY).kind).toBe('ok');
  });
});
