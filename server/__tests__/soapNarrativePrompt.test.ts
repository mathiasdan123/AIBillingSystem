import { describe, expect, it, vi } from 'vitest';

// The service module imports the storage layer (which demands DATABASE_URL at
// import time); the prompt builder under test never touches it.
vi.mock('../storage', () => ({ storage: {} }));

import { buildSystemPrompt, buildUserPrompt, fallbackGeneration, validateAndEnhanceResponse } from '../services/aiSoapBillingService';

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

describe('buildUserPrompt — per-activity structured ratings', () => {
  it('lists the ratings entered for an activity beside its account, and the derived global level', () => {
    const prompt = buildUserPrompt(
      baseRequest({
        activities: ['Trampoline - Strengthening'],
        activityDetails: [
          { name: 'Trampoline - Strengthening', response: 'five sets of ten jumps', assistance: 'Minimal Assist', strength: 'Fair' },
        ],
        assessment: { performance: '', assistance: 'Minimal Assist', strength: '', motorPlanning: '', sensoryRegulation: '' },
      }),
      patient, 3, null,
    );
    expect(prompt).toContain('RATINGS ENTERED FOR THIS ACTIVITY');
    expect(prompt).toContain('Assistance: Minimal Assist; Strength/endurance: Fair');
    expect(prompt).toContain('- Assistance Level Required: Minimal Assist');
    expect(prompt).not.toContain('Assistance Level Required: (not assessed)');
  });

  it('omits the ratings line when nothing was rated on the activity', () => {
    const prompt = buildUserPrompt(
      baseRequest({ activityDetails: [{ name: 'Swing', response: 'Calm throughout.' }] }),
      patient, 3, null,
    );
    expect(prompt).not.toContain('RATINGS ENTERED FOR THIS ACTIVITY');
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
    expect(response.assessment).toContain('presented as cooperative.');
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

/**
 * QA sweep 2026-11-18 (Riley Nodob, normal AI path): the note retained the
 * activity account but asserted findings never supplied -- "no observable
 * distress", "standardized measurements were not administered", therapist
 * grading/monitoring. The grounding rule applies in both directions: an
 * unsupported negative, and an unentered service, are fabrications exactly
 * as an unsupported positive is. Pinned at the prompt (which used to
 * INSTRUCT the measurement sentence) and at the deterministic backstop on
 * the final output.
 */
describe('grounding in both directions — prompt rules', () => {
  const system = buildSystemPrompt(null);
  const user = buildUserPrompt(baseRequest(), patient, 3, null);

  it('no longer instructs or permits the standardized-measurement denial sentence', () => {
    expect(system).not.toContain("otherwise write 'Standardized measurements were not administered");
    expect(system).not.toMatch(/is\s+fine because an administered measure/);
    expect(user).not.toContain("otherwise write 'Standardized measurements were not administered");
    expect(user).toContain('write NOTHING about standardized measures');
  });

  it('names unsupported negative findings and unentered therapist actions as fabrication', () => {
    expect(system).toContain('NEGATIVE findings the input never stated');
    expect(system).toContain('an unsupported\n     negative is fabrication, same as an unsupported positive');
    expect(system).toContain('Services and therapist actions the input never described');
    expect(user).toContain("Do NOT add negative findings the account did not state ('no observable distress'");
  });
});

describe('grounding in both directions — validateAndEnhanceResponse on the Riley Nodob repro', () => {
  const riley = baseRequest({
    activities: ['Trampoline - Strengthening'],
    activityDetails: [{ name: 'Trampoline - Strengthening', response: 'five sets of ten jumps, one-minute pauses, no pain' }],
    mood: '',
    assessment: { performance: '', assistance: '', strength: '', motorPlanning: '', sensoryRegulation: '' },
    planNextSteps: '',
    nextSessionFocus: 'reassess jumping endurance',
  });
  // What the model actually produced for this input, condensed: the account
  // is kept, and three claims are added that nothing entered supports.
  const aiResponse = {
    subjective: '',
    objective:
      'Session conducted in Clinic for 45 minutes. Standardized measurements were not administered; observations were qualitative.\n\n' +
      'Trampoline - Strengthening: Riley completed five sets of ten jumps with one-minute pauses between sets and reported no pain. ' +
      'No observable distress was noted. The therapist graded bout duration and monitored for fatigue throughout.',
    assessment:
      'Trampoline jumping targets lower-extremity strength and endurance to support sustained play participation. ' +
      'Riley tolerated the activity without signs of fatigue.',
    plan: 'Next session focus: reassess jumping endurance.\n\nHome program: No home program assigned this session.',
    cptCodes: [{ code: '97110', name: 'Therapeutic Exercise', units: 3, rationale: 'Strengthening/endurance objective.', activitiesAssigned: ['Trampoline - Strengthening'] }],
    activityCptPairings: [{ activity: 'Trampoline - Strengthening', code: '97110', rationale: 'Strengthening/endurance objective.' }],
    billingRationale: 'Standardized measures were not used; coding reflects the documented strengthening objective.',
    auditNotes: ['Documentation supports 97110.'],
  };

  it('keeps the therapist\'s account, including the negative they DID write ("no pain")', async () => {
    const out = await validateAndEnhanceResponse(aiResponse, riley, 3);
    expect(out.objective).toContain('completed five sets of ten jumps with one-minute pauses between sets and reported no pain');
    expect(out.plan).toContain('reassess jumping endurance');
  });

  it('drops the three unsupported claims from the QA sweep, in every section and the billing text', async () => {
    const out = await validateAndEnhanceResponse(aiResponse, riley, 3);
    const everything = [out.subjective, out.objective, out.assessment, out.plan, out.billingRationale, ...out.auditNotes,
      ...out.cptCodes.map((c) => c.rationale), ...out.activityCptPairings.map((p) => p.rationale)].join('\n');
    expect(everything).not.toMatch(/standardi[sz]ed/i);
    expect(everything).not.toMatch(/distress/i);
    expect(everything).not.toMatch(/graded|monitored/i);
    expect(everything).not.toMatch(/without signs of fatigue/i);
    // What the activity TARGETS is grounded in the activity itself and survives.
    expect(out.assessment).toBe('Trampoline jumping targets lower-extremity strength and endurance to support sustained play participation.');
    expect(out.objective).toBe(
      'Session conducted in Clinic for 45 minutes.\n\n' +
      'Trampoline - Strengthening: Riley completed five sets of ten jumps with one-minute pauses between sets and reported no pain.',
    );
  });

  it('is symmetric: the same sentences survive when the input supports them', async () => {
    const supported = baseRequest({
      ...riley,
      activityDetails: [{ name: 'Trampoline - Strengthening', response: 'five sets of ten jumps, no pain, no distress or fatigue; graded bouts down when rhythm broke' }],
      assessment: { ...riley.assessment, assistance: 'Supervision' },
    });
    const out = await validateAndEnhanceResponse(aiResponse, supported, 3);
    expect(out.objective).toContain('No observable distress was noted.');
    expect(out.objective).toContain('The therapist graded bout duration and monitored for fatigue throughout.');
    expect(out.assessment).toContain('Riley tolerated the activity without signs of fatigue.');
    // Still no field can support a statement about standardized measures.
    expect(out.objective).not.toMatch(/standardi[sz]ed/i);
  });
});
