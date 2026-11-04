/**
 * Backstops for the 2026-11-04 retest findings on SOAP generation:
 *
 *  1. Two generations from IDENTICAL inputs chose 97110 and 97530 for the
 *     same activities and each called its own choice the "only defensible"
 *     code. The certainty was fabricated whichever code is right.
 *  2. With no observations supplied, a note asserted "underlying strength
 *     and endurance deficits" -- a clinical finding nobody made.
 *  3. Subjective came back EMPTY on one run and as an explanatory sentence
 *     on another.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  SUBJECTIVE_PLACEHOLDER,
  ensureSubjectivePresent,
  hasAbsolutistCodingClaim,
  softenAbsolutistCodingClaim,
  hasUnsupportedDeficitAssertion,
  validateAndEnhanceResponse,
  fallbackGeneration,
} from '../services/aiSoapBillingService';

describe('softenAbsolutistCodingClaim', () => {
  it('rewrites the exact production phrasing into suggestion framing', () => {
    const text = '97530 Therapeutic Activities is the only defensible code for the obstacle course and trampoline work.';
    expect(hasAbsolutistCodingClaim(text)).toBe(true);
    const out = softenAbsolutistCodingClaim(text);
    expect(out).not.toMatch(/only defensible/i);
    expect(out).toMatch(/suggested code/i);
  });

  it('handles the no-noun form, "must be coded as", and "no other code is appropriate"', () => {
    expect(softenAbsolutistCodingClaim('97110 is the only appropriate code here.')).toBe('97110 is suggested code here.');
    expect(softenAbsolutistCodingClaim('97110 remains the only defensible option given the documentation.')).not.toMatch(/the only/i);
    expect(softenAbsolutistCodingClaim('Trampoline must be coded as 97110.')).toBe('Trampoline is suggested as 97110.');
    expect(softenAbsolutistCodingClaim('No other code is defensible for this activity.')).toMatch(/an alternative code may also be defensible/i);
  });

  it('leaves suggestion-framed rationales untouched', () => {
    const fine = '97530 suggested; 97110 Therapeutic Exercise is also plausible for the trampoline work, but nothing documented tips it, so the conservative default applies.';
    expect(hasAbsolutistCodingClaim(fine)).toBe(false);
    expect(softenAbsolutistCodingClaim(fine)).toBe(fine);
  });
});

describe('hasUnsupportedDeficitAssertion (detection only)', () => {
  it('flags the exact production sentence and its common shapes', () => {
    expect(hasUnsupportedDeficitAssertion('Activities target underlying strength and endurance deficits within functional participation context.')).toBe(true);
    expect(hasUnsupportedDeficitAssertion('Graded tasks to address the patient\'s postural control deficits.')).toBe(true);
    expect(hasUnsupportedDeficitAssertion('Demonstrates decreased core strength during climbing.')).toBe(true);
    expect(hasUnsupportedDeficitAssertion('Deficits in motor planning were evident.')).toBe(true);
  });

  it('does not flag target language', () => {
    expect(hasUnsupportedDeficitAssertion('Trampoline work targets lower-extremity strength and endurance.')).toBe(false);
    expect(hasUnsupportedDeficitAssertion('Obstacle course demands sequencing, motor planning and sustained attention.')).toBe(false);
    expect(hasUnsupportedDeficitAssertion('97530 Therapeutic Activities for dynamic functional activities.')).toBe(false);
  });
});

describe('ensureSubjectivePresent', () => {
  it('fills an empty or whitespace Subjective with the form-level placeholder', () => {
    expect(ensureSubjectivePresent('')).toBe(SUBJECTIVE_PLACEHOLDER);
    expect(ensureSubjectivePresent('   \n')).toBe(SUBJECTIVE_PLACEHOLDER);
    expect(ensureSubjectivePresent('Caregiver reported: slept poorly.')).toBe('Caregiver reported: slept poorly.');
  });

  it('phrases the placeholder about the form, never as a claim that nothing was obtained', () => {
    expect(SUBJECTIVE_PLACEHOLDER).toMatch(/entered/i);
    expect(SUBJECTIVE_PLACEHOLDER).not.toMatch(/not obtained|not reported|caregiver|mood|presentation/i);
  });
});

const baseRequest: any = {
  patientId: 1,
  activities: ['Obstacle Course', 'Trampoline'],
  mood: '',
  duration: 45,
  location: 'Sensory gym',
  assessment: { performance: '', assistance: '', strength: '', motorPlanning: '', sensoryRegulation: '' },
  planNextSteps: 'Bilateral coordination',
};

describe('validateAndEnhanceResponse applies the new backstops to the final output', () => {
  it('fills a blank Subjective and softens absolutist rationales everywhere the provider reads them', async () => {
    const aiResponse = {
      subjective: '',
      objective: 'Session conducted in Sensory gym for 45 minutes.',
      assessment: 'Obstacle course and trampoline work target motor planning and endurance.',
      plan: 'Next session: bilateral coordination.',
      cptCodes: [{ code: '97530', name: 'Therapeutic Activities', units: 3, rationale: '97530 is the only defensible code for these activities.', activitiesAssigned: ['Obstacle Course', 'Trampoline'] }],
      activityCptPairings: [
        { activity: 'Obstacle Course', code: '97530', rationale: 'Obstacle course must be coded as 97530.' },
        { activity: 'Trampoline', code: '97530', rationale: 'No other code is appropriate for trampoline.' },
      ],
      billingRationale: 'All activities are coded 97530; this is the only correct assignment.',
      auditNotes: ['97530 is the only defensible choice.'],
    };

    const out = await validateAndEnhanceResponse(aiResponse, baseRequest, 3, false, false);

    expect(out.subjective).toBe(SUBJECTIVE_PLACEHOLDER);
    const everything = [
      out.billingRationale,
      ...out.cptCodes.map((c) => c.rationale),
      ...out.activityCptPairings.map((p) => p.rationale),
      ...(out.auditNotes as string[]),
    ].join('\n');
    expect(hasAbsolutistCodingClaim(everything)).toBe(false);
    expect(everything).toMatch(/suggested/i);
  });
});

describe('fallbackGeneration', () => {
  it('never leaves Subjective empty when mood and caregiver report are both blank', () => {
    const out = fallbackGeneration(baseRequest, { firstName: 'Eval', lastName: 'Patient' }, 3);
    expect(out.subjective).toBe(SUBJECTIVE_PLACEHOLDER);
  });
});
