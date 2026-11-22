/**
 * Claim outcome rates are measured against claims that have actually been
 * submitted, not against every claim on file. Drafts and held claims have not
 * had a chance to be paid or denied, so counting them in the denominator made
 * the paid rate look low and the denial rate look different from one screen
 * to the next.
 */
export const SUBMITTED_CLAIM_STATUSES = ['submitted', 'paid', 'denied', 'appeal'] as const;

/** Percentage (0-100, unrounded) of `part` in `whole`, or 0 when there is nothing to measure. */
export function ratePercent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}
