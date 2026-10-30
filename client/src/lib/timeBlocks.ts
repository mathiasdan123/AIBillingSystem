/**
 * Shared math for the "Billing by Time Block" card (soap-notes.tsx).
 *
 * Extracted after a regression (PR #419): the footer total was recomputed
 * independently as `blocks.length * a single flat rate` instead of summing
 * each block's own (possibly per-code) rate, so it drifted from the correct
 * total shown elsewhere in the same view ("3 blocks x $289.00, Total:
 * $867.00" next to three $100 lines that actually summed to $300). A single
 * shared helper, used everywhere a time-block total is computed, means the
 * two call sites can't diverge again the same way.
 */
export function sumTimeBlockRates(timeBlocks: Array<{ rate: number }>): number {
  return timeBlocks.reduce((sum, block) => sum + block.rate, 0);
}
