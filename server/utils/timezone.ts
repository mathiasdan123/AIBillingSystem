/**
 * Timezone helpers for business-day boundaries.
 *
 * Reports and daily aggregates must bucket by the practice's business day, not
 * the server process's local day. On ECS the process TZ is UTC, so
 * `new Date().setHours(0,0,0,0)` bounds the day in UTC — an evening payment in
 * Eastern time (e.g. 9pm ET = 1am UTC next day) then lands in the wrong
 * calendar day. These helpers compute day boundaries in a configured IANA zone
 * without pulling in a date library.
 */

/** The business timezone the scheduler and reports operate in. */
export function getBusinessTimeZone(): string {
  return process.env.TIMEZONE || 'America/New_York';
}

// Offset (ms) between the given zone's wall-clock and UTC at `instant`.
// Positive east of UTC. DST-correct because it's derived from Intl at `instant`.
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
  }
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return asUtc - instant.getTime();
}

/**
 * The UTC instant corresponding to 00:00:00 of `date`'s calendar day in
 * `timeZone`. e.g. for 2026-07-14 (America/New_York, EDT) returns
 * 2026-07-14T04:00:00Z.
 */
export function zonedStartOfDay(date: Date, timeZone: string): Date {
  // Calendar day in the target zone (en-CA formats as YYYY-MM-DD).
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  // Interpret that midnight as UTC, then shift by the zone's offset at ~that
  // moment. DST transitions occur at ~2am, never at midnight, so the offset
  // sampled at the naive UTC midnight matches the true local-midnight offset.
  const naiveUtcMidnight = new Date(`${ymd}T00:00:00Z`);
  return new Date(naiveUtcMidnight.getTime() - zoneOffsetMs(naiveUtcMidnight, timeZone));
}

/**
 * Start-of-day in `timeZone`, `days` calendar days from `date`'s business day.
 * Anchors at noon before shifting so a ±1h DST wobble never lands in the wrong
 * calendar day, then re-floors to midnight. `days` may be negative.
 */
export function zonedAddDays(date: Date, days: number, timeZone: string): Date {
  const start = zonedStartOfDay(date, timeZone);
  const noon = new Date(start.getTime() + 12 * 60 * 60 * 1000);
  const shifted = new Date(noon.getTime() + days * 24 * 60 * 60 * 1000);
  return zonedStartOfDay(shifted, timeZone);
}

/**
 * The UTC instant for the start of the day AFTER `date`'s calendar day in
 * `timeZone` — i.e. the exclusive upper bound of that business day.
 */
export function zonedStartOfNextDay(date: Date, timeZone: string): Date {
  return zonedAddDays(date, 1, timeZone);
}

/** YYYY-MM-DD of `date`'s calendar day in `timeZone`. */
export function zonedDateString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
