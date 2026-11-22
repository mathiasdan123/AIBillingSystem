/**
 * Sizing for appointment blocks in the calendar's time grid. One hour is
 * HOUR_HEIGHT_PX tall, so a block's height follows its duration; the content
 * inside has to be budgeted against that height or it gets clipped.
 */
export const HOUR_HEIGHT_PX = 64;
/** Shortest a block is drawn, so even a very short appointment stays clickable and readable. */
export const MIN_BLOCK_PX = 30;

/** Pixel budget inside a week-view block (matches the type sizes used there). */
export const WEEK_NAME_LINE_PX = 13;
export const WEEK_STATUS_ROW_PX = 12;
/** Top and bottom padding (2px each) plus a 1px gap between the name and the status row. */
export const WEEK_CHROME_PX = 5;

export function blockHeightPx(durationMinutes: number): number {
  return Math.max((durationMinutes * HOUR_HEIGHT_PX) / 60, MIN_BLOCK_PX);
}

/**
 * How many lines the patient name may wrap to while the time and status row
 * always keeps its own space underneath: 1 line in a 30 minute block, 2 in
 * 45 minutes, 3 in an hour.
 */
export function weekNameLines(heightPx: number): 1 | 2 | 3 {
  const free = heightPx - WEEK_CHROME_PX - WEEK_STATUS_ROW_PX;
  const lines = Math.floor(free / WEEK_NAME_LINE_PX);
  return Math.min(3, Math.max(1, lines)) as 1 | 2 | 3;
}
