import { describe, expect, it } from 'vitest';
import { sumTimeBlockRates } from '@/lib/timeBlocks';

describe('sumTimeBlockRates', () => {
  // Regression test for PR #419: the "Billing by Time Block" footer
  // recomputed `blocks.length * a single flat rate` instead of summing each
  // block's own rate, showing "3 blocks x $289.00, Total: $867.00" next to
  // three $100 lines that actually summed to $300.
  it('sums each block\'s own rate rather than block count x a flat rate', () => {
    const blocks = [
      { rate: 100 },
      { rate: 100 },
      { rate: 100 },
    ];
    expect(sumTimeBlockRates(blocks)).toBe(300);
    // The old bug's shape, for clarity: it must NOT equal blocks.length * 289.
    expect(sumTimeBlockRates(blocks)).not.toBe(blocks.length * 289);
  });

  it('sums mixed per-code rates correctly', () => {
    const blocks = [{ rate: 72.5 }, { rate: 100 }, { rate: 45.25 }];
    expect(sumTimeBlockRates(blocks)).toBeCloseTo(217.75, 2);
  });

  it('returns 0 for an empty block list', () => {
    expect(sumTimeBlockRates([])).toBe(0);
  });
});
