import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockStorage = vi.hoisted(() => ({
  getPatient: vi.fn(),
  getRecentSoapNotesForPatient: vi.fn(),
}));
vi.mock('../storage', () => ({ storage: mockStorage }));
const mockCreate = vi.hoisted(() => vi.fn());
vi.mock('../services/aiProvider', () => ({ isAiConfigured: () => true, createAiClient: () => ({ messages: { create: mockCreate } }) }));
vi.mock('../utils/phiAiGuard', () => ({ assertPhiAiAllowed: vi.fn() }));
vi.mock('../services/patientProgressService', () => ({
  getPatientProgress: vi.fn().mockResolvedValue({
    goals: [{ description: 'Bilateral coordination', points: [{ value: 40 }, { value: 70 }] }],
    outcomeMeasures: [], activities: [],
  }),
}));

import { generateProgressReport } from '../services/progressReportService';

function aiOk() {
  mockCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({
    subjective: 'Caregiver reported steady engagement.', objective: 'Worked on bilateral tasks; assist decreasing.',
    assessment: 'Progress toward bilateral coordination goal, 40% to 70%.', plan: 'Continue current plan.',
  }) }] });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getPatient.mockResolvedValue({ id: 1, practiceId: 7 });
  mockStorage.getRecentSoapNotesForPatient.mockResolvedValue([
    { objective: 'obj1', assessment: 'assess1', therapistSignedAt: '2026-09-05T10:00:00Z' },
    { objective: 'obj2', assessment: 'assess2', therapistSignedAt: '2026-09-12T10:00:00Z' },
    { objective: 'old', assessment: 'old', therapistSignedAt: '2026-07-01T10:00:00Z' },
  ]);
});

describe('generateProgressReport', () => {
  it('summarizes only sessions in the date range', async () => {
    aiOk();
    const r = await generateProgressReport({ patientId: 1, practiceId: 7, from: '2026-09-01', to: '2026-09-14' });
    expect(r.meta.sessionsReviewed).toBe(2); // July note excluded
    expect(r.report.assessment).toContain('40% to 70%');
    // the prompt embedded only the in-range sessions
    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).not.toContain('old');
  });

  it('refuses when there are no signed notes in range', async () => {
    mockStorage.getRecentSoapNotesForPatient.mockResolvedValue([
      { objective: 'x', assessment: 'y', therapistSignedAt: '2026-01-01T10:00:00Z' },
    ]);
    await expect(generateProgressReport({ patientId: 1, practiceId: 7, from: '2026-09-01', to: '2026-09-14' }))
      .rejects.toThrow('No signed notes');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses cross-practice patients', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 1, practiceId: 99 });
    await expect(generateProgressReport({ patientId: 1, practiceId: 7, from: '2026-09-01', to: '2026-09-14' }))
      .rejects.toThrow('Patient not found');
  });
});
