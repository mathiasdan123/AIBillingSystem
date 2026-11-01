/**
 * Integration proof that the FALLBACK PATH actually runs through the real
 * request handler's error handling, not just that fallbackGeneration()
 * produces correct text in isolation.
 *
 * Every other fallback-adjacent test (soapActivityCptPairing.test.ts,
 * documentationDenialBackstop.test.ts, etc.) either calls fallbackGeneration
 * indirectly via isAiConfigured: () => false -- the "AI was never
 * configured" path -- or tests the mood/documentation backstops' pure
 * string functions directly. Neither proves that a REAL AI client failure,
 * mid-request, is actually caught by generateSoapNoteAndBilling's try/catch
 * (server/services/aiSoapBillingService.ts:262-347) and correctly falls
 * through to the real fallbackGeneration(), rather than throwing an
 * unhandled error up to the route.
 *
 * This test forces that exact path: isAiConfigured() reports true (so the
 * code commits to attempting a live call, unlike the no-key path), the
 * mocked client's .stream() call throws (simulating a real API failure --
 * auth error, rate limit, network failure, etc.), and we assert on THREE
 * independent signals that the real catch-block-triggered fallback ran,
 * not just that the final output happens to look like fallback text:
 *   1. The mocked stream() was actually called once (a real attempt was made).
 *   2. console.error fired with the exact "AI generation error:" message the
 *      catch block logs (the catch block itself executed).
 *   3. The result carries generationMode: "fallback" and fallbackGeneration's
 *      own billingRationale string (the real fallbackGeneration ran, not a
 *      stub).
 *
 * A second test contrasts this against the no-key path, to prove the two are
 * reached by genuinely different code (one logs "AI generation error:" via
 * console.error after a real attempt, the other logs "Using fallback
 * rule-based SOAP generation (no API key)" via console.log and never
 * attempts a call) -- both end in fallback output, but only one is "error
 * handling" in the sense Daniel asked this test to verify.
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
  },
  streamCalls: [] as unknown[],
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../utils/phiAiGuard', () => ({ assertPhiAiAllowed: vi.fn() }));

// isAiConfigured: true -- the code must commit to a real attempt, not take
// the "no key" shortcut. The mocked client's stream() throws, simulating a
// real failure mid-request (auth, rate limit, network, etc.) rather than
// short-circuiting before any attempt was made.
vi.mock('../services/aiProvider', () => ({
  isAiConfigured: () => true,
  useBedrock: () => false,
  createAiClient: () => ({
    messages: {
      stream: (params: unknown) => {
        streamCalls.push(params);
        throw new Error('simulated API failure (integration test)');
      },
    },
  }),
}));

import { generateSoapNoteAndBilling } from '../services/aiSoapBillingService';

const PATIENT = { id: 7, practiceId: 1, firstName: 'Mia', lastName: 'Example', dateOfBirth: '2018-01-01' };
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

describe('fallback path — reached via a real caught AI failure', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    streamCalls.length = 0;
    mockStorage.getPatient.mockResolvedValue(PATIENT);
    process.env.ANTHROPIC_API_KEY = 'test-dummy-key';
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('attempts a real call, catches the failure, and returns the real fallback output', async () => {
    const result = await generateSoapNoteAndBilling(BASE_REQUEST);

    // 1. A real attempt was made -- this did not take the "no key" shortcut.
    expect(streamCalls).toHaveLength(1);

    // 2. The real catch block executed (not some other error path).
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'AI generation error:',
      expect.objectContaining({ message: 'simulated API failure (integration test)' }),
    );

    // 3. The real fallbackGeneration() ran -- its own distinguishing marker
    // and rationale string, not a stand-in.
    expect(result.generationMode).toBe('fallback');
    expect(result.billingRationale).toBe(
      'Billing codes assigned using rule-based accuracy checks. AI unavailable.',
    );
  });

  it('still produces usable billing output via the real fallback (not a crash)', async () => {
    const result = await generateSoapNoteAndBilling(BASE_REQUEST);
    expect(result.cptCodes.length).toBeGreaterThan(0);
    expect(result.totalReimbursement).toBeGreaterThan(0);
    expect(typeof result.plan).toBe('string');
    expect(result.plan.length).toBeGreaterThan(0);
  });
});

describe('fallback path — contrast with the "AI never configured" path', () => {
  // Separate describe block: re-mocks aiProvider with isAiConfigured: false
  // to prove this is a genuinely different code path from the one above,
  // not the same shortcut under a different name.
  it('takes a different route (no attempt, no "AI generation error:" log) but the same output shape', async () => {
    vi.resetModules();
    vi.doMock('../storage', () => ({ storage: mockStorage }));
    vi.doMock('../utils/phiAiGuard', () => ({ assertPhiAiAllowed: vi.fn() }));
    vi.doMock('../services/aiProvider', () => ({
      isAiConfigured: () => false,
      useBedrock: () => false,
      createAiClient: vi.fn(),
    }));
    const { generateSoapNoteAndBilling: generateNoKey } = await import('../services/aiSoapBillingService');

    mockStorage.getPatient.mockResolvedValue(PATIENT);
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    streamCalls.length = 0;

    const result = await generateNoKey(BASE_REQUEST);

    // No attempt was ever made -- distinguishing this from the caught-failure path above.
    expect(streamCalls).toHaveLength(0);
    expect(consoleErrorSpy).not.toHaveBeenCalledWith('AI generation error:', expect.anything());
    expect(consoleLogSpy).toHaveBeenCalledWith('Using fallback rule-based SOAP generation (no API key)');

    // Same real fallbackGeneration() output shape as the caught-failure path.
    expect(result.generationMode).toBe('fallback');

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.doUnmock('../services/aiProvider');
    vi.resetModules();
  });
});
