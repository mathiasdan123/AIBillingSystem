import { describe, expect, it, vi } from 'vitest';

// The service module imports the storage layer (which demands DATABASE_URL at
// import time); the functions under test never touch it.
vi.mock('../storage', () => ({ storage: {} }));

import {
  groundingEvidenceFor,
  hasUnsupportedNegativeFinding,
  hasUnsupportedTherapistAction,
  stripUnsupportedNegativeFindings,
  stripUnsupportedTherapistActions,
  therapistActionsDocumented,
} from '../services/aiSoapBillingService';

/**
 * Grounding in both directions (QA sweep 2026-11-18, Riley Nodob repro):
 * thin input -- one activity whose account reads "five sets of ten jumps,
 * one-minute pauses, no pain", every rating blank. The AI note kept the
 * account but added three things nobody entered: "no observable distress",
 * "Standardized measurements were not administered; observations were
 * qualitative", and therapist grading/monitoring. A negative finding and an
 * unentered service are fabrications exactly as a fabricated positive is;
 * these backstops are gated on what the therapist actually typed.
 */
const RILEY = {
  patientId: 7,
  activities: ['Trampoline - Strengthening'],
  activityDetails: [{ name: 'Trampoline - Strengthening', response: 'five sets of ten jumps, one-minute pauses, no pain' }],
  mood: '',
  duration: 45,
  location: 'Clinic',
  assessment: { performance: '', assistance: '', strength: '', motorPlanning: '', sensoryRegulation: '' },
  planNextSteps: '',
  nextSessionFocus: 'reassess jumping endurance',
} as any;
const evidence = groundingEvidenceFor(RILEY);

describe('stripUnsupportedNegativeFindings', () => {
  it('strips the exact measurement-denial sentence the QA sweep found (and the prompt once instructed)', () => {
    const text = 'Standardized measurements were not administered; observations were qualitative.';
    expect(hasUnsupportedNegativeFinding(text, evidence)).toBe(true);
    expect(stripUnsupportedNegativeFindings(text, evidence)).toBe('');
  });

  it('strips "no observable distress" when nothing entered mentions distress', () => {
    expect(stripUnsupportedNegativeFindings('No observable distress was noted during the activity.', evidence)).toBe('');
    expect(stripUnsupportedNegativeFindings('Patient tolerated the activity without signs of fatigue.', evidence)).toBe('');
  });

  it('keeps a negative the account DID state: "no pain" is in the therapist\'s own words', () => {
    const grounded = [
      'Riley completed five sets of ten jumps with one-minute pauses and reported no pain.',
      'Patient denied pain throughout.',
      'Jumping bouts were pain-free per the therapist\'s account.',
    ];
    for (const text of grounded) {
      expect(hasUnsupportedNegativeFinding(text, evidence)).toBe(false);
      expect(stripUnsupportedNegativeFindings(text, evidence)).toBe(text);
    }
  });

  it('in a mixed sentence removes only the ungrounded clause and keeps the grounded one', () => {
    const text = 'Patient reported no pain and showed no observable distress.';
    expect(stripUnsupportedNegativeFindings(text, evidence)).toBe('Patient reported no pain.');
  });

  it('removes only the offending sentences from a multi-sentence section', () => {
    const objective =
      'Session conducted in Clinic for 45 minutes. Standardized measurements were not administered; observations were qualitative.\n\n' +
      'Trampoline jumping targets lower-extremity strength and endurance. Patient tolerated the activity without signs of fatigue.';
    expect(stripUnsupportedNegativeFindings(objective, evidence)).toBe(
      'Session conducted in Clinic for 45 minutes.\n\nTrampoline jumping targets lower-extremity strength and endurance.',
    );
  });

  it('is input-aware: the same sentence survives when a field supplies the topic', () => {
    const withFatigue = groundingEvidenceFor({
      ...RILEY,
      activityDetails: [{ name: 'Trampoline - Strengthening', response: 'no fatigue across five sets' }],
    });
    const text = 'Patient tolerated the activity without signs of fatigue.';
    expect(hasUnsupportedNegativeFinding(text, withFatigue)).toBe(false);
    expect(stripUnsupportedNegativeFindings(text, withFatigue)).toBe(text);
  });

  it('does not touch positive clinical content or negations about other things', () => {
    const legitimate = [
      'Trampoline work targets lower-extremity strength and endurance to support sustained play participation.',
      'No home program assigned this session.',
      'Patient required moderate assist for ball skills.',
      'Session conducted in the sensory gym for 45 minutes.',
    ];
    for (const text of legitimate) {
      expect(hasUnsupportedNegativeFinding(text, evidence)).toBe(false);
      expect(stripUnsupportedNegativeFindings(text, evidence)).toBe(text);
    }
  });

  it('handles empty input', () => {
    expect(stripUnsupportedNegativeFindings('', evidence)).toBe('');
    expect(hasUnsupportedNegativeFinding('', evidence)).toBe(false);
  });

  // PR #464 review: a sentence that CONDITIONS on a symptom is not asserting
  // its absence. Precautions pair a negation with pain/fatigue/distress the
  // input never mentioned and must survive -- in the Plan, where they live,
  // and anywhere else they appear.
  it('keeps conditional / precaution sentences in the Plan', () => {
    const plan =
      'Next session focus:\n• reassess jumping endurance\n\n' +
      'Stop the activity if the patient shows pain or fatigue; do not push through. ' +
      'Monitor for signs of distress and discontinue if discomfort is reported. ' +
      'Caregivers were instructed to report any complaints of pain after sessions.';
    expect(hasUnsupportedNegativeFinding(plan, evidence)).toBe(false);
    expect(stripUnsupportedNegativeFindings(plan, evidence)).toBe(plan);
  });

  it('keeps a precaution in the Objective too, while still removing a fabricated finding beside it', () => {
    const objective =
      'Trampoline jumping targets lower-extremity strength and endurance. ' +
      'Activity was to be stopped if the patient showed pain or fatigue. ' +
      'No observable distress was noted.';
    expect(stripUnsupportedNegativeFindings(objective, evidence)).toBe(
      'Trampoline jumping targets lower-extremity strength and endurance. Activity was to be stopped if the patient showed pain or fatigue.',
    );
  });

  it('a fabricated negative in the Plan is still removed when nothing conditions it', () => {
    const plan = 'Continue trampoline work next session. No distress was observed, so intensity can increase.';
    expect(stripUnsupportedNegativeFindings(plan, evidence)).toBe('Continue trampoline work next session.');
  });

  // Review on #467: the first exemption fired on ANY "when", "pause",
  // "hold", "avoid" or "notify" anywhere in the sentence. These are findings
  // dressed in precaution vocabulary and must still be stripped.
  it('negative controls: findings phrased with "when"/"pauses" are not precautions', () => {
    for (const fabricated of [
      'No signs of fatigue when jumping.',
      'Tolerated well without discomfort when pauses were taken.',
      'No distress when transitioning between activities.',
      'Patient denied discomfort when asked at the end of the session.',
      'Held the position without complaint whenever prompted.',
    ]) {
      // ("Patient denied pain when asked" is deliberately NOT here: the account
      // says "no pain", so that negative is supported and must be kept.)
      expect(hasUnsupportedNegativeFinding(fabricated, evidence)).toBe(true);
      expect(stripUnsupportedNegativeFindings(`Trampoline jumping targets endurance. ${fabricated}`, evidence)).toBe(
        'Trampoline jumping targets endurance.',
      );
    }
  });

  it('the topic must follow the lead-in: a finding BEFORE a precaution in the same clause is still a finding', () => {
    expect(hasUnsupportedNegativeFinding('No distress noted; monitor for fatigue next time.', evidence)).toBe(true);
    expect(stripUnsupportedNegativeFindings('No distress noted; monitor for fatigue next time.', evidence)).toBe(
      'Monitor for fatigue next time.',
    );
  });

  it('a fabricated finding joined to a precaution: the finding goes, the precaution clause stays', () => {
    expect(
      stripUnsupportedNegativeFindings('No distress was observed, and stop the activity if the patient shows fatigue.', evidence),
    ).toBe('Stop the activity if the patient shows fatigue.');
    expect(
      stripUnsupportedNegativeFindings('Discontinue the session if the patient reports pain, and no fatigue was noted today.', evidence),
    ).toBe('Discontinue the session if the patient reports pain.');
  });

  it('forward-looking precautions with the narrowed lead-ins all survive', () => {
    for (const precaution of [
      'Stop the activity if the patient shows pain or fatigue; do not push through.',
      'Pause the exercise should Riley report discomfort.',
      'Monitor for signs of distress; do not continue past the first complaint.',
      'Caregivers were instructed to report any complaints of pain, and not to push through fatigue.',
      'Discontinue the trial unless the patient has no pain at rest.',
    ]) {
      expect(hasUnsupportedNegativeFinding(precaution, evidence)).toBe(false);
      expect(stripUnsupportedNegativeFindings(precaution, evidence)).toBe(precaution);
    }
  });
});

describe('stripUnsupportedTherapistActions', () => {
  it('a bare activity account with no assistance level documents no therapist action', () => {
    expect(therapistActionsDocumented(evidence)).toBe(false);
  });

  it('strips grading/monitoring claims nothing entered supports, keeping targeting language', () => {
    const assessment =
      'Trampoline jumping targets lower-extremity strength and endurance. The therapist graded the jumping bouts and monitored for fatigue. Verbal cues were provided to maintain rhythm.';
    expect(hasUnsupportedTherapistAction(assessment, evidence)).toBe(true);
    expect(stripUnsupportedTherapistActions(assessment, evidence)).toBe(
      'Trampoline jumping targets lower-extremity strength and endurance.',
    );
  });

  it('keeps the same claims when an assistance level was entered', () => {
    const withAssist = groundingEvidenceFor({ ...RILEY, assessment: { ...RILEY.assessment, assistance: 'Minimal Assist' } });
    const text = 'The therapist graded the jumping bouts and monitored for fatigue.';
    expect(therapistActionsDocumented(withAssist)).toBe(true);
    expect(hasUnsupportedTherapistAction(text, withAssist)).toBe(false);
    expect(stripUnsupportedTherapistActions(text, withAssist)).toBe(text);
  });

  it('keeps the same claims when the account itself describes therapist support', () => {
    const withCues = groundingEvidenceFor({
      ...RILEY,
      activityDetails: [{ name: 'Trampoline - Strengthening', response: 'needed verbal cues to keep rhythm; graded down to 3 sets' }],
    });
    const text = 'Verbal cues were provided to maintain rhythm and the task was graded to three sets.';
    expect(hasUnsupportedTherapistAction(text, withCues)).toBe(false);
    expect(stripUnsupportedTherapistActions(text, withCues)).toBe(text);
  });

  // PR #464 review: clause-level removal, so a sentence carrying both an
  // unsupported action and an entered fact keeps the fact.
  it('removes only the action clause from a mixed sentence and keeps the entered fact', () => {
    expect(
      stripUnsupportedTherapistActions('Riley completed five sets of ten jumps while the therapist graded the task.', evidence),
    ).toBe('Riley completed five sets of ten jumps.');
    expect(
      stripUnsupportedTherapistActions('The therapist graded the task, and Riley completed five sets of ten jumps with one-minute pauses.', evidence),
    ).toBe('Riley completed five sets of ten jumps with one-minute pauses.');
    expect(
      stripUnsupportedTherapistActions('Riley completed five sets of ten jumps; verbal cues were provided between sets.', evidence),
    ).toBe('Riley completed five sets of ten jumps.');
  });

  it('still drops a sentence whose every clause claims an action', () => {
    expect(stripUnsupportedTherapistActions('The therapist graded the jumping bouts and monitored for fatigue.', evidence)).toBe('');
    expect(stripUnsupportedTherapistActions('Verbal cues were provided to maintain rhythm.', evidence)).toBe('');
  });

  it('does not flag "adaptive equipment" or the "modified independent" assistance level', () => {
    const legitimate = [
      'Riley used adaptive equipment (a jump handle) for the trampoline bouts.',
      'Adaptive seating was in place for tabletop work.',
      'Riley was modified independent for transfers on and off the trampoline.',
    ];
    for (const text of legitimate) {
      expect(hasUnsupportedTherapistAction(text, evidence)).toBe(false);
      expect(stripUnsupportedTherapistActions(text, evidence)).toBe(text);
    }
  });

  it('never flags the payer vocabulary the prompt asks for (skilled, targets, neuromuscular re-education)', () => {
    const text =
      'Skilled occupational therapy targeting lower-extremity strength through neuromuscular re-education; the activity demands sustained postural control.';
    expect(hasUnsupportedTherapistAction(text, evidence)).toBe(false);
    expect(stripUnsupportedTherapistActions(text, evidence)).toBe(text);
  });
});
