/**
 * Parsing for the `start` / `end` calendar-date query parameters that report
 * endpoints accept ("YYYY-MM-DD", chosen by a person on a calendar).
 *
 * The dates are business-day dates: the range runs from the start of `start`'s
 * day to the end of `end`'s day in the practice time zone, so a report for
 * "Nov 5 to Nov 18" includes everything on Nov 18, not just its first instant.
 */
import { getBusinessTimeZone, zonedInstant, zonedStartOfNextDay } from './timezone';

/** The longest range one request may cover. */
export const MAX_RANGE_DAYS = 1100;

export type DateRangeQuery =
  | { kind: 'none' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ok';
      /** "YYYY-MM-DD" as sent. */
      startDate: string;
      endDate: string;
      /** First instant of the start day. */
      start: Date;
      /** First instant AFTER the end day (an exclusive upper bound). */
      endExclusive: Date;
    };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * Both parameters absent means "use the endpoint's default range". Anything
 * else must be a complete, real, ordered range of at most MAX_RANGE_DAYS days.
 * Query values can arrive as arrays or objects, so only a string counts.
 */
export function parseDateRangeQuery(
  startRaw: unknown,
  endRaw: unknown,
  timeZone: string = getBusinessTimeZone(),
): DateRangeQuery {
  if (startRaw === undefined && endRaw === undefined) return { kind: 'none' };
  if (typeof startRaw !== 'string' || typeof endRaw !== 'string' || !startRaw || !endRaw) {
    return { kind: 'error', message: 'Provide both a start and an end date (YYYY-MM-DD).' };
  }
  const startDate = startRaw.slice(0, 10);
  const endDate = endRaw.slice(0, 10);
  if (!isRealDate(startDate) || !isRealDate(endDate)) {
    return { kind: 'error', message: 'Dates must be real calendar dates in YYYY-MM-DD format.' };
  }
  if (startDate > endDate) {
    return { kind: 'error', message: 'The start date must be on or before the end date.' };
  }
  const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) {
    return { kind: 'error', message: `Choose a range of ${MAX_RANGE_DAYS} days or fewer.` };
  }
  return {
    kind: 'ok',
    startDate,
    endDate,
    start: zonedInstant(startDate, '00:00:00', timeZone),
    // Noon of the end day is safely inside it; the next day's start is the bound.
    endExclusive: zonedStartOfNextDay(zonedInstant(endDate, '12:00:00', timeZone), timeZone),
  };
}
