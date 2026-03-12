import { describe, it, expect, vi } from 'vitest';
import {
  parseRRule,
  generateRRule,
  generateOccurrences,
  describeRecurrence,
  validateRecurrenceRule,
  getDayCode,
} from '../services/recurrenceService';

describe('parseRRule', () => {
  it('returns null for empty or falsy input', () => {
    expect(parseRRule('')).toBeNull();
    expect(parseRRule('   ')).toBeNull();
    expect(parseRRule(null as any)).toBeNull();
  });

  it('parses a basic weekly rule', () => {
    const result = parseRRule('FREQ=WEEKLY;INTERVAL=1;COUNT=10');
    expect(result).toEqual({
      frequency: 'WEEKLY',
      interval: 1,
      count: 10,
    });
  });

  it('parses biweekly rule with BYDAY', () => {
    const result = parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=12');
    expect(result!.interval).toBe(2);
    expect(result!.byDay).toEqual(['MO', 'WE', 'FR']);
    expect(result!.count).toBe(12);
  });

  it('parses UNTIL date', () => {
    const result = parseRRule('FREQ=WEEKLY;INTERVAL=1;UNTIL=20261231');
    expect(result!.until).toBeInstanceOf(Date);
    expect(result!.until!.getFullYear()).toBe(2026);
    expect(result!.until!.getMonth()).toBe(11); // December (0-indexed)
    expect(result!.until!.getDate()).toBe(31);
  });

  it('strips RRULE: prefix', () => {
    const result = parseRRule('RRULE:FREQ=MONTHLY;INTERVAL=1;COUNT=6');
    expect(result!.frequency).toBe('MONTHLY');
  });

  it('parses monthly frequency', () => {
    const result = parseRRule('FREQ=MONTHLY;INTERVAL=1;COUNT=6');
    expect(result!.frequency).toBe('MONTHLY');
    expect(result!.interval).toBe(1);
  });
});

describe('generateRRule', () => {
  it('generates a basic weekly rule string', () => {
    const result = generateRRule({ frequency: 'WEEKLY', interval: 1, count: 10 });
    expect(result).toBe('FREQ=WEEKLY;INTERVAL=1;COUNT=10');
  });

  it('includes BYDAY when provided', () => {
    const result = generateRRule({ frequency: 'WEEKLY', interval: 2, byDay: ['MO', 'FR'] });
    expect(result).toContain('BYDAY=MO,FR');
  });

  it('formats UNTIL date correctly', () => {
    const until = new Date(2026, 5, 15); // June 15, 2026
    const result = generateRRule({ frequency: 'WEEKLY', interval: 1, until });
    expect(result).toContain('UNTIL=20260615');
    expect(result).not.toContain('COUNT');
  });

  it('prefers UNTIL over COUNT when both provided', () => {
    const until = new Date(2026, 11, 31);
    const result = generateRRule({ frequency: 'WEEKLY', interval: 1, until, count: 10 });
    expect(result).toContain('UNTIL=');
    expect(result).not.toContain('COUNT=');
  });
});

describe('generateOccurrences', () => {
  it('returns only start date when rule is null (invalid rrule)', () => {
    const start = new Date(2026, 0, 5); // Jan 5, 2026 (Monday)
    const result = generateOccurrences(start, '');
    expect(result).toHaveLength(1);
    expect(result[0].getTime()).toBe(start.getTime());
  });

  it('generates weekly occurrences with COUNT', () => {
    const start = new Date(2026, 0, 5, 10, 0, 0); // Monday Jan 5
    const result = generateOccurrences(start, 'FREQ=WEEKLY;INTERVAL=1;COUNT=4');
    expect(result).toHaveLength(4);
    // Each should be 7 days apart
    for (let i = 1; i < result.length; i++) {
      const diff = result[i].getTime() - result[i - 1].getTime();
      expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });

  it('generates biweekly occurrences', () => {
    const start = new Date(2026, 0, 5, 10, 0, 0); // Monday
    const result = generateOccurrences(start, 'FREQ=WEEKLY;INTERVAL=2;COUNT=3');
    expect(result).toHaveLength(3);
    // Each should be 14 days apart
    const diff = result[1].getTime() - result[0].getTime();
    expect(diff).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('generates monthly occurrences', () => {
    const start = new Date(2026, 0, 15, 14, 0, 0); // Jan 15
    const result = generateOccurrences(start, 'FREQ=MONTHLY;INTERVAL=1;COUNT=3');
    expect(result).toHaveLength(3);
    expect(result[0].getDate()).toBe(15);
    expect(result[1].getMonth()).toBe(1); // Feb
    expect(result[1].getDate()).toBe(15);
    expect(result[2].getMonth()).toBe(2); // Mar
    expect(result[2].getDate()).toBe(15);
  });

  it('handles month end-of-month edge case (Jan 31 -> Feb 28)', () => {
    const start = new Date(2026, 0, 31, 10, 0, 0); // Jan 31
    const result = generateOccurrences(start, 'FREQ=MONTHLY;INTERVAL=1;COUNT=3');
    expect(result).toHaveLength(3);
    expect(result[0].getDate()).toBe(31); // Jan 31
    // Feb doesn't have 31 days, should clamp to last day
    expect(result[1].getMonth()).toBe(1); // Feb
    expect(result[1].getDate()).toBe(28); // Feb 28 (2026 is not a leap year)
  });

  it('uses maxOccurrences as fallback when COUNT not specified', () => {
    const start = new Date(2026, 0, 5);
    // No COUNT in rule, so maxOccurrences (5) is the limit
    const result = generateOccurrences(start, 'FREQ=WEEKLY;INTERVAL=1;UNTIL=20270105', 5);
    expect(result).toHaveLength(5);
  });

  it('stops at UNTIL date', () => {
    const start = new Date(2026, 0, 5, 10, 0, 0);
    // UNTIL = Jan 20, so we should get about 3 occurrences (Jan 5, 12, 19)
    const result = generateOccurrences(start, 'FREQ=WEEKLY;INTERVAL=1;UNTIL=20260120');
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.length).toBeLessThanOrEqual(3);
    for (const d of result) {
      expect(d.getTime()).toBeLessThanOrEqual(new Date(2026, 0, 20, 23, 59, 59).getTime());
    }
  });

  it('returns only start date for unsupported frequency', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const start = new Date(2026, 0, 5);
    const result = generateOccurrences(start, { frequency: 'DAILY', interval: 1, count: 5 });
    expect(result).toHaveLength(1);
    consoleSpy.mockRestore();
  });
});

describe('describeRecurrence', () => {
  it('returns "No recurrence" for null rule', () => {
    expect(describeRecurrence('')).toBe('No recurrence');
  });

  it('describes weekly rule', () => {
    expect(describeRecurrence('FREQ=WEEKLY;INTERVAL=1;COUNT=10')).toContain('Weekly');
  });

  it('describes biweekly rule', () => {
    const desc = describeRecurrence('FREQ=WEEKLY;INTERVAL=2;COUNT=6');
    expect(desc).toContain('Biweekly');
  });

  it('describes monthly rule', () => {
    expect(describeRecurrence('FREQ=MONTHLY;INTERVAL=1;COUNT=6')).toContain('Monthly');
  });

  it('includes day names when BYDAY is present', () => {
    const desc = describeRecurrence('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;COUNT=10');
    expect(desc).toContain('Monday');
    expect(desc).toContain('Wednesday');
  });

  it('includes session count', () => {
    const desc = describeRecurrence('FREQ=WEEKLY;INTERVAL=1;COUNT=12');
    expect(desc).toContain('12 sessions');
  });
});

describe('validateRecurrenceRule', () => {
  it('returns error for empty rule', () => {
    const errors = validateRecurrenceRule('');
    expect(errors).toContain('Invalid recurrence rule format');
  });

  it('returns error for unsupported frequency', () => {
    const errors = validateRecurrenceRule('FREQ=DAILY;INTERVAL=1;COUNT=10');
    expect(errors.some(e => e.includes('Only weekly and monthly'))).toBe(true);
  });

  it('returns error for invalid interval', () => {
    const errors = validateRecurrenceRule('FREQ=WEEKLY;INTERVAL=5;COUNT=10');
    expect(errors.some(e => e.includes('Interval must be between'))).toBe(true);
  });

  it('returns error for invalid day codes', () => {
    const errors = validateRecurrenceRule('FREQ=WEEKLY;INTERVAL=1;BYDAY=XX;COUNT=5');
    expect(errors.some(e => e.includes('Invalid day'))).toBe(true);
  });

  it('returns error when neither until nor count is specified', () => {
    const errors = validateRecurrenceRule('FREQ=WEEKLY;INTERVAL=1');
    expect(errors.some(e => e.includes('Either until date or count'))).toBe(true);
  });

  it('returns error for count out of range', () => {
    const errors = validateRecurrenceRule('FREQ=WEEKLY;INTERVAL=1;COUNT=100');
    expect(errors.some(e => e.includes('Count must be between 1 and 52'))).toBe(true);
  });

  it('returns empty array for valid rule', () => {
    const errors = validateRecurrenceRule('FREQ=WEEKLY;INTERVAL=1;COUNT=10');
    expect(errors).toEqual([]);
  });
});

describe('getDayCode', () => {
  it('returns correct day codes', () => {
    expect(getDayCode(new Date(2026, 0, 5))).toBe('MO'); // Jan 5 2026 is Monday
    expect(getDayCode(new Date(2026, 0, 4))).toBe('SU'); // Jan 4 2026 is Sunday
  });
});
