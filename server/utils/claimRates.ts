/**
 * Rate arithmetic shared by the claim analytics. Which claims count in the
 * base is defined once, in server/storage/claimCohort.ts.
 */

/** Percentage (0-100, unrounded) of `part` in `whole`, or 0 when there is nothing to measure. */
export function ratePercent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}
