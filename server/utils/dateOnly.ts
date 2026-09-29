/**
 * Deterministic helpers for date-only strings (YYYY-MM-DD).
 *
 * `new Date('2026-10-05')` parses as UTC midnight, so any local-time
 * derivation (getDay, toLocaleDateString without an explicit timeZone) on a
 * server west of UTC — e.g. America/New_York — lands on the PREVIOUS day:
 * a Monday slot reads as Sunday. For pure calendar dates the weekday is a
 * property of the date itself and must not involve any timezone. These
 * helpers parse the parts and stay in UTC end-to-end, so the result is the
 * same on every server regardless of process TZ.
 */

import { getBusinessTimeZone } from './timezone';

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/**
 * UTC-midnight Date for the calendar day named by a YYYY-MM-DD string (a
 * leading date part of a longer string is accepted). Returns null when the
 * string does not start with a date part or names an impossible day.
 */
export function parseDateOnly(dateStr: string): Date | null {
  const m = DATE_ONLY_RE.exec(dateStr);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  // Reject overflow like 2026-02-31 (Date.UTC silently rolls it forward).
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(mo) - 1 ||
    date.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return date;
}

/**
 * Lowercase weekday name ('monday', ...) for a calendar date.
 *
 * - YYYY-MM-DD (or an ISO string with a leading date part *and no time*):
 *   derived purely from the date parts via getUTCDay — no timezone involved,
 *   identical on every server.
 * - A string carrying an actual timestamp (has a time component): the moment
 *   is real, so the weekday is taken in the practice timezone
 *   (process.env.TIMEZONE || America/New_York), not the server's.
 */
export function weekdayOfDateString(dateStr: string): string {
  const hasTime = dateStr.includes('T') && dateStr.length > 10;
  if (!hasTime) {
    const parsed = parseDateOnly(dateStr);
    if (parsed) return WEEKDAYS[parsed.getUTCDay()];
  }
  // Real timestamp (or unrecognized format): interpret the instant in the
  // practice timezone so the answer doesn't depend on the server's TZ.
  return new Date(dateStr)
    .toLocaleDateString('en-US', { weekday: 'long', timeZone: getBusinessTimeZone() })
    .toLowerCase();
}

/**
 * Human-readable date for notifications (e.g. "Monday, October 5") derived
 * purely from a YYYY-MM-DD string — formatted in UTC against a UTC-midnight
 * date so the named day can never shift with server TZ. Falls back to the
 * practice timezone for strings carrying a real timestamp.
 */
export function formatDateOnlyLong(dateStr: string): string {
  const options = { weekday: 'long', month: 'long', day: 'numeric' } as const;
  const hasTime = dateStr.includes('T') && dateStr.length > 10;
  if (!hasTime) {
    const parsed = parseDateOnly(dateStr);
    if (parsed) return parsed.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
  }
  return new Date(dateStr).toLocaleDateString('en-US', {
    ...options,
    timeZone: getBusinessTimeZone(),
  });
}

/** HH:MM (24h) wall-clock time of an instant in `timeZone`. */
export function zonedTimeString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
