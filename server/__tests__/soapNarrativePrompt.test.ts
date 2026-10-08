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

describe('buildUserPrompt — active treatment goals as grounded context', () => {
  const goals = [
    {
      goalNumber: 1,
      description: 'Will don jacket independently in 4/5 trials',
      status: 'in_progress',
      progressPercentage: 40,
      goalTerm: 'short_term',
      durationWeeks: 12,
      startDate: '2026-08-01',
      baselineMeasure: 'Max assist for all fasteners',
      targetMeasure: '4/5 trials independent',
      currentMeasure: 'Mod assist with zipper',
    },
    // Legacy row: the #377 columns are nullable — must render without them.
    { description: 'Improve bilateral coordination for ball skills', status: 'in_progress' },
  ];

  it('includes active goals with their fields, framed as CONTEXT ONLY with the anti-fabrication rule', () => {
    const prompt = buildUserPrompt(baseRequest(), patient, 3, null, undefined, goals as any);
    expect(prompt).toContain('ACTIVE TREATMENT GOALS (CONTEXT ONLY');
    // Grounding rule travels with the data, not just the system prompt.
    expect(prompt).toContain('NEVER claim progress toward a goal');
    expect(prompt).toContain('Goal 1: Will don jacket independently in 4/5 trials');
    expect(prompt).toContain('status: in_progress');
    expect(prompt).toContain('term: short_term');
    expect(prompt).toContain('duration: 12 weeks');
    expect(prompt).toContain('started: 2026-08-01');
    expect(prompt).toContain('baseline: Max assist for all fasteners');
    expect(prompt).toContain('target: 4/5 trials independent');
    // Legacy goal renders from description + status alone.
    expect(prompt).toContain('Improve bilateral coordination for ball skills (status: in_progress)');
  });

  it('omits the goals section when there are no active goals', () => {
    const prompt = buildUserPrompt(baseRequest(), patient, 3, null, undefined, []);
    expect(prompt).not.toContain('ACTIVE TREATMENT GOALS');
  });
});

describe('buildUserPrompt — per-activity CPT pairing output contract', () => {
  it('requires an activityCptPairings array consistent with the aggregate codes', () => {
    const prompt = buildUserPrompt(baseRequest(), patient, 3, null);
    expect(prompt).toContain('"activityCptPairings"');
    expect(prompt).toContain('EXACTLY ONE entry per activity');
    expect(prompt).toContain('consistent with cptCodes[].activitiesAssigned');
    expect(prompt).toContain('conservative default 97530');
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
