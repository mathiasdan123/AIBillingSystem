import { describe, expect, it, vi } from 'vitest';

// The service module imports the storage layer (which demands DATABASE_URL at
// import time); the functions under test never touch it.
vi.mock('../storage', () => ({ storage: {} }));

import { hasUnsupportedMoodClause, stripUnsupportedMoodClause } from '../services/aiSoapBillingService';

// Deterministic backstop for mood/presentation fabrication: the prompt has
// explicitly forbidden defaulting to "a plausible-sounding word like
// 'cooperative' or 'engaged'" since #420, yet confirmed in production (clean
// -room test, Mia Example, Mood/Behavior and comments both blank): "Mia
// presented as cooperative during today's session" -- the model used the
// EXACT banned word. Same lesson #423/#425 taught for the Plan closing
// sentence: prompt-level prohibition alone isn't reliable, so this strips
// the pattern deterministically whenever mood is blank.
describe('stripUnsupportedMoodClause', () => {
  it('strips the exact fabricated sentence confirmed in production testing', () => {
    const subjective = "Mia presented as cooperative during today's session.";
    const stripped = stripUnsupportedMoodClause(subjective, false);
    expect(stripped).not.toMatch(/presented as/i);
    expect(stripped).not.toContain('cooperative');
  });

  it('strips only the mood clause, preserving other sentences in the same section', () => {
    const subjective =
      "Mia presented as cooperative during today's session. No caregiver report was provided this session.";
    const stripped = stripUnsupportedMoodClause(subjective, false);
    expect(stripped).not.toMatch(/presented as/i);
    expect(stripped).toContain('No caregiver report was provided this session.');
  });

  it('does NOT strip when hasMood is true -- a real mood value legitimately produces this phrasing', () => {
    const subjective = "Mia presented as cooperative during today's session.";
    expect(stripUnsupportedMoodClause(subjective, true)).toBe(subjective);
  });

  it('does not touch legitimate clinical content using similar vocabulary', () => {
    const legitimate = [
      'Patient appeared to have difficulty maintaining balance during the obstacle course.',
      'The child seemed fatigued after 8 minutes of sustained activity.',
      'Session conducted in the sensory gym for 45 minutes.',
      'Required moderate assist for ball skills.',
    ];
    for (const text of legitimate) {
      expect(stripUnsupportedMoodClause(text, false)).toBe(text);
      expect(hasUnsupportedMoodClause(text)).toBe(false);
    }
  });

  it('handles empty input', () => {
    expect(stripUnsupportedMoodClause('', false)).toBe('');
  });
});

describe('hasUnsupportedMoodClause', () => {
  it('gives a consistent answer across repeated calls (regex g-flag statefulness)', () => {
    const text = "Mia presented as cooperative during today's session.";
    expect(hasUnsupportedMoodClause(text)).toBe(true);
    expect(hasUnsupportedMoodClause(text)).toBe(true);
    expect(hasUnsupportedMoodClause(text)).toBe(true);
  });
});
