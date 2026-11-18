/**
 * Date-only (YYYY-MM-DD) helpers for the browser.
 *
 * `new Date('2027-01-17')` parses as UTC midnight, so
 * `toLocaleDateString()` in any US zone prints Jan 16 — the appeal drawer
 * showed a deadline one day early and a letter printed a DOB one day off
 * (QA 2026-11-18). Dates that are calendar days (deadlines, DOBs, dates of
 * service) must be formatted from their parts, never through a local Date.
 * Server-side counterpart: server/utils/dateOnly.ts.
 */

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

/** UTC-midnight Date for a YYYY-MM-DD string (a leading date part of a longer string is accepted), or null. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = DATE_ONLY_RE.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
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
 * Format a YYYY-MM-DD string as a calendar date. Defaults to the numeric
 * en-US form ("1/17/2027"); pass Intl options for other shapes. A string
 * that is not date-only (a real timestamp) is formatted as a local instant.
 */
export function formatDateOnly(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' },
  fallback = '',
): string {
  if (!value) return fallback;
  const hasTime = value.includes('T') && value.length > 10;
  if (!hasTime) {
    const parsed = parseDateOnly(value);
    if (!parsed) return fallback;
    return parsed.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d.toLocaleDateString('en-US', options);
}

/** Today's calendar date in the browser's zone, as YYYY-MM-DD. */
export function todayDateOnly(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Whole calendar days from today (local) until a YYYY-MM-DD date. 0 = today,
 * negative = past. Computed day-to-day so the time of day never shifts it.
 */
export function daysUntilDateOnly(value: string | null | undefined, now: Date = new Date()): number | null {
  const target = parseDateOnly(value);
  const today = parseDateOnly(todayDateOnly(now));
  if (!target || !today) return null;
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
