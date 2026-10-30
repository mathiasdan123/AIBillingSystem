import { describe, expect, it, vi } from 'vitest';

// The service module imports the storage layer (which demands DATABASE_URL at
// import time); the prompt builder under test never touches it.
vi.mock('../storage', () => ({ storage: {} }));

import { buildUserPrompt, fallbackGeneration, validateAndEnhanceResponse } from '../services/aiSoapBillingService';

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
    // The plan field's instructions reference the section name generically
    // (so the model can check whether it's present) -- what must never
    // appear is the actual injected goals block itself.
    expect(prompt).not.toContain('ACTIVE TREATMENT GOALS (CONTEXT ONLY');
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

describe('buildUserPrompt — patient age from dateOfBirth', () => {
  it('computes a real age when dateOfBirth is a valid date', () => {
    const prompt = buildUserPrompt(baseRequest(), { ...patient, dateOfBirth: '2019-03-01' }, 3, null);
    expect(prompt).toMatch(/- Age: \d+ years/);
    expect(prompt).not.toContain('Age: unknown');
  });

  // Regression test: new Date(null) silently resolves to the Unix epoch
  // (1970-01-01) rather than an Invalid Date, so a patient with no DOB on
  // file previously got a fabricated age (56, as of this test suite's era)
  // fed into the prompt as if it were real patient data. Confirmed in
  // production against a patient created with DOB left blank.
  for (const [label, dob] of [
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ] as const) {
    it(`does not fabricate an epoch-derived age when dateOfBirth is ${label}`, () => {
      const prompt = buildUserPrompt(baseRequest(), { ...patient, dateOfBirth: dob }, 3, null);
      expect(prompt).toContain('- Age: unknown (date of birth not on file -- do not guess or assume an age)');
      expect(prompt).not.toMatch(/- Age: \d+ years/);
    });
  }
});

describe('buildUserPrompt — blank caregiver report is omitted, not asserted as a negative', () => {
  // A blank caregiverReport field means the therapist didn't type anything
  // here, not that we know no caregiver report was obtained. Asserting
  // "Caregiver report was not obtained this session" is itself a
  // fabrication -- the same pattern as the Plan-section fixes, applied to
  // Subjective.
  it('no longer instructs the model to assert caregiver report "was not obtained"', () => {
    const prompt = buildUserPrompt(baseRequest({ caregiverReport: undefined }), patient, 3, null);
    // The old instruction told the model to STATE the negative; the field
    // hint must no longer say that (the prohibition text elsewhere
    // legitimately quotes the banned phrase to explain what NOT to write,
    // same pattern as the Plan-section fixes -- so this checks the old
    // instructional framing specifically, not the substring's bare absence).
    expect(prompt).not.toContain('state that it was not obtained');
    expect(prompt).toContain('omit any caregiver-report sentence entirely');
  });

  it('still reflects a real caregiver report when one is provided', () => {
    const prompt = buildUserPrompt(baseRequest({ caregiverReport: 'anxious this morning' }), patient, 3, null);
    expect(prompt).toContain('anxious this morning');
  });
});

describe('fallbackGeneration — blank mood/caregiver report are omitted, not fabricated', () => {
  const fallbackPatient = { firstName: 'Fallback', lastName: 'Child' };

  it('omits both lines when mood and caregiverReport are blank, rather than asserting a negative or writing broken prose', () => {
    const response = fallbackGeneration(
      baseRequest({ mood: '', caregiverReport: undefined }),
      fallbackPatient,
      3,
    );
    expect(response.subjective).not.toContain('was not obtained');
    expect(response.subjective).not.toContain('presented as');
    // The old bug: `${mood.toLowerCase()}` with mood === '' produced
    // "presented as  during today's session" (double space, broken prose).
    expect(response.subjective).not.toMatch(/presented as\s+during/);
    // Same bug, second occurrence: the Assessment section also inserted
    // mood unconditionally ("presented as  and participated...").
    expect(response.assessment).not.toContain('presented as');
    expect(response.assessment).not.toMatch(/presented as\s+and/);
  });

  it('includes a real mood and a real caregiver report when both are provided', () => {
    const response = fallbackGeneration(
      baseRequest({ mood: 'Cooperative', caregiverReport: 'anxious this morning' }),
      fallbackPatient,
      3,
    );
    expect(response.subjective).toContain('presented as cooperative');
    expect(response.subjective).toContain('Caregiver reported: anxious this morning.');
    expect(response.assessment).toContain('presented as cooperative and participated');
  });
});

describe('validateAndEnhanceResponse — billing arithmetic consistency', () => {
  // Server-side regression guard for the class of bug PR #419 fixed on the
  // client (a time-block footer recomputed independently and diverged from
  // the real per-code total). The client bug is covered by
  // client/src/__tests__/timeBlocks.test.ts; this is the server-side
  // invariant those client totals are built from, so it can never silently
  // drift again on this side either.
  it('totalReimbursement equals both the summed cptCodes reimbursement and the summed timeBlocks rate', async () => {
    const aiResponse = {
      subjective: 's', objective: 'o', assessment: 'a', plan: 'p',
      cptCodes: [
        { code: '97530', name: 'Therapeutic Activities', units: 2, rationale: 'r', activitiesAssigned: ['Obstacle Course'] },
        { code: '97112', name: 'Neuromuscular Re-education', units: 1, rationale: 'r', activitiesAssigned: ['Swing'] },
      ],
      activityCptPairings: [
        { activity: 'Obstacle Course', code: '97530', rationale: 'r' },
        { activity: 'Swing', code: '97112', rationale: 'r' },
      ],
      billingRationale: 'br',
      auditNotes: [],
    };
    const result = await validateAndEnhanceResponse(
      aiResponse,
      baseRequest({ activities: ['Obstacle Course', 'Swing'] }),
      3,
    );
    const cptCodesSum = result.cptCodes.reduce((sum, c) => sum + c.reimbursement, 0);
    const timeBlocksSum = result.timeBlocks.reduce((sum, b) => sum + b.rate, 0);
    expect(result.totalReimbursement).toBeCloseTo(cptCodesSum, 2);
    expect(result.totalReimbursement).toBeCloseTo(timeBlocksSum, 2);
  });
});
