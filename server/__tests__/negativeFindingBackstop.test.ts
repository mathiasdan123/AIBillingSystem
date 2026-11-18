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

  it('never flags the payer vocabulary the prompt asks for (skilled, targets, neuromuscular re-education)', () => {
    const text =
      'Skilled occupational therapy targeting lower-extremity strength through neuromuscular re-education; the activity demands sustained postural control.';
    expect(hasUnsupportedTherapistAction(text, evidence)).toBe(false);
    expect(stripUnsupportedTherapistActions(text, evidence)).toBe(text);
  });
});
