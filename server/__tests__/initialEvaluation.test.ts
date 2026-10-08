import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockStorage = vi.hoisted(() => ({
  getInitialEvaluation: vi.fn(),
  getPatient: vi.fn(),
}));
vi.mock('../storage', () => ({ storage: mockStorage }));
const mockCreate = vi.hoisted(() => vi.fn());
vi.mock('../services/aiProvider', () => ({
  isAiConfigured: () => true,
  createAiClient: () => ({ messages: { create: mockCreate } }),
}));
vi.mock('../utils/phiAiGuard', () => ({ assertPhiAiAllowed: vi.fn() }));

import {
  composeEvaluationWriteUp,
  proposePlanAndGoals,
  parsePlanProposal,
  parseGoalProposal,
  parseGoalPairs,
  parseInterviewOutline,
  parseEvalCodeSuggestion,
  buildEnteredDataBlock,
  buildEvalCodeDataBlock,
  draftInterviewOutline,
  suggestEvaluationCode,
  GOAL_GRAMMAR,
  SESSION_LENGTH_MINUTES,
  DEFAULT_PLAN_DURATION_WEEKS,
} from '../services/initialEvaluationService';

const baseEvaluation = {
  id: 10,
  practiceId: 7,
  patientId: 1,
  status: 'draft',
  evaluationDate: '2026-10-01',
  personalInfo: { childName: 'Avery T.', primaryDiagnosis: 'Developmental coordination disorder' },
  healthHistory: { developmentalMilestones: 'Walked at 18 months; delayed pencil grasp' },
  caregiverConcerns: {
    primaryConcerns: 'Struggles with dressing and handwriting',
    otGoalsForChild: 'Independence with dressing',
  },
  subjectiveComments: 'Parent reports frustration with morning routines.',
  objectiveActivities: 'Attempted sock donning with moderate assist; tripod grasp emerging.',
  assessmentResults: 'PDMS-2 administered; fine motor subtest below average per therapist notes.',
  skillAreas: 'Fine motor, self-care',
  aiWriteUp: null,
  proposedPlan: null,
  proposedGoals: null,
};

const validWriteUp = {
  patientHistory: 'History per entered data.',
  reasonForEvaluation: 'Referred for coordination concerns.',
  observations: 'Moderate assist for sock donning observed.',
  assessmentResults: 'As entered by the therapist.',
  proposedPlanOfCare: 'Skilled OT recommended.',
  goals: 'Address dressing independence and fine motor control.',
};

const longTermGoal = {
  goalText:
    'Patient will improve fine motor control as evidenced by maintaining a tripod grasp during a 3-minute coloring activity with minimal verbal cues in 3/4 trials to improve independence with pre-writing skills.',
  durationWeeks: 26,
  startDate: '2026-10-08',
  endDate: '2027-04-08',
  rationale: 'Grounded in observed emerging tripod grasp and parent handwriting concerns.',
};

const shortTermGoal = {
  goalText:
    'Patient will improve fine motor control as evidenced by maintaining a tripod grasp during a 1-minute coloring activity with moderate verbal and tactile cues in 2/4 trials to improve independence with pre-writing skills.',
  durationWeeks: 12,
  startDate: '2026-10-08',
  endDate: '2026-12-31',
  rationale: 'Steps the long-term goal down: shorter engaged time, more support, fewer trials.',
};

const validPair = {
  skillArea: 'fine motor control',
  longTerm: longTermGoal,
  shortTerm: shortTermGoal,
};

const validProposal = {
  plan: {
    sessionsPerWeek: 2,
    sessionLengthMinutes: 45,
    durationWeeks: 26,
    startDate: '2026-10-08',
    endDate: '2027-04-08',
    rationale: 'Documented dressing and fine-motor deficits support twice-weekly skilled OT.',
  },
  goalPairs: [validPair],
};

const validOutline = {
  sections: [
    { key: 'patientHistory', title: 'Patient history', questions: ['How did feeding go in the first year?'] },
    { key: 'referralInformation', title: 'Referral information', questions: ['What prompted the referral from Dr. Lee?'] },
    { key: 'parentConcerns', title: 'Parent concerns', questions: ['Which daily routines feel hardest right now?'] },
  ],
};

function aiReturns(payload: unknown) {
  mockCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Practice-scoped read: only (10, 7) resolves — any other practiceId
  // behaves like the real storage layer and returns undefined.
  mockStorage.getInitialEvaluation.mockImplementation(async (id: number, practiceId: number) =>
    id === 10 && practiceId === 7 ? { ...baseEvaluation } : undefined,
  );
  mockStorage.getPatient.mockResolvedValue({
    id: 1,
    practiceId: 7,
    firstName: 'Avery',
    lastName: 'T.',
    intakeData: {
      birthHistory: 'Born at 36 weeks, NICU stay of 4 days',
      medicalHistory: 'Frequent ear infections as a toddler',
      schoolConcerns: 'Teacher reports difficulty with scissors',
      insuranceGroupNumber: 'GRP-9981',
    },
  });
});

describe('composeEvaluationWriteUp', () => {
  it('grounds the prompt in the entered data only and parses the write-up', async () => {
    aiReturns(validWriteUp);
    const { writeUp } = await composeEvaluationWriteUp({ evaluationId: 10, practiceId: 7 });
    expect(writeUp.observations).toBe(validWriteUp.observations);

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    // Entered data is embedded
    expect(prompt).toContain('Struggles with dressing and handwriting');
    expect(prompt).toContain('Attempted sock donning with moderate assist');
    expect(prompt).toContain('Walked at 18 months');
    // Anti-fabrication charter
    expect(prompt).toContain('Use ONLY the entered data');
    expect(prompt).toContain('Never invent observations');
    expect(mockCreate.mock.calls[0][0].model).toBe('claude-sonnet-4-5');
  });

  it('omits blank fields from the prompt instead of inviting completion', () => {
    const block = buildEnteredDataBlock({
      ...baseEvaluation,
      healthHistory: { medications: '', allergies: 'None reported' },
    } as any);
    expect(block).toContain('Allergies: None reported');
    expect(block).not.toContain('Current medications');
  });

  it('refuses to compose when nothing has been entered', async () => {
    mockStorage.getInitialEvaluation.mockResolvedValue({
      ...baseEvaluation,
      personalInfo: {},
      healthHistory: {},
      caregiverConcerns: {},
      subjectiveComments: null,
      objectiveActivities: null,
      assessmentResults: null,
      skillAreas: null,
    });
    await expect(composeEvaluationWriteUp({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'Not enough entered information',
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('fails closed on cross-practice access', async () => {
    await expect(composeEvaluationWriteUp({ evaluationId: 10, practiceId: 99 })).rejects.toThrow(
      'Evaluation not found',
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a finalized evaluation', async () => {
    mockStorage.getInitialEvaluation.mockResolvedValue({ ...baseEvaluation, status: 'finalized' });
    await expect(composeEvaluationWriteUp({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'finalized',
    );
  });

  it('fails loudly on unparseable AI output rather than fabricating', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'sorry, no JSON here' }] });
    await expect(composeEvaluationWriteUp({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'failed to produce a result',
    );
  });

  it('rejects a write-up with an empty section', async () => {
    aiReturns({ ...validWriteUp, observations: '' });
    await expect(composeEvaluationWriteUp({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'failed to produce a result',
    );
  });
});

describe('proposePlanAndGoals', () => {
  it('embeds the exact goal grammar, style anchors, and 1:1-only rule in the prompt', async () => {
    aiReturns(validProposal);
    await proposePlanAndGoals({ evaluationId: 10, practiceId: 7 });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain(GOAL_GRAMMAR);
    expect(prompt).toContain('Patient will don ankle socks');
    expect(prompt).toContain('structured vestibular or proprioceptive activity');
    expect(prompt).toContain('tripod or quadrupod grasp');
    expect(prompt).toContain('individual (1:1)');
    expect(prompt).toContain('does not run group sessions');
    // Grounding hierarchy: concerns/observations/milestones; scores only supporting
    expect(prompt).toContain('assessment scores ONLY as supporting rationale');
  });

  it('bakes the Wonder Kids plan constraints into the prompt (45 min, 1x/2x, 6-month default)', async () => {
    aiReturns(validProposal);
    await proposePlanAndGoals({ evaluationId: 10, practiceId: 7 });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('exactly 45 minutes');
    expect(prompt).toContain('Never propose any other session length');
    expect(prompt).toContain('1 or 2 sessions per week');
    expect(prompt).toContain('26 weeks (6 months)');
  });

  it('asks for 5-6 goal PAIRS that step the same underlying skill down', async () => {
    aiReturns(validProposal);
    await proposePlanAndGoals({ evaluationId: 10, practiceId: 7 });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('Propose goals as PAIRS');
    expect(prompt).toContain('increased support (more assistance or cues), fewer trials, or shorter engaged time');
    expect(prompt).toContain('Propose 5-6 pairs');
  });

  it('parses a valid pair proposal into linked long-term/short-term goals with status "proposed"', async () => {
    aiReturns(validProposal);
    const { plan, goals } = await proposePlanAndGoals({ evaluationId: 10, practiceId: 7 });
    expect(plan.status).toBe('proposed');
    expect(plan.sessionsPerWeek).toBe(2);
    expect(plan.sessionLengthMinutes).toBe(SESSION_LENGTH_MINUTES);
    expect(goals).toHaveLength(2);
    expect(goals[0]).toMatchObject({ term: 'long_term', skillArea: 'fine motor control', pairIndex: 0, status: 'proposed' });
    expect(goals[1]).toMatchObject({ term: 'short_term', skillArea: 'fine motor control', pairIndex: 0, status: 'proposed' });
  });

  it('normalizes the AI plan to the 6-month default with a recomputed end date', async () => {
    aiReturns({
      ...validProposal,
      plan: { ...validProposal.plan, durationWeeks: 12, endDate: '2026-12-31' },
    });
    const { plan } = await proposePlanAndGoals({ evaluationId: 10, practiceId: 7 });
    expect(plan.durationWeeks).toBe(DEFAULT_PLAN_DURATION_WEEKS);
    expect(plan.endDate).toBe('2027-04-08'); // 2026-10-08 + 26 weeks
  });

  it('rejects an AI plan outside the 1x/2x weekly frequency', async () => {
    aiReturns({ ...validProposal, plan: { ...validProposal.plan, sessionsPerWeek: 3 } });
    await expect(proposePlanAndGoals({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'frequency must be 1x or 2x weekly',
    );
  });

  it('rejects an AI plan that invents a non-45-minute session length', async () => {
    aiReturns({ ...validProposal, plan: { ...validProposal.plan, sessionLengthMinutes: 60 } });
    await expect(proposePlanAndGoals({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'sessions are always 45 minutes',
    );
  });

  it('rejects a pair whose halves carry the wrong term', async () => {
    aiReturns({
      ...validProposal,
      goalPairs: [{ ...validPair, shortTerm: { ...shortTermGoal, term: 'long_term' } }],
    });
    await expect(proposePlanAndGoals({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'Goal proposal failed validation',
    );
  });

  it('rejects a pair missing its short-term half', async () => {
    aiReturns({
      ...validProposal,
      goalPairs: [{ skillArea: validPair.skillArea, longTerm: longTermGoal }],
    });
    await expect(proposePlanAndGoals({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'each pair needs a skill area, a long-term goal, and a short-term goal',
    );
  });

  it('rejects a proposal with no goal pairs', async () => {
    aiReturns({ ...validProposal, goalPairs: [] });
    await expect(proposePlanAndGoals({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'failed to produce goals',
    );
  });

  it('caps runaway proposals at 6 pairs (12 goals)', async () => {
    aiReturns({
      ...validProposal,
      goalPairs: Array.from({ length: 9 }, () => ({ ...validPair })),
    });
    const { goals } = await proposePlanAndGoals({ evaluationId: 10, practiceId: 7 });
    expect(goals).toHaveLength(12);
    expect(goals[11].pairIndex).toBe(5);
  });

  it('fails closed on cross-practice access', async () => {
    await expect(proposePlanAndGoals({ evaluationId: 10, practiceId: 99 })).rejects.toThrow(
      'Evaluation not found',
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

const validFlatGoal = { skillArea: 'fine motor control', term: 'short_term', ...shortTermGoal };

describe('proposal validation (accept-with-edits path reuses these)', () => {
  it('parsePlanProposal rejects out-of-range sessionsPerWeek', () => {
    expect(() => parsePlanProposal({ ...validProposal.plan, sessionsPerWeek: 0 })).toThrow('validation');
    expect(() => parsePlanProposal({ ...validProposal.plan, sessionsPerWeek: 12 })).toThrow('validation');
  });

  it('parsePlanProposal rejects frequencies Wonder Kids never runs (therapist edits included)', () => {
    expect(() => parsePlanProposal({ ...validProposal.plan, sessionsPerWeek: 3 })).toThrow(
      'frequency must be 1x or 2x weekly',
    );
    expect(parsePlanProposal({ ...validProposal.plan, sessionsPerWeek: 1 }).sessionsPerWeek).toBe(1);
  });

  it('parsePlanProposal pins the session length to 45 minutes', () => {
    // Missing length normalizes to 45 (stored pre-refinement proposals).
    const { sessionLengthMinutes, ...withoutLength } = validProposal.plan;
    expect(parsePlanProposal(withoutLength).sessionLengthMinutes).toBe(SESSION_LENGTH_MINUTES);
    // Any other value is refused — the system never invents session lengths.
    expect(() => parsePlanProposal({ ...validProposal.plan, sessionLengthMinutes: 30 })).toThrow(
      'sessions are always 45 minutes',
    );
  });

  it('parsePlanProposal rejects an end date on or before the start date', () => {
    expect(() =>
      parsePlanProposal({ ...validProposal.plan, startDate: '2026-10-08', endDate: '2026-10-08' }),
    ).toThrow('validation');
  });

  it('parsePlanProposal rejects malformed dates', () => {
    expect(() => parsePlanProposal({ ...validProposal.plan, startDate: 'next Tuesday' })).toThrow('validation');
  });

  it('parseGoalProposal requires every field non-empty', () => {
    expect(() => parseGoalProposal({ ...validFlatGoal, goalText: '  ' })).toThrow('validation');
    expect(() => parseGoalProposal({ ...validFlatGoal, rationale: undefined })).toThrow('validation');
  });

  it('parseGoalProposal enforces the term enum', () => {
    expect(() => parseGoalProposal({ ...validFlatGoal, term: 'medium_term' })).toThrow('validation');
  });

  it('parseGoalProposal normalizes a numeric-string duration', () => {
    const goal = parseGoalProposal({ ...validFlatGoal, durationWeeks: '12' });
    expect(goal.durationWeeks).toBe(12);
  });

  it('parseGoalPairs links both halves of a pair by pairIndex and shared skill area', () => {
    const goals = parseGoalPairs([validPair, { ...validPair, skillArea: 'sensory regulation' }]);
    expect(goals).toHaveLength(4);
    expect(goals[2]).toMatchObject({ pairIndex: 1, term: 'long_term', skillArea: 'sensory regulation' });
    expect(goals[3]).toMatchObject({ pairIndex: 1, term: 'short_term', skillArea: 'sensory regulation' });
  });

  it('parseGoalPairs refuses a non-array or empty payload', () => {
    expect(() => parseGoalPairs(undefined)).toThrow('expected pairs of goals');
    expect(() => parseGoalPairs([])).toThrow('expected pairs of goals');
  });

  it('parseGoalPairs refuses a pair without a skill area', () => {
    expect(() => parseGoalPairs([{ ...validPair, skillArea: ' ' }])).toThrow('validation');
  });
});

describe('draftInterviewOutline', () => {
  it('grounds the questions in the patient intake data with the anti-fabrication charter', async () => {
    aiReturns(validOutline);
    const { outline } = await draftInterviewOutline({ evaluationId: 10, practiceId: 7 });
    expect(outline.sections).toHaveLength(3);
    expect(outline.sections.map((s) => s.key)).toEqual([
      'patientHistory',
      'referralInformation',
      'parentConcerns',
    ]);
    expect(outline.generatedAt).toBeTruthy();

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    // Intake content is embedded...
    expect(prompt).toContain('Born at 36 weeks');
    expect(prompt).toContain('Teacher reports difficulty with scissors');
    // ...but financial/consent intake fields never reach the AI.
    expect(prompt).not.toContain('GRP-9981');
    // Anti-fabrication charter
    expect(prompt).toContain('Never invent history');
    expect(prompt).toContain('never presuppose a fact that is not in the intake data');
    expect(mockCreate.mock.calls[0][0].model).toBe('claude-sonnet-4-5');
  });

  it('normalizes string questions into editable {question, notes} entries', () => {
    const outline = parseInterviewOutline(validOutline);
    expect(outline.sections[0].questions[0]).toEqual({
      question: 'How did feeding go in the first year?',
      notes: '',
    });
  });

  it('rejects an outline missing one of the three fixed sections', () => {
    expect(() =>
      parseInterviewOutline({ sections: validOutline.sections.slice(0, 2) }),
    ).toThrow('Interview outline failed validation');
  });

  it('rejects an outline with an empty question list', () => {
    expect(() =>
      parseInterviewOutline({
        sections: [
          validOutline.sections[0],
          { ...validOutline.sections[1], questions: [] },
          validOutline.sections[2],
        ],
      }),
    ).toThrow('Interview outline failed validation');
  });

  it('fails closed when the patient belongs to another practice', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 1, practiceId: 99, intakeData: {} });
    await expect(draftInterviewOutline({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'Evaluation not found',
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a finalized evaluation', async () => {
    mockStorage.getInitialEvaluation.mockResolvedValue({ ...baseEvaluation, status: 'finalized' });
    await expect(draftInterviewOutline({ evaluationId: 10, practiceId: 7 })).rejects.toThrow('finalized');
  });

  it('refuses when there is no intake or personal information to draw from', async () => {
    mockStorage.getInitialEvaluation.mockResolvedValue({ ...baseEvaluation, personalInfo: {} });
    mockStorage.getPatient.mockResolvedValue({ id: 1, practiceId: 7, intakeData: {} });
    await expect(draftInterviewOutline({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'Not enough intake information',
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('interview notes ground the composed write-up', () => {
  const outlineWithNotes = {
    sections: [
      {
        key: 'patientHistory',
        title: 'Patient history',
        questions: [
          { question: 'How did feeding go in the first year?', notes: 'Bottle refusal until 8 months.' },
          { question: 'Any hospitalizations?', notes: '' },
        ],
      },
      { key: 'referralInformation', title: 'Referral information', questions: [{ question: 'Who referred you?', notes: '' }] },
      { key: 'parentConcerns', title: 'Parent concerns', questions: [{ question: 'Hardest routines?', notes: 'Mornings — dressing battles.' }] },
    ],
  };

  it('includes answered outline questions in the entered-data block, omitting unanswered ones', () => {
    const block = buildEnteredDataBlock({ ...baseEvaluation, interviewOutline: outlineWithNotes } as any);
    expect(block).toContain('PARENT INTERVIEW OUTLINE — CAREGIVER RESPONSES');
    expect(block).toContain('Bottle refusal until 8 months.');
    expect(block).toContain('Mornings — dressing battles.');
    expect(block).not.toContain('Any hospitalizations?');
  });

  it('compose prompt carries the captured caregiver responses as subjective grounding', async () => {
    mockStorage.getInitialEvaluation.mockResolvedValue({ ...baseEvaluation, interviewOutline: outlineWithNotes });
    aiReturns(validWriteUp);
    await composeEvaluationWriteUp({ evaluationId: 10, practiceId: 7 });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('Bottle refusal until 8 months.');
    expect(prompt).toContain('ground the subjective narrative');
  });
});

describe('suggestEvaluationCode', () => {
  const validSuggestion = {
    code: '97166',
    rationale: 'The documented caregiver concerns and observed dressing/fine-motor deficits reflect a moderate-complexity evaluation.',
  };

  it('suggests one of the three OT evaluation codes from the restricted data only', async () => {
    aiReturns(validSuggestion);
    const { suggestion } = await suggestEvaluationCode({ evaluationId: 10, practiceId: 7 });
    expect(suggestion.code).toBe('97166');
    expect(suggestion.suggestedAt).toBeTruthy();

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    // Grounded ONLY in diagnosis/referral, caregiver concerns, observations...
    expect(prompt).toContain('Developmental coordination disorder');
    expect(prompt).toContain('Struggles with dressing and handwriting');
    expect(prompt).toContain('Attempted sock donning with moderate assist');
    // ...never health history or raw assessment text.
    expect(prompt).not.toContain('Walked at 18 months');
    expect(prompt).not.toContain('PDMS-2 administered');
    // Accuracy framing: therapist decides; thin documentation codes lower.
    expect(prompt).toContain('BILLING ACCURACY');
    expect(prompt).toContain('treating therapist reviews it and makes the final coding decision');
    expect(prompt).toContain('suggest the LOWER code');
  });

  it('rejects a code outside 97165/97166/97167', async () => {
    aiReturns({ ...validSuggestion, code: '97168' });
    await expect(suggestEvaluationCode({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'Evaluation code suggestion failed validation',
    );
  });

  it('parseEvalCodeSuggestion requires a rationale', () => {
    expect(() => parseEvalCodeSuggestion({ code: '97165', rationale: '  ' })).toThrow('validation');
    expect(parseEvalCodeSuggestion(validSuggestion).code).toBe('97166');
  });

  it('refuses a finalized evaluation', async () => {
    mockStorage.getInitialEvaluation.mockResolvedValue({ ...baseEvaluation, status: 'finalized' });
    await expect(suggestEvaluationCode({ evaluationId: 10, practiceId: 7 })).rejects.toThrow('finalized');
  });

  it('refuses when none of the restricted inputs have been entered', async () => {
    mockStorage.getInitialEvaluation.mockResolvedValue({
      ...baseEvaluation,
      personalInfo: {},
      caregiverConcerns: {},
      objectiveActivities: null,
      skillAreas: null,
    });
    await expect(suggestEvaluationCode({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'Not enough entered information to suggest an evaluation code',
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('buildEvalCodeDataBlock stays restricted to diagnosis, caregiver report, and observations', () => {
    const block = buildEvalCodeDataBlock(baseEvaluation as any);
    expect(block).toContain('DIAGNOSIS / REASON FOR REFERRAL');
    expect(block).toContain('CAREGIVER REPORT');
    expect(block).toContain('DOCUMENTED CLINICAL OBSERVATIONS');
    expect(block).not.toContain('Walked at 18 months'); // health history excluded
    expect(block).not.toContain('PDMS-2'); // assessment text excluded
  });
});
