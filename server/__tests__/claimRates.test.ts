import { describe, it, expect } from 'vitest';
import { ratePercent } from '../utils/claimRates';

describe('ratePercent', () => {
  it('is the unrounded percentage of part in whole', () => {
    expect(ratePercent(3, 12)).toBe(25);
    expect(ratePercent(1, 3)).toBeCloseTo(33.3333, 3);
  });

  it('returns 0 rather than dividing by zero when there is nothing to measure', () => {
    expect(ratePercent(0, 0)).toBe(0);
    expect(ratePercent(5, 0)).toBe(0);
  });
});
