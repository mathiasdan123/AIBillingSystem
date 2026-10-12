/**
 * Shared clinical-documentation assistant tools (initial evaluations +
 * progress notes) — the data layer behind the same-named Blanche and MCP
 * tools. Covers tenant isolation (cross-tenant ids read as "not found",
 * identical to missing rows), the UI-route-mirroring prefill on
 * create_initial_evaluation, and the therapist-judgment invariants
 * (progress % passed through untouched, never computed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../storage', () => ({
  storage: {
    getPatient: vi.fn(),
    getPatientInitialEvaluations: vi.fn(),
    getInitialEvaluation: vi.fn(),
    createInitialEvaluation: vi.fn(),
    getProgressNotesForPatient: vi.fn(),
    getProgressNote: vi.fn(),
    getActiveTreatmentPlan: vi.fn(),
    getLastFinalizedProgressNote: vi.fn(),
    getFirstCompletedSessionDate: vi.fn(),
    countCompletedSessionsSince: vi.fn(),
  },
}));

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// progressNoteService pulls these transitively; keep the DB out of unit tests.
vi.mock('../services/activityProgressService', () => ({ getActivityProgress: vi.fn(async () => []) }));
vi.mock('../utils/phiAiGuard', () => ({ assertPhiAiAllowed: vi.fn() }));
vi.mock('../services/aiProvider', () => ({ isAiConfigured: () => false, createAiClient: vi.fn() }));

import { storage } from '../storage';
import {
  listPatientEvaluationsForAssistant,
  getEvaluationForAssistant,
  createDraftInitialEvaluationForAssistant,
  listPatientProgressNotesForAssistant,
  getProgressNoteForAssistant,
  getProgressNoteCadenceForAssistant,
} from '../services/clinicalDocAssistantTools';

const PRACTICE = 1;
const patient = {
  id: 7,
  practiceId: PRACTICE,
  firstName: 'Sarah',
  lastName: 'Kim',
  dateOfBirth: '2019-03-15',
  intakeData: { referringPhysician: 'Dr. Patel', primaryDiagnosis: 'DCD', school: 'Maple Elementary', grade: '1st' },
};

beforeEach(() => {
  vi.clearAllMocks();
  (storage.getPatient as any).mockResolvedValue(patient);
});

describe('tenant isolation', () => {
  it('a patient from another practice reads as not found (list tools)', async () => {
    (storage.getPatient as any).mockResolvedValue({ ...patient, practiceId: 999 });
    await expect(listPatientEvaluationsForAssistant(7, PRACTICE)).rejects.toThrow('Patient 7 not found');
    await expect(listPatientProgressNotesForAssistant(7, PRACTICE)).rejects.toThrow('Patient 7 not found');
    await expect(getProgressNoteCadenceForAssistant(7, PRACTICE)).rejects.toThrow('Patient 7 not found');
    await expect(
      createDraftInitialEvaluationForAssistant({ patientId: 7, practiceId: PRACTICE, therapistId: 'u1' }),
    ).rejects.toThrow('Patient 7 not found');
    expect(storage.createInitialEvaluation).not.toHaveBeenCalled();
  });

  it('detail reads go through practice-scoped storage and 404 cross-tenant', async () => {
    (storage.getInitialEvaluation as any).mockResolvedValue(undefined);
    (storage.getProgressNote as any).mockResolvedValue(undefined);
    await expect(getEvaluationForAssistant(42, PRACTICE)).rejects.toThrow('Evaluation 42 not found');
    await expect(getProgressNoteForAssistant(42, PRACTICE)).rejects.toThrow('Progress note 42 not found');
    expect(storage.getInitialEvaluation).toHaveBeenCalledWith(42, PRACTICE);
    expect(storage.getProgressNote).toHaveBeenCalledWith(42, PRACTICE);
  });

  it('rejects a non-numeric id before touching storage', async () => {
    await expect(listPatientEvaluationsForAssistant(NaN as any, PRACTICE)).rejects.toThrow('patientId is required');
    expect(storage.getPatient).not.toHaveBeenCalled();
  });
});

describe('initial evaluations', () => {
  it('lists evaluations with lifecycle fields and linked plan', async () => {
    (storage.getPatientInitialEvaluations as any).mockResolvedValue([
      { id: 3, evaluationDate: '2026-10-01', status: 'composed', treatmentPlanId: 12, evalCodeFinal: null, composedAt: new Date(), proposedAt: null, finalizedAt: null, createdAt: new Date() },
    ]);
    const result = await listPatientEvaluationsForAssistant(7, PRACTICE);
    expect(result.patient).toEqual({ id: 7, name: 'Sarah Kim' });
    expect(result.evaluationCount).toBe(1);
    expect(result.evaluations[0]).toMatchObject({ evaluationId: 3, status: 'composed', treatmentPlanId: 12 });
  });

  it('returns one evaluation with proposals, decisions, and eval-code suggestion/final', async () => {
    const longText = 'x'.repeat(2000);
    (storage.getInitialEvaluation as any).mockResolvedValue({
      id: 3,
      patientId: 7,
      evaluationDate: '2026-10-01',
      status: 'composed',
      personalInfo: { childName: 'Sarah Kim' },
      healthHistory: {},
      caregiverConcerns: {},
      subjectiveComments: longText,
      objectiveActivities: null,
      assessmentResults: null,
      skillAreas: null,
      interviewOutline: { sections: [] },
      aiWriteUp: { patientHistory: longText, goals: 'short' },
      proposedPlan: { sessionsPerWeek: 2, status: 'accepted' },
      proposedGoals: [{ skillArea: 'fine motor', status: 'accepted', acceptedGoalId: 55, rationale: 'r' }],
      evalCodeSuggestion: { code: '97166', rationale: 'moderate complexity' },
      evalCodeFinal: '97165',
      treatmentPlanId: 12,
      composedAt: new Date(),
      proposedAt: new Date(),
      finalizedAt: null,
    });
    const result = await getEvaluationForAssistant(3, PRACTICE);
    expect(result.proposedPlan).toMatchObject({ status: 'accepted' });
    expect(result.proposedGoals[0]).toMatchObject({ acceptedGoalId: 55 });
    expect(result.evalCode).toEqual({ suggestion: { code: '97166', rationale: 'moderate complexity' }, final: '97165' });
    // Long narratives are trimmed for chat.
    expect((result.writeUp!.patientHistory as string).length).toBeLessThan(900);
    expect((result.sections.subjectiveComments as string).length).toBeLessThan(900);
  });

  it('create prefills section 1 from the patient record like the UI route', async () => {
    (storage.createInitialEvaluation as any).mockImplementation(async (row: any) => ({ ...row, id: 9, createdAt: new Date(), composedAt: null, proposedAt: null, finalizedAt: null, treatmentPlanId: null, evalCodeFinal: null }));
    const result = await createDraftInitialEvaluationForAssistant({
      patientId: 7,
      practiceId: PRACTICE,
      therapistId: 'therapist-1',
    });
    expect(storage.createInitialEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        practiceId: PRACTICE,
        patientId: 7,
        therapistId: 'therapist-1',
        status: 'draft',
        personalInfo: expect.objectContaining({
          childName: 'Sarah Kim',
          referringPhysician: 'Dr. Patel',
          primaryDiagnosis: 'DCD',
          school: 'Maple Elementary',
          gradeClassroom: '1st',
        }),
      }),
    );
    expect(result.created).toBe(true);
    expect(result.evaluation.evaluationId).toBe(9);
    expect(result.evaluation.status).toBe('draft');
  });

  it('create rejects a malformed evaluationDate', async () => {
    await expect(
      createDraftInitialEvaluationForAssistant({
        patientId: 7, practiceId: PRACTICE, therapistId: 'u1', evaluationDate: '10/01/2026',
      }),
    ).rejects.toThrow('YYYY-MM-DD');
    expect(storage.createInitialEvaluation).not.toHaveBeenCalled();
  });
});

describe('progress notes', () => {
  it('returns one note with therapist-entered % passed through untouched', async () => {
    (storage.getProgressNote as any).mockResolvedValue({
      id: 5,
      patientId: 7,
      treatmentPlanId: 12,
      status: 'draft',
      windowStart: '2026-07-01',
      windowEnd: '2026-10-01',
      sessionsReviewed: 10,
      goalEntries: [
        { goalId: 55, goalText: 'g', goalTerm: 'short_term', durationWeeks: 8, startDate: '2026-07-01', endDate: '2026-09-01', progressPercent: 40, interventions: 'i', assistanceLevels: 'a', currentAbility: 'c' },
        { goalId: 56, goalText: 'g2', goalTerm: null, durationWeeks: null, startDate: null, endDate: null, progressPercent: null, interventions: '', assistanceLevels: '', currentAbility: '' },
      ],
      presentLevel: 'p',
      annualGoals: 'a',
      recommendations: 'r',
      extensionRequested: true,
      extensionNewEndDate: '2027-01-01',
      extensionRationale: 'continued medical necessity',
      extensionAppliedAt: null,
      goalProgressSyncedAt: null,
      generatedAt: null,
      finalizedAt: null,
    });
    const result = await getProgressNoteForAssistant(5, PRACTICE);
    expect(result.goalEntries[0].progressPercent).toBe(40);
    expect(result.goalEntries[1].progressPercent).toBeNull();
    expect(result.extension).toMatchObject({ requested: true, newEndDate: '2027-01-01' });
    expect(result.narratives.presentLevel).toBe('p');
  });

  it('cadence reports due-ness with the policy attached', async () => {
    (storage.getActiveTreatmentPlan as any).mockResolvedValue({ startDate: '2026-01-01' });
    (storage.getLastFinalizedProgressNote as any).mockResolvedValue(undefined);
    (storage.countCompletedSessionsSince as any).mockResolvedValue(11);
    const result = await getProgressNoteCadenceForAssistant(7, PRACTICE);
    expect(result.cadence.due).toBe(true);
    expect(result.cadence.reason).toBe('sessions');
    expect(result.policy.sessionsPerProgressNote).toBe(10);
    expect(result.message).toContain('DUE');
  });
});
