import { describe, it, expect } from 'vitest';
import { derivePracticeUnitRate, describeUnitRate } from '../practiceRate';

/**
 * Post-deploy retest of #464: the Rate/Unit field pre-filled the flat $289
 * estimate ($867 for 3 units) while generation billed the practice's $100
 * rate ($300). The pre-fill now comes from the practice catalog the page
 * already loads, and says which it is.
 */
const demoCatalog = [
  { code: '97530', baseRate: '100.00' },
  { code: '97110', baseRate: '100.00' },
  { code: '97112', baseRate: '100.00' },
  { code: '97165', baseRate: null },
];

describe('derivePracticeUnitRate', () => {
  it('uses the practice rate for the conservative default code when configured', () => {
    const d = derivePracticeUnitRate(demoCatalog, 'treatment');
    expect(d).toEqual({ rate: 100, source: 'practice', code: '97530' });
    expect(3 * d.rate).toBe(300);
    expect(describeUnitRate(d)).toBe("Your practice's rate for 97530");
  });

  it('falls through the treatment codes in order when 97530 has no rate', () => {
    const d = derivePracticeUnitRate([{ code: '97530', baseRate: null }, { code: '97110', baseRate: 95 }], 'treatment');
    expect(d).toEqual({ rate: 95, source: 'practice', code: '97110' });
  });

  it('keeps the flat estimate, labeled, when no practice rate exists or the catalog has not loaded', () => {
    expect(derivePracticeUnitRate([], 'treatment')).toEqual({ rate: 289, source: 'estimate' });
    expect(derivePracticeUnitRate(undefined, 'treatment')).toEqual({ rate: 289, source: 'estimate' });
    expect(describeUnitRate(derivePracticeUnitRate(undefined, 'treatment'))).toMatch(/Flat estimate/);
  });

  it('session types look up their own codes and flat figures', () => {
    expect(derivePracticeUnitRate(demoCatalog, 'initial_eval')).toEqual({ rate: 550, source: 'estimate' });
    expect(derivePracticeUnitRate([{ code: '97166', baseRate: '210' }], 'initial_eval')).toEqual({ rate: 210, source: 'practice', code: '97166' });
    expect(derivePracticeUnitRate(demoCatalog, 're_eval')).toEqual({ rate: 400, source: 'estimate' });
  });

  it('ignores zero, negative and unparsable rates', () => {
    expect(derivePracticeUnitRate([{ code: '97530', baseRate: '0' }, { code: '97110', baseRate: 'abc' }], 'treatment').source).toBe('estimate');
  });
});
