/**
 * Date-only rendering for values that are calendar days, not instants.
 *
 * Follow-up due dates, appeal deadlines, denial dates and DOBs are stored as
 * a day (YYYY-MM-DD, or a timestamp column holding UTC midnight of that day).
 * Pushing such a value through `new Date(iso).toLocaleDateString()` converts
 * the UTC midnight to the browser zone first, so 2027-01-17 renders as Jan 16
 * anywhere west of UTC (QA sweep 2026-11-18: the Revenue at Risk drawer and
 * the appeal drawer showed a deadline a day early, and a letter printed a DOB
 * a day off). These helpers never let a local-time Date touch the value: they
 * read the YYYY-MM-DD part and format it in UTC. Server-side counterpart:
 * server/utils/dateOnly.ts.
 */

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** The YYYY-MM-DD part of a date-only string or an ISO instant; null if absent. */
export function isoDatePart(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const s = value instanceof Date ? value.toISOString() : String(value);
  const m = DATE_ONLY_RE.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * UTC-midnight Date for a YYYY-MM-DD string (or the UTC day of an ISO
 * instant). Null when absent or not a real calendar day (2026-02-31).
 */
export function parseDateOnly(value: string | Date | null | undefined): Date | null {
  const part = isoDatePart(value);
  if (!part) return null;
  const [y, m, d] = part.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}

/**
 * "Jan 17, 2027" for "2027-01-17" (or an ISO instant whose UTC day is the
 * 17th). Pass Intl options for other shapes. Returns `fallback` ("" by
 * default) for an absent or unparseable value rather than "Invalid Date".
 */
export function formatDateOnly(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
  fallback = "",
): string {
  const parsed = parseDateOnly(value);
  if (!parsed) return fallback;
  return parsed.toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}

/** Today's calendar date in the browser's zone, as YYYY-MM-DD. */
export function todayDateOnly(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Today's calendar day in the browser zone, as YYYY-MM-DD, for <input type="date"> min values. */
export function todayDateInput(): string {
  return todayDateOnly();
}

/** YYYY-MM-DD `days` after today in the browser zone. */
export function dateInputDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayDateOnly(d);
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
