/**
 * generateSoapNoteAndBilling({ forceFallback: true }) must run the real
 * fallbackGeneration() WITHOUT attempting a model call (therapybill-qa #2).
 *
 * Mirrors soapFallbackPathIntegration.test.ts: AI is "configured" and the
 * mocked client's stream() would throw if reached. Here it must never be
 * reached at all: the forced path is a shortcut taken before the AI attempt,
 * so it costs nothing and cannot fail on the model side.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { mockStorage, streamCalls } = vi.hoisted(() => ({
  mockStorage: {
    getPatient: vi.fn(),
    getCachedInsuranceData: vi.fn(async () => null),
    getActiveTreatmentPlan: vi.fn(async () => null),
    getPatientTreatmentPlans: vi.fn(async () => []),
    getTreatmentGoals: vi.fn(async () => []),
    getRecentSoapNotesForPatient: vi.fn(async () => []),
    getCptCodes: vi.fn(async () => []),
    resolvePracticeCptRate: vi.fn(async () => null),
  },
  streamCalls: [] as unknown[],
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../utils/phiAiGuard', () => ({ assertPhiAiAllowed: vi.fn() }));
vi.mock('../services/aiProvider', () => ({
  isAiConfigured: () => true,
  useBedrock: () => false,
  createAiClient: () => ({
    messages: {
      stream: (params: unknown) => {
        streamCalls.push(params);
        throw new Error('model must not be called when forceFallback is set');
      },
    },
  }),
}));

import { generateSoapNoteAndBilling } from '../services/aiSoapBillingService';

const PATIENT = { id: 7, practiceId: 1, firstName: 'Riley', lastName: 'Nodob', dateOfBirth: null };
const BASE_REQUEST = {
  patientId: 7,
  practiceId: 1,
  activities: ['Obstacle Course'],
  mood: '',
  duration: 45,
  location: 'Clinic',
  assessment: {
    performance: 'Stable',
    assistance: 'Minimal Assist',
    strength: 'Adequate',
    motorPlanning: 'Mild Difficulty',
    sensoryRegulation: 'Needed Minimal Supports',
  },
  planNextSteps: '',
} as any;

describe('forceFallback option', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    streamCalls.length = 0;
    mockStorage.getPatient.mockResolvedValue(PATIENT);
    process.env.ANTHROPIC_API_KEY = 'test-dummy-key';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('runs the real fallback generator and never calls the model', async () => {
    const result = await generateSoapNoteAndBilling(BASE_REQUEST, { forceFallback: true });

    expect(streamCalls).toHaveLength(0);
    expect(errorSpy).not.toHaveBeenCalledWith('AI generation error:', expect.anything());
    expect(logSpy).toHaveBeenCalledWith(
      'Using fallback rule-based SOAP generation (forced by demo test fixture)',
    );
    expect(result.generationMode).toBe('fallback');
    expect(result.billingRationale).toBe(
      'Billing codes assigned using rule-based accuracy checks. AI unavailable.',
    );
    expect(result.cptCodes.length).toBeGreaterThan(0);
  });

  it('works for a patient with no date of birth (the blank-DOB fixture)', async () => {
    const result = await generateSoapNoteAndBilling(BASE_REQUEST, { forceFallback: true });
    expect(typeof result.plan).toBe('string');
    expect(result.plan.length).toBeGreaterThan(0);
    // No fabricated age may leak into the fallback note for a blank DOB.
    const text = [result.subjective, result.objective, result.assessment, result.plan].join(' ');
    expect(text).not.toMatch(/\b56\s*years?\b/i);
  });

  it('prices the fallback at the practice\'s configured per-code rate, like the AI path (QA #2 retest)', async () => {
    // Demo practice: every treatment code configured at $100, not the $289 estimate.
    mockStorage.getCptCodes.mockResolvedValueOnce([
      { id: 1, code: '97530' }, { id: 2, code: '97112' }, { id: 3, code: '97110' },
    ]);
    mockStorage.resolvePracticeCptRate.mockResolvedValue('100.00');

    const result = await generateSoapNoteAndBilling(BASE_REQUEST, { forceFallback: true });

    expect(result.cptCodes.length).toBeGreaterThan(0);
    for (const code of result.cptCodes) expect(code.reimbursement).toBe(100 * code.units);
    for (const block of result.timeBlocks) expect(block.rate).toBe(100);
    expect(result.totalReimbursement).toBe(result.cptCodes.reduce((s, c) => s + c.reimbursement, 0));
    expect(mockStorage.resolvePracticeCptRate).toHaveBeenCalledWith(1, expect.any(Number));
  });

  it('keeps the flat estimate when the practice has no configured rate for a code', async () => {
    mockStorage.getCptCodes.mockResolvedValueOnce([{ id: 1, code: '97530' }, { id: 2, code: '97112' }, { id: 3, code: '97110' }]);
    mockStorage.resolvePracticeCptRate.mockResolvedValue(null);

    const result = await generateSoapNoteAndBilling(BASE_REQUEST, { forceFallback: true });

    for (const code of result.cptCodes) expect(code.reimbursement).toBe(289 * code.units);
  });

  it('without the option, the AI path is still attempted (contrast)', async () => {
    const result = await generateSoapNoteAndBilling(BASE_REQUEST);
    expect(streamCalls).toHaveLength(1);
    expect(result.generationMode).toBe('fallback'); // via the caught-failure path
    expect(errorSpy).toHaveBeenCalledWith('AI generation error:', expect.anything());
  });
});
