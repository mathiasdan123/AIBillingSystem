/**
 * Date-only rendering for values that are calendar days, not instants.
 *
 * Follow-up due dates, appeal deadlines and DOBs are stored as a day
 * (YYYY-MM-DD, or a timestamp column holding UTC midnight of that day). Pushing
 * such a value through `new Date(iso).toLocaleDateString()` converts the UTC
 * midnight to the browser zone first, so 2027-01-17 renders as Jan 16 anywhere
 * west of UTC (QA sweep 2026-11-18: the Revenue at Risk drawer showed a
 * deadline a day early). These helpers never let a local-time Date touch the
 * value: they read the YYYY-MM-DD part and format it in UTC.
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
 * "Jan 17, 2027" for "2027-01-17" (or an ISO instant whose UTC day is the
 * 17th). Returns "" for an unparseable value rather than "Invalid Date".
 */
export function formatDateOnly(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string {
  const part = isoDatePart(value);
  if (!part) return "";
  const [y, m, d] = part.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(utc.getTime())) return "";
  return utc.toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}

/** Today's calendar day in the browser zone, as YYYY-MM-DD, for <input type="date"> min values. */
export function todayDateInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** YYYY-MM-DD `days` after today in the browser zone. */
export function dateInputDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
