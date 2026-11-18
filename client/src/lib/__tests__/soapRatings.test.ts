import { describe, it, expect } from 'vitest';
import { applyRatingsToAllActivities, buildRequestAssessment, mergeGlobalAssessment } from '../soapRatings';

/**
 * Post-deploy retest of #464: "Minimal Assist" chosen via Apply to All (and
 * per exercise) never reached the generate request's global `assessment`,
 * so neither path documented it. These pin the page-side handoff: the
 * request body built from the form state carries the selected level.
 */
const blankGlobal = { performance: '', assistance: '', strength: '', motorPlanning: '', sensoryRegulation: '' };
const activities = [
  { name: 'Trampoline - Strengthening', assessment: {} },
  { name: 'Pegboard - Functional', assessment: {} },
];

describe('Apply to All → generate request body', () => {
  it('a level applied to all exercises appears as the request assistance', () => {
    const applied = applyRatingsToAllActivities(activities, { ...blankGlobal, assistance: 'Minimal Assist' });
    expect(applied.every((a) => a.assessment.assistance === 'Minimal Assist')).toBe(true);
    const body = buildRequestAssessment(blankGlobal, applied);
    expect(body.assistance).toBe('Minimal Assist');
    expect(body.performance).toBe('');
  });

  it('a level set on every exercise individually appears too', () => {
    const rated = activities.map((a) => ({ ...a, assessment: { assistance: 'Minimal Assist', strength: 'Fair' } }));
    expect(buildRequestAssessment(blankGlobal, rated)).toEqual({ ...blankGlobal, assistance: 'Minimal Assist', strength: 'Fair' });
  });

  it('never overwrites a value typed on the global control, and leaves disagreement blank', () => {
    const rated = [
      { name: 'A', assessment: { assistance: 'Minimal Assist', performance: 'Improved' } },
      { name: 'B', assessment: { assistance: 'Independent', performance: 'Improved' } },
    ];
    const merged = mergeGlobalAssessment({ ...blankGlobal, assistance: 'Moderate Assist' }, rated);
    expect(merged.assistance).toBe('Moderate Assist');
    expect(merged.performance).toBe('Improved');
    expect(mergeGlobalAssessment(blankGlobal, rated).assistance).toBe('');
  });

  it('with nothing rated, the request assessment stays blank (no invented defaults)', () => {
    expect(buildRequestAssessment(blankGlobal, activities)).toEqual(blankGlobal);
  });

  // Review on #471: the page used to mirror the derived value into the global
  // state, after which it looked typed and a second Apply to All could not
  // change it. The global state must stay blank across both applications and
  // the request must follow the latest per-exercise values.
  it('Apply to All Minimal, then Apply to All Moderate: the request carries Moderate', () => {
    let globalState = { ...blankGlobal };
    let acts = applyRatingsToAllActivities(activities, { ...blankGlobal, assistance: 'Minimal Assist', performance: 'Improved' });
    expect(buildRequestAssessment(globalState, acts).assistance).toBe('Minimal Assist');
    // The page no longer writes anything back into globalState here.
    acts = applyRatingsToAllActivities(acts, { ...blankGlobal, assistance: 'Moderate Assist', performance: 'Declined' });
    const body = buildRequestAssessment(globalState, acts);
    expect(body.assistance).toBe('Moderate Assist');
    expect(body.performance).toBe('Declined');
    expect(globalState).toEqual(blankGlobal);
  });

  it('per-exercise values that disagree after an edit leave the derived field blank again', () => {
    const acts = applyRatingsToAllActivities(activities, { ...blankGlobal, assistance: 'Moderate Assist', strength: 'Fair' });
    const edited = acts.map((a) => (a.name === 'Pegboard - Functional' ? { ...a, assessment: { ...a.assessment, assistance: 'Independent' } } : a));
    const body = buildRequestAssessment(blankGlobal, edited);
    expect(body.assistance).toBe('');
    expect(body.strength).toBe('Fair');
  });
});
