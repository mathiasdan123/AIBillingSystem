/**
 * Regression tests for the waitlist weekday timezone bug.
 *
 * `new Date('2026-10-05')` parses as UTC midnight, so deriving the weekday
 * with a local-time read (toLocaleDateString without a timeZone) on a server
 * in America/New_York returned the PREVIOUS day — a Monday slot matched
 * families with Sunday preferences. The matcher now derives the weekday from
 * the date parts alone, so a Monday date matches Monday preferences on every
 * server regardless of process TZ.
 */
import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from 'vitest';

const mockStorage = vi.hoisted(() => ({
  getWaitlist: vi.fn(),
  updateWaitlistEntry: vi.fn(),
  getPatient: vi.fn(),
  getPractice: vi.fn(),
  getUser: vi.fn(),
  getWaitlistEntry: vi.fn(),
}));
vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../replitAuth', () => ({ isAuthenticated: (_req: any, _res: any, next: any) => next() }));
vi.mock('../email', () => ({ isEmailConfigured: () => false }));
vi.mock('../services/emailService', () => ({ sendEmail: vi.fn() }));
vi.mock('../services/smsService', () => ({ isSMSConfigured: () => false, sendSMS: vi.fn() }));

import { autoFillSlot } from '../routes/waitlist';
import {
  weekdayOfDateString,
  formatDateOnlyLong,
  parseDateOnly,
  zonedTimeString,
} from '../utils/dateOnly';

// 2026-10-05 is a Monday — a calendar fact, independent of any timezone.
const MONDAY = '2026-10-05';

const ENTRY = {
  id: 42,
  practiceId: 1,
  patientId: 7,
  therapistId: null,
  preferredDays: ['monday'],
  preferredTimeStart: '09:00',
  preferredTimeEnd: '18:00',
  appointmentType: null,
  priority: 1,
  status: 'waiting',
  createdAt: '2026-08-01T00:00:00Z',
};

describe('weekdayOfDateString — pure date-part derivation', () => {
  it('derives the weekday from the parts, never from server TZ', () => {
    // In any zone west of UTC, the old new Date(...).toLocaleDateString path
    // returned the previous day for every one of these.
    expect(weekdayOfDateString('2026-10-05')).toBe('monday');
    expect(weekdayOfDateString('2026-10-04')).toBe('sunday');
    expect(weekdayOfDateString('2026-09-16')).toBe('wednesday');
    expect(weekdayOfDateString('2026-01-01')).toBe('thursday');
    expect(weekdayOfDateString('2024-02-29')).toBe('thursday'); // leap day
  });

  it('interprets a real timestamp in the practice timezone, not the server zone', () => {
    // 2026-10-06T01:30Z is still Monday evening (Oct 5) in America/New_York.
    const prev = process.env.TIMEZONE;
    delete process.env.TIMEZONE; // default America/New_York
    try {
      expect(weekdayOfDateString('2026-10-06T01:30:00Z')).toBe('monday');
    } finally {
      if (prev !== undefined) process.env.TIMEZONE = prev;
    }
  });
});

describe('parseDateOnly / formatDateOnlyLong / zonedTimeString', () => {
  it('parses valid date-only strings to UTC midnight and rejects junk', () => {
    expect(parseDateOnly(MONDAY)?.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(parseDateOnly('2026-02-31')).toBeNull(); // impossible day
    expect(parseDateOnly('not-a-date')).toBeNull();
  });

  it('formats the named day of the date itself, never the TZ-shifted day', () => {
    expect(formatDateOnlyLong(MONDAY)).toBe('Monday, October 5');
    expect(formatDateOnlyLong('2026-09-16')).toBe('Wednesday, September 16');
  });

  it('renders wall-clock time of an instant in the given zone', () => {
    // 2026-10-05T19:30Z = 15:30 EDT
    expect(zonedTimeString(new Date('2026-10-05T19:30:00Z'), 'America/New_York')).toBe('15:30');
    expect(zonedTimeString(new Date('2026-10-05T19:30:00Z'), 'UTC')).toBe('19:30');
  });
});

describe('autoFillSlot — weekday matching is server-TZ independent', () => {
  const originalTz = process.env.TZ;

  // Force the process into the zone that used to trigger the bug. Node
  // re-reads process.env.TZ at each Date call on POSIX platforms, so this
  // exercises the exact failure mode: under the old code, a Monday date-only
  // string read back as Sunday here.
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.updateWaitlistEntry.mockResolvedValue({});
    mockStorage.getUser.mockResolvedValue({ id: 'therapist-1', email: null, firstName: 'Meg' });
    mockStorage.getPatient.mockResolvedValue({ id: 7, firstName: 'Kid', email: null, phone: null });
    mockStorage.getPractice.mockResolvedValue({ id: 1, name: 'Wonder Kids' });
  });

  it('a Monday slot matches a family whose preference is monday', async () => {
    // Sanity: the bug only manifests when local and UTC weekdays differ.
    expect(new Date(MONDAY).getUTCDay()).toBe(1);
    mockStorage.getWaitlist.mockResolvedValue([ENTRY]);
    const result = await autoFillSlot(1, {
      therapistId: 'therapist-1',
      date: MONDAY,
      startTime: '15:30',
      endTime: '16:15',
      requireTherapistConfirmation: true,
    });
    expect(result.matched).toBe(true);
    const [id, update] = mockStorage.updateWaitlistEntry.mock.calls[0];
    expect(id).toBe(42);
    // Confirm-first behavior unchanged: pending_confirmation, family untouched.
    expect(update.status).toBe('pending_confirmation');
    expect(mockStorage.getPatient).not.toHaveBeenCalled();
  });

  it('a Monday slot does NOT match a sunday-only preference (the old bug matched it)', async () => {
    mockStorage.getWaitlist.mockResolvedValue([{ ...ENTRY, preferredDays: ['sunday'] }]);
    const result = await autoFillSlot(1, {
      therapistId: 'therapist-1',
      date: MONDAY,
      startTime: '15:30',
      requireTherapistConfirmation: true,
    });
    expect(result.matched).toBe(false);
    expect(mockStorage.updateWaitlistEntry).not.toHaveBeenCalled();
  });

  it('manual (direct-offer) path also matches on the true weekday', async () => {
    mockStorage.getWaitlist.mockResolvedValue([ENTRY]);
    const result = await autoFillSlot(1, {
      date: MONDAY,
      startTime: '15:30',
    });
    expect(result.matched).toBe(true);
    const [, update] = mockStorage.updateWaitlistEntry.mock.calls[0];
    expect(update.status).toBe('offered');
    expect(update.respondBy).toBeInstanceOf(Date);
  });
});
