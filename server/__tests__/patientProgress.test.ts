import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockStorage = vi.hoisted(() => ({
  getPatientTreatmentPlans: vi.fn(),
  getTreatmentGoals: vi.fn(),
  getSoapNoteGoalProgressByGoalWithDetails: vi.fn(),
  getPatientAssessments: vi.fn(),
  getOutcomeMeasureTemplate: vi.fn(),
}));
vi.mock('../storage', () => ({ storage: mockStorage }));

import { getPatientProgress } from '../services/patientProgressService';

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getPatientTreatmentPlans.mockResolvedValue([{ id: 10 }]);
  mockStorage.getTreatmentGoals.mockResolvedValue([{ id: 100, description: 'Bilateral coordination', status: 'active' }]);
  mockStorage.getSoapNoteGoalProgressByGoalWithDetails.mockResolvedValue([
    { progress: { progressPercentage: 40, createdAt: '2026-08-01' }, soapNote: { therapistSignedAt: '2026-08-01T10:00:00Z' } },
    { progress: { progressPercentage: 70, createdAt: '2026-09-01' }, soapNote: { therapistSignedAt: '2026-09-01T10:00:00Z' } },
  ]);
  mockStorage.getPatientAssessments.mockResolvedValue([
    { templateId: 5, totalScore: 88, administeredAt: '2026-08-01', severity: 'moderate', isReliableChange: false },
    { templateId: 5, totalScore: 102, administeredAt: '2026-09-01', severity: 'mild', isReliableChange: true },
    { templateId: 5, totalScore: null, administeredAt: '2026-09-15' },
  ]);
  mockStorage.getOutcomeMeasureTemplate.mockResolvedValue({ name: 'PDMS-2', shortName: 'PDMS-2', clinicalCutoff: 85, maxScore: 150 });
});

describe('getPatientProgress', () => {
  it('builds a goal line sorted by date', async () => {
    const r = await getPatientProgress(1);
    expect(r.goals).toHaveLength(1);
    expect(r.goals[0].points.map((p) => p.value)).toEqual([40, 70]);
    expect(r.goals[0].description).toBe('Bilateral coordination');
  });

  it('builds an outcome-measure line, dropping null scores, with the template metadata', async () => {
    const r = await getPatientProgress(1);
    expect(r.outcomeMeasures).toHaveLength(1);
    expect(r.outcomeMeasures[0].shortName).toBe('PDMS-2');
    expect(r.outcomeMeasures[0].clinicalCutoff).toBe(85);
    expect(r.outcomeMeasures[0].points.map((p) => p.value)).toEqual([88, 102]);
  });

  it('omits goals with no recorded progress', async () => {
    mockStorage.getSoapNoteGoalProgressByGoalWithDetails.mockResolvedValue([]);
    const r = await getPatientProgress(1);
    expect(r.goals).toHaveLength(0);
  });

  it('survives a template lookup failure without dropping the measure', async () => {
    mockStorage.getOutcomeMeasureTemplate.mockRejectedValue(new Error('boom'));
    const r = await getPatientProgress(1);
    expect(r.outcomeMeasures).toHaveLength(1);
    expect(r.outcomeMeasures[0].name).toBe('Measure 5');
  });
});
