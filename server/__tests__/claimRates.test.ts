import { describe, it, expect } from 'vitest';
import { ratePercent, SUBMITTED_CLAIM_STATUSES } from '../utils/claimRates';

describe('claim outcome rates', () => {
  it('measures paid and denied claims against submitted claims, so they share one base', () => {
    // 20 claims on file: 8 still drafts, 12 submitted. 3 paid, 3 denied, 6 pending.
    const submitted = 12;
    expect(ratePercent(3, submitted)).toBe(25);
    // Against every claim (the old base) the same paid count read as 15%.
    expect(ratePercent(3, 20)).toBe(15);
  });

  it('returns 0 rather than dividing by zero when nothing has been submitted', () => {
    expect(ratePercent(0, 0)).toBe(0);
    expect(ratePercent(5, 0)).toBe(0);
  });

  it('does not count drafts or held claims as submitted', () => {
    expect(SUBMITTED_CLAIM_STATUSES).not.toContain('draft');
    expect(SUBMITTED_CLAIM_STATUSES).not.toContain('held');
    expect(SUBMITTED_CLAIM_STATUSES).toEqual(expect.arrayContaining(['submitted', 'paid', 'denied', 'appeal']));
  });
});
