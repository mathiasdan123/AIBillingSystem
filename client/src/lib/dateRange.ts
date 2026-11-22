/**
 * Date-range helpers shared by every page that filters by a range of dates.
 *
 * All dates here are calendar dates as "YYYY-MM-DD" strings in the user's own
 * time zone. (Building them with toISOString() would use UTC and, in the
 * evening in US time zones, produce tomorrow's date.)
 */

export interface DateRange {
  start: string;
  end: string;
}

export interface RangePreset {
  value: string;
  label: string;
  /** The range this preset covers when today is `today`. */
  resolve: (today: Date) => DateRange;
}

/** The value a range selector uses for "pick specific dates". */
export const CUSTOM_RANGE = 'custom';

/** The longest range a person may pick. Keeps a single report request reasonable. */
export const MAX_RANGE_DAYS = 1100;

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" for a Date, in local time. */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A Date at local midnight for "YYYY-MM-DD", or null if it is not a real calendar date. */
export function parseIsoDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  // Reject 2026-02-31 style dates that JavaScript would roll over.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** `days` calendar days before (negative: after) `from`. */
export function addDays(from: Date, days: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

/** `months` calendar months before `from`, clamped to the end of a shorter month. */
export function monthsBefore(from: Date, months: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() - months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/** Whole days from `start` to `end`, inclusive of both ends. */
export function inclusiveDays(start: Date, end: Date): number {
  const ms = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  return Math.round(ms / 86_400_000) + 1;
}

/** Preset helpers: a range ending today and starting `days` / `months` earlier. */
export const lastDays = (days: number) => (today: Date): DateRange => ({
  start: toIsoDate(addDays(today, -days)),
  end: toIsoDate(today),
});
export const lastMonths = (months: number) => (today: Date): DateRange => ({
  start: toIsoDate(monthsBefore(today, months)),
  end: toIsoDate(today),
});

export type RangeCheck = { ok: true; range: DateRange } | { ok: false; error: string | null };

/**
 * Check a custom range. `error` is null while the range is simply incomplete
 * (nothing to complain about yet) and a short message once it is wrong.
 */
export function checkCustomRange(start: string, end: string, opts: { maxDate?: string } = {}): RangeCheck {
  if (!start || !end) return { ok: false, error: null };
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  if (!s || !e) return { ok: false, error: 'Enter valid dates.' };
  if (s.getTime() > e.getTime()) return { ok: false, error: 'The start date must be on or before the end date.' };
  if (opts.maxDate) {
    const max = parseIsoDate(opts.maxDate);
    if (max && e.getTime() > max.getTime()) return { ok: false, error: 'The end date cannot be in the future.' };
  }
  if (inclusiveDays(s, e) > MAX_RANGE_DAYS) {
    return { ok: false, error: `Choose a range of ${MAX_RANGE_DAYS} days or fewer.` };
  }
  return { ok: true, range: { start, end } };
}

/** Quick ranges most report pages offer next to "Custom dates". */
export const COMMON_RANGE_PRESETS: RangePreset[] = [
  { value: 'last30', label: 'Last 30 days', resolve: lastDays(30) },
  { value: 'last90', label: 'Last 90 days', resolve: lastDays(90) },
  { value: 'last6m', label: 'Last 6 months', resolve: lastMonths(6) },
  { value: 'last12m', label: 'Last 12 months', resolve: lastMonths(12) },
  {
    value: 'ytd',
    label: 'Year to date',
    resolve: (today) => ({ start: toIsoDate(new Date(today.getFullYear(), 0, 1)), end: toIsoDate(today) }),
  },
];
