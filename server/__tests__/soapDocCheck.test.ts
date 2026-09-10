import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockStorage = vi.hoisted(() => ({
  getPatient: vi.fn(),
  getActiveTreatmentPlan: vi.fn(),
  getTreatmentGoals: vi.fn(),
}));
vi.mock('../storage', () => ({ storage: mockStorage }));

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock('../services/aiProvider', () => ({
  isAiConfigured: () => true,
  createAiClient: () => ({ messages: { create: mockCreate } }),
}));
vi.mock('../utils/phiAiGuard', () => ({ assertPhiAiAllowed: vi.fn() }));

import { runSoapDocCheck, DOC_CHECK_CATEGORIES } from '../services/soapDocCheckService';

const INPUT = {
  patientId: 1,
  practiceId: 7,
  subjective: 'Caregiver reports difficulty with morning routine.',
  objective: 'Swing with graded vestibular input; followed 2-step direction after.',
  assessment: 'Emerging regulation supporting direction-following.',
  plan: 'Continue current goals.',
};

function aiRespondsWith(payload: unknown) {
  mockCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getPatient.mockResolvedValue({ id: 1, practiceId: 7 });
  mockStorage.getActiveTreatmentPlan.mockResolvedValue({ id: 11 });
  mockStorage.getTreatmentGoals.mockResolvedValue([{ description: 'Follow 2-step directions', status: 'active' }]);
});

describe('runSoapDocCheck', () => {
  it('returns all six categories with statuses and questions', async () => {
    aiRespondsWith({
      checks: DOC_CHECK_CATEGORIES.map((c) => ({ item: c, status: 'pass', detail: 'ok' })),
      questions: [],
    });
    const r = await runSoapDocCheck(INPUT);
    expect(r.checks).toHaveLength(6);
    expect(r.checks.every((c) => c.status === 'pass')).toBe(true);
    expect(r.questions).toEqual([]);
  });

  it('treats categories the model omitted as warn, never silent pass', async () => {
    aiRespondsWith({
      checks: [{ item: DOC_CHECK_CATEGORIES[0], status: 'pass', detail: 'ok' }],
      questions: ['What type of cues did you provide?'],
    });
    const r = await runSoapDocCheck(INPUT);
    expect(r.checks[0]!.status).toBe('pass');
    expect(r.checks.slice(1).every((c) => c.status === 'warn')).toBe(true);
    expect(r.questions).toEqual(['What type of cues did you provide?']);
  });

  it('refuses cross-practice patients', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 1, practiceId: 99 });
    await expect(runSoapDocCheck(INPUT)).rejects.toThrow('Patient not found');
  });

  it('fails loudly on unparseable model output instead of passing the note', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'not json' }] });
    await expect(runSoapDocCheck(INPUT)).rejects.toThrow(/failed to produce/);
  });
});
