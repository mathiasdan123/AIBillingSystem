import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockStorage = vi.hoisted(() => ({ getPatient: vi.fn() }));
vi.mock('../storage', () => ({ storage: mockStorage }));

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock('../services/aiProvider', () => ({
  isAiConfigured: () => true,
  createAiClient: () => ({ messages: { create: mockCreate } }),
}));
vi.mock('../utils/phiAiGuard', () => ({ assertPhiAiAllowed: vi.fn() }));

import { weaveAnswersIntoNote } from '../services/soapAnswerWeaveService';

const INPUT = {
  patientId: 1,
  practiceId: 7,
  subjective: 'S text.',
  objective: 'O text.',
  assessment: 'A text.',
  plan: 'P text.',
  answers: [{ question: 'What cues did you provide?', answer: 'Moderate verbal cues during handwriting.' }],
};

function aiRespondsWith(payload: unknown) {
  mockCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getPatient.mockResolvedValue({ id: 1, practiceId: 7 });
});

describe('weaveAnswersIntoNote', () => {
  it('returns revised sections and change summaries', async () => {
    aiRespondsWith({
      subjective: 'S text.',
      objective: 'O text. Moderate verbal cues were provided during handwriting.',
      assessment: 'A text.',
      plan: 'P text.',
      changes: [{ section: 'objective', summary: 'Added cueing detail for handwriting.' }],
    });
    const r = await weaveAnswersIntoNote(INPUT);
    expect(r.objective).toContain('Moderate verbal cues');
    expect(r.changes).toEqual([{ section: 'objective', summary: 'Added cueing detail for handwriting.' }]);
  });

  it('rejects when no usable answers were provided', async () => {
    await expect(
      weaveAnswersIntoNote({ ...INPUT, answers: [{ question: 'q', answer: '   ' }] }),
    ).rejects.toThrow('No answers provided');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses cross-practice patients', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 1, practiceId: 99 });
    await expect(weaveAnswersIntoNote(INPUT)).rejects.toThrow('Patient not found');
  });

  it('treats a dropped section as a failed weave, not partial success', async () => {
    aiRespondsWith({ subjective: 'S', objective: '', assessment: 'A', plan: 'P', changes: [] });
    await expect(weaveAnswersIntoNote(INPUT)).rejects.toThrow(/failed to produce/);
  });
});
