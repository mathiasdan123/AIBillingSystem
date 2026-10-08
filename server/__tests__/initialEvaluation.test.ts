import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockStorage = vi.hoisted(() => ({
  getInitialEvaluation: vi.fn(),
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
  buildEnteredDataBlock,
  GOAL_GRAMMAR,
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

const validProposal = {
  plan: {
    sessionsPerWeek: 2,
    durationWeeks: 24,
    startDate: '2026-10-08',
    endDate: '2027-03-25',
    rationale: 'Documented dressing and fine-motor deficits support twice-weekly skilled OT.',
  },
  goals: [
    {
      skillArea: 'fine motor control',
      goalText:
        'Patient will improve fine motor control as evidenced by maintaining a tripod grasp during a 3-minute coloring activity with minimal verbal cues in 3/4 trials to improve independence with pre-writing skills.',
      term: 'short_term',
      durationWeeks: 12,
      startDate: '2026-10-08',
      endDate: '2026-12-31',
      rationale: 'Grounded in observed emerging tripod grasp and parent handwriting concerns.',
    },
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

  it('parses and normalizes a valid proposal with status "proposed"', async () => {
    aiReturns(validProposal);
    const { plan, goals } = await proposePlanAndGoals({ evaluationId: 10, practiceId: 7 });
    expect(plan.status).toBe('proposed');
    expect(plan.sessionsPerWeek).toBe(2);
    expect(goals).toHaveLength(1);
    expect(goals[0].status).toBe('proposed');
    expect(goals[0].term).toBe('short_term');
  });

  it('rejects a proposal whose goal has an invalid term', async () => {
    aiReturns({
      ...validProposal,
      goals: [{ ...validProposal.goals[0], term: 'medium_term' }],
    });
    await expect(proposePlanAndGoals({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'Goal proposal failed validation',
    );
  });

  it('rejects a proposal with no goals', async () => {
    aiReturns({ ...validProposal, goals: [] });
    await expect(proposePlanAndGoals({ evaluationId: 10, practiceId: 7 })).rejects.toThrow(
      'failed to produce goals',
    );
  });

  it('fails closed on cross-practice access', async () => {
    await expect(proposePlanAndGoals({ evaluationId: 10, practiceId: 99 })).rejects.toThrow(
      'Evaluation not found',
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('proposal validation (accept-with-edits path reuses these)', () => {
  it('parsePlanProposal rejects out-of-range sessionsPerWeek', () => {
    expect(() => parsePlanProposal({ ...validProposal.plan, sessionsPerWeek: 0 })).toThrow('validation');
    expect(() => parsePlanProposal({ ...validProposal.plan, sessionsPerWeek: 12 })).toThrow('validation');
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
    expect(() => parseGoalProposal({ ...validProposal.goals[0], goalText: '  ' })).toThrow('validation');
    expect(() => parseGoalProposal({ ...validProposal.goals[0], rationale: undefined })).toThrow('validation');
  });

  it('parseGoalProposal normalizes a numeric-string duration', () => {
    const goal = parseGoalProposal({ ...validProposal.goals[0], durationWeeks: '12' });
    expect(goal.durationWeeks).toBe(12);
  });
});
