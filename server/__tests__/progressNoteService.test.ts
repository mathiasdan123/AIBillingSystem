import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Progress note AI drafting — grounding and anti-fabrication. The draft is
 * grounded ONLY in signed notes in the window, the goal records, recorded
 * assist data, and therapist-entered inputs; it fails loudly rather than
 * fabricating, and NEVER produces a progress percentage.
 */

const mockStorage = vi.hoisted(() => ({
  getProgressNote: vi.fn(),
  getSignedSoapNotesInRange: vi.fn(),
}));
vi.mock('../storage', () => ({ storage: mockStorage }));
const mockCreate = vi.hoisted(() => vi.fn());
vi.mock('../services/aiProvider', () => ({
  isAiConfigured: () => true,
  createAiClient: () => ({ messages: { create: mockCreate } }),
}));
vi.mock('../utils/phiAiGuard', () => ({ assertPhiAiAllowed: vi.fn() }));
const mockActivity = vi.hoisted(() => vi.fn());
vi.mock('../services/activityProgressService', () => ({ getActivityProgress: mockActivity }));

import { generateProgressNoteDraft } from '../services/progressNoteService';

const goalEntries = [
  {
    goalId: 1, goalText: 'Improve fine motor control for pre-writing', goalTerm: 'short_term',
    durationWeeks: 12, startDate: '2026-07-01', endDate: '2026-09-23',
    progressPercent: 60, interventions: '', assistanceLevels: '', currentAbility: '',
  },
  {
    goalId: 2, goalText: 'Legacy goal without metadata', goalTerm: null,
    durationWeeks: null, startDate: null, endDate: null,
    progressPercent: null, interventions: '', assistanceLevels: '', currentAbility: '',
  },
];

const baseNote = {
  id: 5, practiceId: 7, patientId: 42, treatmentPlanId: 3, status: 'draft',
  windowStart: '2026-07-01', windowEnd: '2026-10-08', goalEntries,
};

function aiOk() {
  mockCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({
      goalCommentary: [
        { goalId: 1, interventions: 'Quadrupod grasp facilitation on writing tasks.', assistanceLevels: 'Minimal verbal cues; initial set-up.', currentAbility: 'Maintains grasp for 3-minute coloring task with set-up.' },
        { goalId: 2, interventions: 'Documented bilateral tasks.', assistanceLevels: 'Moderate assist as documented.', currentAbility: 'As documented in signed sessions.' },
      ],
      presentLevel: 'Patient benefits from minimal verbal cues to attend to the writing routine.',
      annualGoals: '1. Improve fine motor control for pre-writing.\n2. Legacy goal without metadata.',
      recommendations: 'Continue 45-minute individual sessions 2x weekly; assistance needs remain documented.',
    }) }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getProgressNote.mockResolvedValue(JSON.parse(JSON.stringify(baseNote)));
  mockStorage.getSignedSoapNotesInRange.mockResolvedValue([
    { sessionDate: '2026-09-05', objective: 'Worked quadrupod grasp with set-up', assessment: 'Needed minimal verbal cues', therapistSignedAt: '2026-09-05T18:00:00Z' },
    { sessionDate: '2026-09-12', objective: 'Sock donning practice', assessment: 'Moderate assist required', therapistSignedAt: '2026-09-12T18:00:00Z' },
  ]);
  mockActivity.mockResolvedValue([
    { activityName: 'Handwriting warm-up', points: [
      { date: '2026-09-05T00:00:00Z', score: 4, level: 'Minimal Assist' },
      { date: '2025-01-01T00:00:00Z', score: 2, level: 'Maximal Assist' }, // outside window
    ] },
  ]);
});

describe('generateProgressNoteDraft', () => {
  it('grounds the prompt in signed notes, goal records, in-window assist data, and therapist % only', async () => {
    aiOk();
    const r = await generateProgressNoteDraft({ noteId: 5, practiceId: 7 });
    expect(r.meta.sessionsReviewed).toBe(2);

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    // Signed sessions and goal records are in the prompt.
    expect(prompt).toContain('Worked quadrupod grasp with set-up');
    expect(prompt).toContain('Improve fine motor control for pre-writing');
    // Window scoping was delegated to the signed-notes range query.
    expect(mockStorage.getSignedSoapNotesInRange).toHaveBeenCalledWith(42, 7, '2026-07-01', '2026-10-08');
    // In-window assist data present; out-of-window point excluded.
    expect(prompt).toContain('Minimal Assist');
    expect(prompt).not.toContain('Maximal Assist');
    // Therapist-entered % appears verbatim; legacy nulls are "not recorded", never invented.
    expect(prompt).toContain('Therapist-entered progress: 60%');
    expect(prompt).toContain('not recorded');
    // The anti-fabrication charter forbids the model from producing percentages.
    expect(prompt).toContain("PROGRESS PERCENTAGES ARE THE THERAPIST'S CLINICAL JUDGMENT");
  });

  it('never outputs a progress percent — the draft carries commentary only', async () => {
    aiOk();
    const r = await generateProgressNoteDraft({ noteId: 5, practiceId: 7 });
    for (const c of r.draft.goalCommentary) {
      expect(Object.keys(c).sort()).toEqual(['assistanceLevels', 'currentAbility', 'goalId', 'interventions']);
    }
  });

  it('refuses when there are no signed notes in the window (no AI call)', async () => {
    mockStorage.getSignedSoapNotesInRange.mockResolvedValue([]);
    await expect(generateProgressNoteDraft({ noteId: 5, practiceId: 7 }))
      .rejects.toThrow('No signed session notes');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('fails loudly when the model skips a goal rather than shipping a gap', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        goalCommentary: [
          { goalId: 1, interventions: 'x', assistanceLevels: 'y', currentAbility: 'z' },
          // goal 2 missing
        ],
        presentLevel: 'p', annualGoals: 'a', recommendations: 'r',
      }) }],
    });
    await expect(generateProgressNoteDraft({ noteId: 5, practiceId: 7 }))
      .rejects.toThrow('failed to produce a result');
  });

  it('fails loudly on unparseable output instead of fabricating', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'I cannot produce JSON' }] });
    await expect(generateProgressNoteDraft({ noteId: 5, practiceId: 7 }))
      .rejects.toThrow('failed to produce a result');
  });

  it('refuses to regenerate a finalized note', async () => {
    mockStorage.getProgressNote.mockResolvedValue({ ...baseNote, status: 'finalized' });
    await expect(generateProgressNoteDraft({ noteId: 5, practiceId: 7 }))
      .rejects.toThrow('finalized');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('scopes by practice — cross-practice note ids are not found', async () => {
    mockStorage.getProgressNote.mockImplementation(async (id: number, practiceId: number) =>
      practiceId === 7 ? baseNote : undefined,
    );
    await expect(generateProgressNoteDraft({ noteId: 5, practiceId: 99 }))
      .rejects.toThrow('not found');
  });
});
