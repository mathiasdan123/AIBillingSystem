import { describe, it, expect } from 'vitest';
import {
  describeBilledUnits,
  formatUnitsWithMinutes,
  getMissingRequiredFields,
} from '@/lib/soapForm';

describe('getMissingRequiredFields', () => {
  it('lists everything that is missing, in form order', () => {
    expect(getMissingRequiredFields({ hasPatient: false, activityCount: 0, nextSessionFocus: '' })).toEqual([
      'Patient',
      'At least one activity',
      'Next Session Focus',
    ]);
  });

  it('treats a whitespace-only Next Session Focus as missing', () => {
    expect(getMissingRequiredFields({ hasPatient: true, activityCount: 2, nextSessionFocus: '   ' })).toEqual([
      'Next Session Focus',
    ]);
  });

  it('is empty when the form is complete', () => {
    expect(getMissingRequiredFields({ hasPatient: true, activityCount: 1, nextSessionFocus: 'Balance' })).toEqual([]);
  });
});

describe('billed units and minutes', () => {
  it('derives minutes from the unit count', () => {
    expect(formatUnitsWithMinutes(1)).toBe('1 unit · 15 min');
    expect(formatUnitsWithMinutes(3)).toBe('3 units · 45 min');
  });

  it('states 3 billed units for a 45 minute session consistently', () => {
    expect(describeBilledUnits(3, 45)).toBe('3 billed units (15 min each) = 45 min · 45 min session');
  });

  it('says so when the billed minutes differ from the session length', () => {
    expect(describeBilledUnits(2, 45)).toBe('2 billed units (15 min each) = 30 min of a 45 min session');
  });
});
