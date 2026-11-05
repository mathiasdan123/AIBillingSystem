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
  hasUnsupportedContinuityNecessity,
  stripUnsupportedContinuityNecessity,
  removeCaseAContinuityWording,
  stripUnsupportedPlanClosing,
  softenUnsupportedDeficitInRationale,
  requestHasObservations,
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

describe('stripUnsupportedContinuityNecessity (CASE A Assessment)', () => {
  const remain = 'Skilled occupational therapy services remain medically necessary to address documented endurance limitations and motor planning needs.';
  const continued = 'These observations demonstrate continued need for skilled occupational therapy services to address motor planning.';
  const observation = 'Patient continued to participate in the obstacle course with skilled verbal cueing throughout.';

  it('detects the two shapes that survived the 2026-11-04 pipeline eval', () => {
    expect(hasUnsupportedContinuityNecessity(remain)).toBe(true);
    expect(hasUnsupportedContinuityNecessity(continued)).toBe(true);
  });

  it('does not touch an observation that merely uses "continued" and "skilled"', () => {
    expect(hasUnsupportedContinuityNecessity(observation)).toBe(false);
    expect(stripUnsupportedContinuityNecessity(observation, false, false)).toBe(observation);
  });

  it('strips in CASE A only, including when the sentence opens a paragraph', () => {
    const assessment = `Obstacle course work targeted sequencing and motor planning.\n\n${remain}`;
    const stripped = stripUnsupportedContinuityNecessity(assessment, false, false);
    expect(stripped).not.toMatch(/remain medically necessary/i);
    expect(stripped).toContain('Obstacle course work targeted sequencing and motor planning.');
    expect(stripUnsupportedContinuityNecessity(assessment, true, false)).toBe(assessment);
  });
});

describe('softenUnsupportedDeficitInRationale', () => {
  it('turns attributed deficits into activity demands', () => {
    const out = softenUnsupportedDeficitInRationale('Dynamic activities to address underlying strength and endurance deficits within functional participation context.');
    expect(hasUnsupportedDeficitAssertion(out)).toBe(false);
    expect(out).toMatch(/strength and endurance demands/i);
  });

  it('leaves target language untouched', () => {
    const fine = 'Trampoline work targets lower-extremity strength and endurance; 97110 is also plausible.';
    expect(softenUnsupportedDeficitInRationale(fine)).toBe(fine);
  });
});

describe('requestHasObservations', () => {
  it('is false with blank ratings and no activity responses, true with either', () => {
    expect(requestHasObservations(baseRequest)).toBe(false);
    expect(requestHasObservations({ ...baseRequest, assessment: { ...baseRequest.assessment, strength: 'Fair' } })).toBe(true);
    expect(requestHasObservations({ ...baseRequest, activityDetails: [{ name: 'Trampoline', response: 'Fatigue at 8 minutes.' }] })).toBe(true);
  });
});

describe('validateAndEnhanceResponse with no observations', () => {
  it('softens deficit language in rationales but leaves the Assessment prose alone', async () => {
    const aiResponse = {
      subjective: 'No subjective information was entered for this session.',
      objective: 'Session conducted in Sensory gym for 45 minutes.',
      assessment: 'Activities target motor planning and endurance demands.',
      plan: 'Next session: bilateral coordination.',
      cptCodes: [{ code: '97530', name: 'Therapeutic Activities', units: 3, rationale: 'Addresses the patient\'s underlying strength and endurance deficits.', activitiesAssigned: ['Obstacle Course', 'Trampoline'] }],
      activityCptPairings: [
        { activity: 'Obstacle Course', code: '97530', rationale: 'Functional task; 97112 also plausible.' },
        { activity: 'Trampoline', code: '97530', rationale: 'Targets endurance.' },
      ],
      billingRationale: 'Coded to address identified endurance deficits.',
      auditNotes: [],
    };
    const out = await validateAndEnhanceResponse(aiResponse, baseRequest, 3, false, false);
    expect(hasUnsupportedDeficitAssertion(out.billingRationale)).toBe(false);
    expect(out.cptCodes.every((c) => !hasUnsupportedDeficitAssertion(c.rationale))).toBe(true);
    expect(out.assessment).toBe('Activities target motor planning and endurance demands.');
  });
});

describe('removeCaseAContinuityWording (pipeline eval run 2026-11-04T21-08)', () => {
  it('drops continuity words from otherwise grounded sentences, in CASE A only', () => {
    const cases: Array<[string, RegExp]> = [
      ['indicating emerging motor planning skills with continued need for external structure.', /with need for external structure/],
      ['This finding indicates that sustained gross motor activity remains challenging and requires continued therapeutic intervention.', /is challenging and requires therapeutic intervention/],
      ['Activities will continue to target motor planning, postural control, and endurance.', /Activities will target motor planning/],
      ['Continue activities targeting motor planning and endurance.', /^Use activities targeting/],
      ['The documented fatigue pattern suggests continued deficits in lower extremity strength.', /suggests deficits in lower extremity strength/],
    ];
    for (const [input, expected] of cases) {
      const out = removeCaseAContinuityWording(input, false, false);
      expect(out, input).toMatch(expected);
      expect(out).not.toMatch(/\b(continued|continue|remains)\b/i);
      expect(removeCaseAContinuityWording(input, true, false)).toBe(input);
    }
  });

  it('leaves sentences without continuity wording untouched', () => {
    const fine = 'Patient required minimal verbal cueing to complete the obstacle course sequence.';
    expect(removeCaseAContinuityWording(fine, false, false)).toBe(fine);
  });
});

describe('stripUnsupportedPlanClosing -- CASE B carry-overs in a CASE A plan', () => {
  it('replaces the CASE B home-program sentence with the CASE A one', () => {
    const plan = 'Next session will focus on bilateral coordination.\n\nHome program: Reviewed continuation of current home strategies; no changes to home program at this time.';
    const out = stripUnsupportedPlanClosing(plan, false, false);
    expect(out).not.toMatch(/continuation of current home strategies/i);
    expect(out).toContain('Home program: No home program assigned this session.');
  });

  it('removes a Goals line that names a plan of care or goals that do not exist', () => {
    for (const line of [
      'Goals: No established treatment goals are documented in the plan of care at this time.',
      'No established treatment goals were provided for reference.',
      'Goals: This section is omitted as no active treatment goals were provided in the input data.',
    ]) {
      const plan = `Next session will focus on bilateral coordination.\n\nNo home program assigned this session.\n\n${line}`;
      const out = stripUnsupportedPlanClosing(plan, false, false);
      expect(out, line).not.toMatch(/goals|plan of care/i);
      expect(out).toContain('No home program assigned this session.');
    }
  });

  it('strips "remains necessary" without "medically" in the CASE A Assessment', () => {
    const a = 'Obstacle course work targeted sequencing.\n\nSkilled occupational therapy intervention remains necessary to address motor planning and activity tolerance.';
    const out = stripUnsupportedContinuityNecessity(a, false, false);
    expect(out).not.toMatch(/remains necessary/i);
    expect(out).toContain('Obstacle course work targeted sequencing.');
  });
});

describe('removeCaseAContinuityWording -- shapes from pipeline eval run 2026-11-04T21-26', () => {
  it('handles "continued therapeutic focus", "remains a clinically appropriate", "to continue supporting"', () => {
    const cases: Array<[string, RegExp]> = [
      ['Clinical analysis supports continued therapeutic focus on bilateral coordination.', /supports therapeutic focus on/],
      ['Graded endurance training remains a clinically appropriate intervention target.', /training is a clinically appropriate intervention target/],
      ['Skilled OT is indicated to address fatigue and to continue supporting the development of coordination.', /and to support the development of coordination/],
    ];
    for (const [input, expected] of cases) {
      const out = removeCaseAContinuityWording(input, false, false);
      expect(out, input).toMatch(expected);
      expect(out).not.toMatch(/\b(continued|continue|remains)\b/i);
    }
  });
});

describe('validateAndEnhanceResponse strips a documentation-denial sentence from rationale fields', () => {
  it('removes "No caregiver report or mood was documented" from an auditNote', async () => {
    const aiResponse = {
      subjective: 'No subjective information was entered for this session.',
      objective: 'Session conducted in Sensory gym for 45 minutes.',
      assessment: 'Activities target motor planning and endurance demands.',
      plan: 'Next session: bilateral coordination.',
      cptCodes: [{ code: '97530', name: 'Therapeutic Activities', units: 3, rationale: 'Functional dynamic activities.', activitiesAssigned: ['Obstacle Course', 'Trampoline'] }],
      activityCptPairings: [
        { activity: 'Obstacle Course', code: '97530', rationale: 'Functional task.' },
        { activity: 'Trampoline', code: '97530', rationale: 'Targets endurance.' },
      ],
      billingRationale: 'Coded conservatively as 97530.',
      auditNotes: ['No caregiver report or mood was documented this session. Activities documented with location and duration.'],
    };
    const out = await validateAndEnhanceResponse(aiResponse, baseRequest, 3, false, false);
    expect((out.auditNotes as string[]).join(' ')).not.toMatch(/caregiver report or mood was documented/i);
    expect((out.auditNotes as string[]).join(' ')).toContain('Activities documented with location and duration.');
  });
});

describe('removeCaseAContinuityWording -- structural adjective rule (round 5)', () => {
  it('drops "continued"/"ongoing" before any noun phrase while preserving verb uses', () => {
    const cases: Array<[string, string]> = [
      ['Activities will include continued obstacle course work with reduced cueing.', 'Activities will include obstacle course work with reduced cueing.'],
      ['Emerging motor planning with continued benefit from external structure.', 'Emerging motor planning with benefit from external structure.'],
      ['Potential for skill development with continued skilled occupational therapy services addressing coordination.', 'Potential for skill development with skilled occupational therapy services addressing coordination.'],
      ['Documentation supports continued need for services.', 'Documentation supports need for services.'],
      ['Ongoing verbal cueing was provided during the task.', 'verbal cueing was provided during the task.'],
    ];
    for (const [input, expected] of cases) {
      expect(removeCaseAContinuityWording(input, false, false), input).toBe(expected);
    }
    const verbs = [
      'Patient continued to participate in the obstacle course with skilled cueing.',
      'Patient continued the activity after a brief rest.',
      'Patient continued despite visible fatigue.',
      'She continued with the trampoline sequence for two more minutes.',
    ];
    for (const v of verbs) {
      expect(removeCaseAContinuityWording(v, false, false), v).toBe(v);
    }
  });
});

describe('stripUnsupportedPlanClosing -- CASE A frequency lines that say there is none', () => {
  it('removes them in CASE A and leaves CASE B alone', () => {
    for (const line of [
      'Treatment frequency: No established frequency documented.',
      'Treatment frequency: Not specified at this time.',
      'No treatment frequency was documented.',
      'Treatment frequency has not been established for this initial documented session.',
    ]) {
      const plan = `Next session will target bilateral coordination.\n\n${line}\n\nNo home program assigned this session.`;
      const out = stripUnsupportedPlanClosing(plan, false, false);
      expect(out, line).not.toMatch(/frequency/i);
      expect(out).toContain('No home program assigned this session.');
      expect(stripUnsupportedPlanClosing(plan, true, false)).toBe(plan);
    }
  });
});

describe('validateAndEnhanceResponse applies CASE A wording rewrites to rationale fields', () => {
  it('drops "continued" from an auditNote on a first documented session', async () => {
    const aiResponse = {
      subjective: 'No subjective information was entered for this session.',
      objective: 'Session conducted in Sensory gym for 45 minutes.',
      assessment: 'Activities target motor planning and endurance demands.',
      plan: 'Next session: bilateral coordination.',
      cptCodes: [{ code: '97530', name: 'Therapeutic Activities', units: 3, rationale: 'Functional dynamic activities.', activitiesAssigned: ['Obstacle Course', 'Trampoline'] }],
      activityCptPairings: [
        { activity: 'Obstacle Course', code: '97530', rationale: 'Functional task.' },
        { activity: 'Trampoline', code: '97530', rationale: 'Targets endurance.' },
      ],
      billingRationale: 'Coded conservatively as 97530.',
      auditNotes: ['Documentation connects skilled interventions to functional outcomes supporting continued need for services.'],
    };
    const out = await validateAndEnhanceResponse(aiResponse, baseRequest, 3, false, false);
    expect((out.auditNotes as string[])[0]).toBe('Documentation connects skilled interventions to functional outcomes supporting need for services.');
  });
});
