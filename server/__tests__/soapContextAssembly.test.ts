/**
 * Closes a gap named in review of scripts/eval-soap-generation.ts: that
 * harness only tests buildUserPrompt against HAND-WRITTEN fixtures
 * (treatmentPlan/treatmentGoals/priorSessions passed in directly) -- it
 * never exercises the real DB-querying code in generateSoapNoteAndBilling
 * (storage.getActiveTreatmentPlan / getPatientTreatmentPlans /
 * getTreatmentGoals / getRecentSoapNotesForPatient) that actually assembles
 * those objects from a patient's real records. A bug in THAT assembly
 * logic -- wrong patient's goals, a stale plan not filtered out, an
 * achieved goal not excluded -- would never be caught by the eval harness,
 * since it bypasses this code entirely.
 *
 * This test mocks only `storage` (same pattern as
 * soapActivityCptPairing.test.ts) and lets the real generateSoapNoteAndBilling
 * context-assembly code run against it, then inspects the ACTUAL prompt
 * text that would be sent to the model -- captured from the mocked AI
 * client's own call arguments, not re-derived -- for the same injected-data
 * markers soapNarrativePrompt.test.ts already treats as the source of
 * truth ('ACTIVE TREATMENT GOALS (CONTEXT ONLY', 'MOST RECENT PLAN
 * (carry-forward baseline', 'PRIOR SESSION SUMMARIES'). This is deliberately
 * NOT a spy on buildUserPrompt itself: an internal same-module call to an
 * exported function is not guaranteed to go through a vi.spyOn on the
 * module namespace once compiled, so asserting on the real outbound
 * request body is the reliable seam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatient: vi.fn(),
    getCachedInsuranceData: vi.fn(async () => null),
    getActiveTreatmentPlan: vi.fn(),
    getPatientTreatmentPlans: vi.fn(),
    getTreatmentGoals: vi.fn(),
    getRecentSoapNotesForPatient: vi.fn(),
    getCptCodes: vi.fn(async () => []),
  },
}));
vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../utils/phiAiGuard', () => ({ assertPhiAiAllowed: vi.fn() }));

const { streamCalls } = vi.hoisted(() => ({ streamCalls: [] as any[] }));
vi.mock('../services/aiProvider', () => ({
  isAiConfigured: () => true,
  useBedrock: () => false,
  createAiClient: () => ({
    messages: {
      // Captures the exact outbound request body, then short-circuits
      // before any real network call. generateSoapNoteAndBilling's own
      // try/catch falls back to rule-based generation on this throw --
      // this test only cares about what was ABOUT to be sent.
      stream: (params: any) => {
        streamCalls.push(params);
        throw new Error('test: short-circuit before any real network call');
      },
    },
  }),
}));

import { generateSoapNoteAndBilling, type AiSoapBillingRequest } from '../services/aiSoapBillingService';

function baseRequest(overrides: Partial<AiSoapBillingRequest> = {}): AiSoapBillingRequest {
  return {
    patientId: 1,
    practiceId: 1,
    activities: ['Obstacle Course'],
    mood: '',
    duration: 45,
    location: 'Clinic',
    assessment: {
      performance: '', assistance: '', strength: '', motorPlanning: '', sensoryRegulation: '',
    },
    planNextSteps: 'Bilateral coordination',
    ...overrides,
  } as AiSoapBillingRequest;
}

function sentPromptText(): string {
  expect(streamCalls).toHaveLength(1);
  const params = streamCalls[0];
  const userContent = params.messages?.[0]?.content ?? '';
  return `${params.system ?? ''}\n${userContent}`;
}

describe('generateSoapNoteAndBilling — context assembly from real storage, not a fixture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamCalls.length = 0;
    // Expected noise: generateSoapNoteAndBilling logs the short-circuit
    // error from the mocked client before falling back; not a test failure.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockStorage.getPatient.mockResolvedValue({
      id: 1, practiceId: 1, firstName: 'New', lastName: 'Patient', dateOfBirth: '2018-01-01',
    });
    mockStorage.getCachedInsuranceData.mockResolvedValue(null);
  });

  it('a patient with no treatment-plan, goals, or prior-note rows produces a prompt with no injected history markers', async () => {
    mockStorage.getActiveTreatmentPlan.mockResolvedValue(undefined);
    mockStorage.getPatientTreatmentPlans.mockResolvedValue([]);
    mockStorage.getTreatmentGoals.mockResolvedValue([]);
    mockStorage.getRecentSoapNotesForPatient.mockResolvedValue([]);

    await generateSoapNoteAndBilling(baseRequest());

    // Proves the REAL assembly code ran against the mocked DB, not that
    // the test skipped straight to a fixture.
    expect(mockStorage.getActiveTreatmentPlan).toHaveBeenCalledWith(1);
    expect(mockStorage.getPatientTreatmentPlans).toHaveBeenCalledWith(1);
    expect(mockStorage.getRecentSoapNotesForPatient).toHaveBeenCalledWith(1, 1, 3);

    const sent = sentPromptText();
    // Narrowed to each section's actual injected-data header, not the bare
    // phrase: the system prompt's general instructions legitimately mention
    // "PRIOR SESSION SUMMARIES" and "ACTIVE TREATMENT GOALS" by name (to
    // tell the model how to use that section IF it appears) -- what must
    // never appear for a patient with no rows is the real header that only
    // gets injected alongside actual data. Same distinction
    // soapNarrativePrompt.test.ts already draws for buildUserPrompt alone;
    // this test combines system+user text, so it hits the system prompt's
    // generic mention too and needs the same narrowing.
    expect(sent).not.toContain('ACTIVE TREATMENT GOALS (CONTEXT ONLY');
    expect(sent).not.toContain('MOST RECENT PLAN (carry-forward baseline');
    expect(sent).not.toContain('PRIOR SESSION SUMMARIES (real data');
  });

  it('positive control: a patient WITH a plan, active goals, and a prior note DOES get those markers -- proves the assertions above are not vacuous', async () => {
    mockStorage.getActiveTreatmentPlan.mockResolvedValue({ id: 42, diagnosis: 'Developmental coordination disorder' });
    mockStorage.getPatientTreatmentPlans.mockResolvedValue([]);
    mockStorage.getTreatmentGoals.mockResolvedValue([
      { description: 'Improve bilateral coordination', status: 'in_progress' },
    ]);
    mockStorage.getRecentSoapNotesForPatient.mockResolvedValue([
      {
        therapistSignedAt: '2026-10-01',
        objective: 'Required moderate assist for ball skills.',
        assessment: 'Emerging postural control.',
        plan: 'Continue OT 2x/week focusing on bilateral coordination.',
      },
    ]);

    await generateSoapNoteAndBilling(baseRequest());

    const sent = sentPromptText();
    expect(sent).toContain('ACTIVE TREATMENT GOALS (CONTEXT ONLY');
    expect(sent).toContain('MOST RECENT PLAN (carry-forward baseline');
    expect(sent).toContain('PRIOR SESSION SUMMARIES');
  });

  it('an achieved goal is excluded from the prompt even though the patient has an active plan', async () => {
    mockStorage.getActiveTreatmentPlan.mockResolvedValue({ id: 42 });
    mockStorage.getPatientTreatmentPlans.mockResolvedValue([]);
    mockStorage.getTreatmentGoals.mockResolvedValue([
      { description: 'Improve bilateral coordination', status: 'in_progress' },
      { description: 'Independent shoe-tying', status: 'achieved' },
    ]);
    mockStorage.getRecentSoapNotesForPatient.mockResolvedValue([]);

    await generateSoapNoteAndBilling(baseRequest());

    const sent = sentPromptText();
    expect(sent).toContain('Improve bilateral coordination');
    expect(sent).not.toContain('Independent shoe-tying');
  });
});
