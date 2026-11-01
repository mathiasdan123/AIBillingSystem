import { describe, expect, it, vi } from 'vitest';

// The service module imports the storage layer (which demands DATABASE_URL at
// import time); the function under test never touches it.
vi.mock('../storage', () => ({ storage: {} }));

import { hasUnsupportedPlanClosing, stripUnsupportedPlanClosing } from '../services/aiSoapBillingService';

// Deterministic backstop for a fabrication that recurred three times despite
// prompt-level prohibition across #421-#424: a generic "[Patient] will
// continue to benefit from/participate in skilled occupational therapy to
// address identified deficits..." closing sentence in CASE A (no prior plan,
// no active treatment goals), where there's nothing to ground that claim in.
//
// Widened 2026-11-01: the eval harness's first live-credentials run (10
// samples/scenario against the real model) found the original regex --
// scoped to one literal phrase -- caught only 1 of 16 real paraphrases in a
// single run. The cases below (liveRunFailures) are the real sentences from
// that run; see the SKILLED_OT_CONTINUATION_CLOSING comment in
// aiSoapBillingService.ts for the full account, including the 3 of 16 that
// remain deliberately uncaught (bare necessity claims with no continuity
// word -- a different, harder-to-safely-regex problem).
describe('stripUnsupportedPlanClosing', () => {
  const noPlanContext = false;
  const noGoalsContext = false;

  it('strips the exact fabricated sentences confirmed in production testing', () => {
    const cases = [
      'Next session will focus on bilateral coordination. No home program assigned this session. Patient will continue to benefit from skilled occupational therapy services to address identified deficits in endurance, motor planning, and bilateral coordination supporting functional participation in age-appropriate activities.',
      "Next session will focus on bilateral coordination. No home program assigned this session. Sofia will continue to participate in skilled occupational therapy services to address identified areas of need through graded therapeutic activities and neuromuscular re-education.",
      'Next session will focus on bilateral coordination. No home program assigned this session. Patient will continue to participate in skilled occupational therapy to address identified deficits in strength, endurance, bilateral coordination, and sustained attention through graded therapeutic activities and neuromuscular re-education.',
    ];
    for (const plan of cases) {
      const stripped = stripUnsupportedPlanClosing(plan, noPlanContext, noGoalsContext);
      expect(stripped).not.toMatch(/skilled/i);
      expect(stripped).not.toMatch(/continue to (benefit from|participate in)/i);
      expect(stripped).toContain('Next session will focus on bilateral coordination.');
      expect(stripped).toContain('No home program assigned this session.');
    }
  });

  it('strips the real paraphrases confirmed in the eval harness live run (2026-11-01)', () => {
    const liveRunFailures = [
      'Patient will continue to participate in skilled occupational therapy services to address identified areas of motor planning, bilateral coordination, and endurance through neuromuscular re-education and graded therapeutic activities.',
      'Skilled occupational therapy services targeting bilateral coordination and sustained attention remain indicated to address observed limitations in endurance and to continue developing motor planning skills necessary for functional participation in school and play activities.',
      'Skilled occupational therapy services remain medically necessary to address documented deficits in motor planning, bilateral coordination, and endurance that impact functional participation in age-appropriate play, school activities, and physical education tasks.',
      'The documented need for rest breaks during sustained motor activity and reliance on verbal cueing for task completion support continued need for skilled occupational therapy intervention.',
      'Graded therapeutic activities and neuromuscular re-education remain medically necessary to address motor planning deficits, bilateral coordination limitations, and reduced motor endurance that restrict independent participation in age-appropriate functional motor tasks.',
      'Continue therapeutic intervention targeting these areas to support functional motor participation.',
      "Patient's performance demonstrates ongoing need for skilled occupational therapy intervention to address motor planning deficits affecting functional task completion, bilateral coordination difficulties impacting complex movement sequences, and endurance limitations restricting sustained participation in age-appropriate physical activities.",
      'Performance during this session demonstrates need for continued skilled occupational therapy intervention to address motor planning, endurance, and adaptive motor responses.',
      'These observations indicate continued need for skilled occupational therapy intervention to address endurance limitations and motor planning skills that impact functional participation in age-appropriate physical activities.',
      'Patient demonstrates need for ongoing skilled therapeutic intervention including neuromuscular re-education, graded task demands, and clinical analysis of performance patterns to support development of motor skills necessary for functional independence.',
      // The Goals-subsection variant (Check 4's #424 seed phrase, still recurring verbatim)
      'Goals: Continue working toward established treatment goals as documented in the plan of care.',
    ];
    for (const sentence of liveRunFailures) {
      expect(stripUnsupportedPlanClosing(sentence, noPlanContext, noGoalsContext)).toBe('');
      expect(hasUnsupportedPlanClosing(sentence)).toBe(true);
    }
  });

  it('does NOT catch bare necessity claims with no continuity word (documented, deliberate gap)', () => {
    // These 3 of the 16 live-run failures assert medical necessity with
    // nothing to ground it in, same underlying problem as the cases above --
    // but carry no continue/continued/remain/ongoing signal at all. Matching
    // on "asserts necessity" alone would require flagging almost any
    // clinical-sounding sentence, which is an unacceptable false-positive
    // risk against legitimately grounded necessity statements. Left to
    // prompt-level handling (rule #4: omit an ungrounded necessity
    // statement) rather than a backstop. This test exists so a future reader
    // sees this is a known, considered gap, not an oversight.
    const ungroundedButNoContinuitySignal = [
      'Skilled occupational therapy services targeting motor planning, bilateral coordination, and sustained attention through graded neuromuscular re-education and therapeutic activities support functional participation in age-appropriate motor tasks.',
      "Patient's performance demonstrates need for skilled occupational therapy intervention to address motor planning deficits affecting functional task completion, bilateral coordination difficulties impacting complex movement sequences, and endurance limitations restricting sustained participation in age-appropriate physical activities.",
      'Clinical reasoning and task grading are required to support development of sustained attention and motor control necessary for age-appropriate functional participation.',
    ];
    for (const sentence of ungroundedButNoContinuitySignal) {
      expect(hasUnsupportedPlanClosing(sentence)).toBe(false);
    }
  });

  it('does not touch legitimate CASE A content', () => {
    const legitimate = [
      'Continue current treatment frequency.',
      'No home program assigned this session.',
      'Next session will focus on bilateral coordination and sustained attention through graded therapeutic activities.',
      'Continue to monitor for signs of fatigue during dynamic activities.',
      'Continue home exercise program as previously instructed by caregiver.',
      'Reviewed continuation of current home strategies; no changes to home program at this time.',
    ];
    for (const plan of legitimate) {
      expect(stripUnsupportedPlanClosing(plan, noPlanContext, noGoalsContext)).toBe(plan);
    }
  });

  it('does not touch legitimate CASE B (carry-forward) content, even with similar vocabulary', () => {
    const planWithContext =
      'Current plan remains appropriate; no changes recommended. Continue OT 2x/week focusing on bilateral coordination. Treatment frequency: Continue current treatment frequency.';
    expect(stripUnsupportedPlanClosing(planWithContext, true, false)).toBe(planWithContext);
    expect(stripUnsupportedPlanClosing(planWithContext, false, true)).toBe(planWithContext);
  });

  it('leaves the plan untouched when there is no match', () => {
    const plan = 'Goals: Improve bilateral coordination for ball skills.';
    expect(stripUnsupportedPlanClosing(plan, noPlanContext, noGoalsContext)).toBe(plan);
  });

  it('handles empty input', () => {
    expect(stripUnsupportedPlanClosing('', noPlanContext, noGoalsContext)).toBe('');
  });
});

// Exposed so the live-model eval harness (scripts/eval-plan-fabrication.ts)
// can assert on raw AI output directly, without duplicating the regex.
describe('hasUnsupportedPlanClosing', () => {
  it('detects the pattern regardless of hasMostRecentPlanContext/hasActiveGoalsContext', () => {
    const fabricated =
      'Patient will continue to participate in skilled occupational therapy to address identified deficits.';
    expect(hasUnsupportedPlanClosing(fabricated)).toBe(true);
  });

  it('returns false for legitimate content', () => {
    expect(hasUnsupportedPlanClosing('Continue current treatment frequency.')).toBe(false);
    expect(hasUnsupportedPlanClosing('')).toBe(false);
  });

  it('gives a consistent answer across repeated calls (regex g-flag statefulness)', () => {
    const fabricated =
      'Patient will continue to participate in skilled occupational therapy to address identified deficits.';
    expect(hasUnsupportedPlanClosing(fabricated)).toBe(true);
    expect(hasUnsupportedPlanClosing(fabricated)).toBe(true);
    expect(hasUnsupportedPlanClosing(fabricated)).toBe(true);
  });
});
