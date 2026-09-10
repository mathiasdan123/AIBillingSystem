import { describe, expect, it, vi } from 'vitest';

// The service module imports the storage layer (which demands DATABASE_URL at
// import time); the prompt builder under test never touches it.
vi.mock('../storage', () => ({ storage: {} }));

import { buildUserPrompt } from '../services/aiSoapBillingService';

const patient = { firstName: 'Test', lastName: 'Child', dateOfBirth: '2019-03-01' };

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    patientId: 1,
    activities: ['Swing', 'Obstacle Course'],
    mood: 'Cooperative',
    duration: 45,
    location: 'Clinic',
    assessment: {
      performance: 'Stable',
      assistance: 'Minimal Assist',
      strength: 'Adequate',
      motorPlanning: 'Mild Difficulty',
      sensoryRegulation: 'Needed Minimal Supports',
    },
    planNextSteps: 'Continue Current Goals',
    ...overrides,
  } as any;
}

describe('buildUserPrompt — narrative-first Objective input', () => {
  it('embeds each activity narrative as the primary source', () => {
    const prompt = buildUserPrompt(
      baseRequest({
        activityDetails: [
          { name: 'Swing', response: 'High arousal at start; after graded vestibular input, followed a 2-step direction.' },
        ],
      }),
      patient, 3, null,
    );
    expect(prompt).toContain("THERAPIST'S ACCOUNT");
    expect(prompt).toContain('followed a 2-step direction');
    // The clinical-arc instruction only appears when narratives exist
    expect(prompt).toContain('presentation before → skilled intervention provided');
    // Activity without a narrative renders plain
    expect(prompt).toContain('- Obstacle Course');
  });

  it('omits the narrative instruction block when no narratives were entered', () => {
    const prompt = buildUserPrompt(baseRequest(), patient, 3, null);
    expect(prompt).not.toContain("THERAPIST'S ACCOUNT");
    expect(prompt).not.toContain('presentation before → skilled intervention provided');
  });
});

describe('buildUserPrompt — prior session context', () => {
  it('includes prior session summaries as the sanctioned comparison source', () => {
    const prompt = buildUserPrompt(
      baseRequest(), patient, 3, null, undefined, undefined,
      [{ date: '2026-09-03T10:00:00Z', objective: 'Required moderate assist for ball skills.', assessment: 'Emerging postural control.' }],
    );
    expect(prompt).toContain('PRIOR SESSION SUMMARIES');
    expect(prompt).toContain('Session 2026-09-03');
    expect(prompt).toContain('Required moderate assist for ball skills.');
  });

  it('omits the section when there are no prior sessions', () => {
    const prompt = buildUserPrompt(baseRequest(), patient, 3, null, undefined, undefined, []);
    expect(prompt).not.toContain('PRIOR SESSION SUMMARIES');
  });
});

describe('buildUserPrompt — plan carry-forward (Phase 3)', () => {
  it('includes the most recent plan as the carry-forward baseline', () => {
    const prompt = buildUserPrompt(
      baseRequest(), patient, 3, null, undefined, undefined,
      [
        { date: '2026-09-03', objective: 'obj', assessment: 'assess', plan: 'Continue OT 2x/week focusing on bilateral coordination.' },
        { date: '2026-08-27', objective: 'older', plan: 'Older plan.' },
      ],
    );
    expect(prompt).toContain('MOST RECENT PLAN (carry-forward baseline');
    expect(prompt).toContain('Continue OT 2x/week focusing on bilateral coordination.');
    expect(prompt).not.toContain('MOST RECENT PLAN (carry-forward baseline — see the plan instructions):\nOlder plan.');
    expect(prompt).toContain('Current plan remains appropriate; no changes recommended.');
  });

  it('omits the baseline when prior sessions carry no plan', () => {
    const prompt = buildUserPrompt(
      baseRequest(), patient, 3, null, undefined, undefined,
      [{ date: '2026-09-03', objective: 'obj' }],
    );
    expect(prompt).not.toContain('MOST RECENT PLAN (carry-forward baseline');
  });
});
