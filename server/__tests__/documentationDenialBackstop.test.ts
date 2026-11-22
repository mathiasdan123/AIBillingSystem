import { describe, expect, it, vi } from 'vitest';

// The service module imports the storage layer (which demands DATABASE_URL at
// import time); the functions under test never touch it.
vi.mock('../storage', () => ({ storage: {} }));

import {
  hasUnsupportedDocumentationDenialClause,
  stripUnsupportedDocumentationDenialClause,
} from '../services/aiSoapBillingService';

// Deterministic backstop for the "documentation denial" fabrication: the
// prompt has forbidden asserting a blank field was confirmed absent since
// the original caregiver-report fix ("do NOT write 'Caregiver report was
// not obtained this session' or anything asserting that no report was
// given"). Confirmed in a live retest (Mia Example, clean room, caregiver
// report and mood both blank): "No caregiver report or patient mood was
// documented this session." -- a different SHAPE of the same banned claim
// that evaded hasUnsupportedMoodClause (which only matches "presented as").
describe('stripUnsupportedDocumentationDenialClause', () => {
  it('strips the exact fabricated sentence confirmed in a live retest', () => {
    const subjective = 'No caregiver report or patient mood was documented this session.';
    const stripped = stripUnsupportedDocumentationDenialClause(subjective);
    expect(stripped).toBe('');
  });

  it('strips the original banned phrase the prompt itself names', () => {
    const subjective = 'Caregiver report was not obtained this session.';
    expect(stripUnsupportedDocumentationDenialClause(subjective)).toBe('');
  });

  it('strips only the denial clause, preserving other sentences in the same section', () => {
    const subjective =
      'No caregiver report or patient mood was documented this session. Session conducted in the sensory gym for 45 minutes.';
    const stripped = stripUnsupportedDocumentationDenialClause(subjective);
    expect(stripped).toBe('Session conducted in the sensory gym for 45 minutes.');
  });

  it('does not touch legitimate sentences that are positively documented', () => {
    const legitimate = [
      'Caregiver reported: improved sleep this week.',
      "Mia presented as cooperative during today's session.",
      'Mood was documented as anxious based on caregiver report.',
      'Patient appeared to have difficulty maintaining balance during the obstacle course.',
      'Assessment of fine motor skills was completed and recorded in the chart.',
      'Session conducted in the sensory gym for 45 minutes.',
    ];
    for (const text of legitimate) {
      expect(stripUnsupportedDocumentationDenialClause(text)).toBe(text);
      expect(hasUnsupportedDocumentationDenialClause(text)).toBe(false);
    }
  });

  it('handles empty input', () => {
    expect(stripUnsupportedDocumentationDenialClause('')).toBe('');
  });

  it('catches close variants of the same claim shape', () => {
    const variants = [
      'No mood was documented.',
      'No caregiver report was provided this session.',
      'Patient presentation was not recorded during the session.',
    ];
    for (const text of variants) {
      expect(hasUnsupportedDocumentationDenialClause(text)).toBe(true);
      expect(stripUnsupportedDocumentationDenialClause(text)).toBe('');
    }
  });
});

describe('hasUnsupportedDocumentationDenialClause', () => {
  it('gives a consistent answer across repeated calls (regex g-flag statefulness)', () => {
    const text = 'No caregiver report or patient mood was documented this session.';
    expect(hasUnsupportedDocumentationDenialClause(text)).toBe(true);
    expect(hasUnsupportedDocumentationDenialClause(text)).toBe(true);
    expect(hasUnsupportedDocumentationDenialClause(text)).toBe(true);
  });
});
