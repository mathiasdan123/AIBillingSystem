import { describe, it, expect } from 'vitest';
import {
  describeBilledUnits,
  formatUnits,
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

describe('billed units and session length', () => {
  it('shows units as recorded, without converting them to minutes', () => {
    expect(formatUnits(1)).toBe('1 unit');
    expect(formatUnits(3)).toBe('3 units');
    expect(formatUnits(3)).not.toMatch(/min/);
  });

  it('states billed units and session length as separate facts', () => {
    expect(describeBilledUnits(3, 45)).toBe('3 billed units · 45-minute session');
    expect(describeBilledUnits(1, 30)).toBe('1 billed unit · 30-minute session');
  });

  it('does not imply the two agree or disagree when they are not the same size', () => {
    const line = describeBilledUnits(2, 45);
    expect(line).toBe('2 billed units · 45-minute session');
    expect(line).not.toMatch(/=|of a|each/);
  });
});
