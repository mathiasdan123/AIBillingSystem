import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the storage layer and the PHI guard BEFORE importing the service.
// vi.hoisted so the mock object exists when the hoisted vi.mock factory runs.
const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatient: vi.fn(),
    getCachedInsuranceData: vi.fn(async () => null),
    getActiveTreatmentPlan: vi.fn(async () => null),
    getPatientTreatmentPlans: vi.fn(async () => []),
    getTreatmentGoals: vi.fn(async () => []),
  },
}));
vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../utils/phiAiGuard', () => ({ assertPhiAiAllowed: vi.fn() }));

import { generateSoapNoteAndBilling } from '../services/aiSoapBillingService';

const baseReq = {
  patientId: 42,
  activities: ['obstacle course'],
  mood: 'cooperative',
  duration: 45,
  location: 'clinic',
  assessment: {
    performance: 'fair',
    assistance: 'moderate',
    strength: 'adequate',
    motorPlanning: 'mild difficulty',
    sensoryRegulation: 'minimal supports',
  },
  planNextSteps: 'continue',
};

describe('generateSoapNoteAndBilling — tenant isolation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to generate a note for a patient outside the caller practice', async () => {
    // Patient belongs to practice 2; caller is practice 1.
    mockStorage.getPatient.mockResolvedValue({ id: 42, practiceId: 2, firstName: 'A', lastName: 'B' });
    await expect(
      generateSoapNoteAndBilling({ ...baseReq, practiceId: 1 }),
    ).rejects.toThrow('Patient not found');
  });

  it('treats a missing patient the same as a cross-tenant one (no existence oracle)', async () => {
    mockStorage.getPatient.mockResolvedValue(undefined);
    await expect(
      generateSoapNoteAndBilling({ ...baseReq, practiceId: 1 }),
    ).rejects.toThrow('Patient not found');
  });
});
