/**
 * SOAP AI JSON parse hardening (eval run 44423563561, P3 sample 1).
 *
 * The model's reply completed with stop_reason "end_turn" but was not valid
 * JSON ("Expected double-quoted property name ... line 20 column 5" -- the
 * shape a trailing comma produces). The strict JSON.parse threw, the catch
 * block returned the rule-based template, and the release gate correctly
 * refused the fallback note. In production the same event would ship a
 * templated note in place of a generated one.
 *
 * generateSoapNoteAndBilling now: parses, and on a SyntaxError tries once
 * more after a conservative trailing-comma repair; if the reply still does
 * not parse, calls the model once more; if THAT fails too, logs the error at
 * error level and returns the fallback flagged with fallbackReason. These
 * tests drive the real function with a mocked client whose replies are
 * scripted per call.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { mockStorage, streamCalls, replies } = vi.hoisted(() => ({
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
  /** Scripted model replies, consumed one per stream() call. */
  replies: [] as string[],
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
        const text = replies.shift();
        if (text === undefined) throw new Error('test: no scripted reply left for this call');
        const handlers: Record<string, Array<(t: string) => void>> = {};
        return {
          on: (event: string, fn: (t: string) => void) => {
            (handlers[event] ??= []).push(fn);
          },
          abort: () => {},
          finalMessage: async () => {
            for (const fn of handlers.text ?? []) fn(text);
            return {
              stop_reason: 'end_turn',
              usage: { output_tokens: 1000 },
              content: [{ type: 'text', text }],
            };
          },
        };
      },
    },
  }),
}));

import logger from '../services/logger';
import {
  generateSoapNoteAndBilling,
  parseSoapAiJson,
  repairTrailingCommas,
  type AiSoapBillingRequest,
} from '../services/aiSoapBillingService';

const PATIENT = { id: 7, practiceId: 1, firstName: 'Mia', lastName: 'Example', dateOfBirth: '2018-01-01' };
const REQUEST: AiSoapBillingRequest = {
  patientId: 7,
  practiceId: 1,
  activities: ['Obstacle Course'],
  mood: '',
  duration: 45,
  location: 'Clinic',
  assessment: { performance: '', assistance: '', strength: '', motorPlanning: '', sensoryRegulation: '' },
  planNextSteps: '',
} as AiSoapBillingRequest;

/** A minimal, valid model reply the validator accepts. */
const VALID_NOTE = {
  subjective: 'Patient attended a 45-minute session.',
  objective: 'Patient completed Obstacle Course.',
  assessment: 'Patient participated in the documented activities.',
  plan: 'Continue skilled occupational therapy.',
  cptCodes: [{ code: '97530', name: 'Therapeutic Activities', units: 3, rationale: 'Obstacle Course.' }],
  activityCptPairings: [{ activity: 'Obstacle Course', code: '97530', rationale: 'Functional task.' }],
  billingRationale: 'Codes suggested from the documented activities.',
  auditNotes: ['Session duration 45 minutes.'],
};
const VALID_JSON = JSON.stringify(VALID_NOTE, null, 2);
// Same note with a trailing comma after the last property of the top-level
// object and after the last array element -- the model's known defect.
const TRAILING_COMMA_JSON = VALID_JSON
  .replace(/"auditNotes": \[\n(\s*)"Session duration 45 minutes."\n(\s*)\]\n\}/, '"auditNotes": [\n$1"Session duration 45 minutes.",\n$2],\n}');
// An unquoted key: no conservative repair applies, so this must stay a parse failure.
const UNQUOTED_KEY_JSON = VALID_JSON.replace('"objective":', 'objective:');

describe('repairTrailingCommas / parseSoapAiJson', () => {
  it('the trailing-comma fixture really is broken and really is the model\'s error shape', () => {
    expect(TRAILING_COMMA_JSON).not.toBe(VALID_JSON);
    expect(() => JSON.parse(TRAILING_COMMA_JSON)).toThrow(SyntaxError);
  });

  it('removes a trailing comma before } and ] and nothing else', () => {
    expect(JSON.parse(repairTrailingCommas(TRAILING_COMMA_JSON))).toEqual(VALID_NOTE);
    expect(repairTrailingCommas('{"a": [1, 2,], "b": {"c": 1,},}')).toBe('{"a": [1, 2], "b": {"c": 1}}');
    expect(repairTrailingCommas(VALID_JSON)).toBe(VALID_JSON);
  });

  it('never touches a comma inside a string, including after an escaped quote', () => {
    const inside = '{"plan": "Continue tasks, then rest, ]", "note": "He said \\"go,\\" ]"}';
    expect(repairTrailingCommas(inside)).toBe(inside);
    expect(JSON.parse(repairTrailingCommas(inside))).toEqual(JSON.parse(inside));
  });

  it('parseSoapAiJson repairs a trailing comma and reports that it did', () => {
    expect(parseSoapAiJson(TRAILING_COMMA_JSON)).toEqual({ value: VALID_NOTE, repaired: true });
    expect(parseSoapAiJson(VALID_JSON)).toEqual({ value: VALID_NOTE, repaired: false });
    expect(parseSoapAiJson('```json\n' + TRAILING_COMMA_JSON + '\n```')).toEqual({ value: VALID_NOTE, repaired: true });
  });

  it('parseSoapAiJson rethrows the ORIGINAL error when the repair does not help', () => {
    expect(() => parseSoapAiJson(UNQUOTED_KEY_JSON)).toThrow(/Expected double-quoted property name/);
  });
});

describe('generateSoapNoteAndBilling: retry once, repair trailing commas, flag the fallback', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    streamCalls.length = 0;
    replies.length = 0;
    mockStorage.getPatient.mockResolvedValue(PATIENT);
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a reply with trailing commas is repaired and used: one call, generationMode "ai", a warning says it was repaired', async () => {
    replies.push(TRAILING_COMMA_JSON);
    const result = await generateSoapNoteAndBilling(REQUEST);

    expect(streamCalls).toHaveLength(1);
    expect(result.generationMode).toBe('ai');
    expect(result.fallbackReason).toBeUndefined();
    expect(result.objective).toContain('Obstacle Course');
    expect(warnSpy).toHaveBeenCalledWith(
      'Repaired trailing comma(s) in SOAP AI JSON output',
      expect.objectContaining({ attempt: 1 }),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('an unparseable reply is retried once; a valid second reply yields an "ai" note', async () => {
    replies.push(UNQUOTED_KEY_JSON, VALID_JSON);
    const result = await generateSoapNoteAndBilling(REQUEST);

    expect(streamCalls).toHaveLength(2);
    expect(result.generationMode).toBe('ai');
    expect(result.fallbackReason).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      'SOAP AI output was not valid JSON; retrying the model call once',
      expect.objectContaining({ attempt: 1, error: expect.stringContaining('Expected double-quoted property name') }),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('the retry does not re-stream deltas into the live preview, which already holds the first reply', async () => {
    replies.push(UNQUOTED_KEY_JSON, VALID_JSON);
    const deltas: string[] = [];
    const progress = vi.fn();
    await generateSoapNoteAndBilling(REQUEST, { onTextDelta: (t) => deltas.push(t), onProgress: progress });

    expect(streamCalls).toHaveLength(2);
    expect(deltas).toEqual([UNQUOTED_KEY_JSON]); // first attempt only
    expect(progress).toHaveBeenCalledTimes(2); // keepalive still fires on both
  });

  it('two unparseable replies: no third call, the flagged fallback is returned and the error is logged', async () => {
    replies.push(UNQUOTED_KEY_JSON, TRAILING_COMMA_JSON.replace('"subjective":', 'subjective:'));
    const result = await generateSoapNoteAndBilling(REQUEST);

    expect(streamCalls).toHaveLength(2);
    expect(result.generationMode).toBe('fallback');
    expect(result.fallbackReason).toBe('ai_output_unparseable');
    // The real rule-based template ran, not a stub.
    expect(result.billingRationale).toContain('rule-based mapping');
    // Never silent: error-level log names the reason, the attempts and the parse error.
    expect(errorSpy).toHaveBeenCalledWith(
      'SOAP AI generation failed; returning the rule-based FALLBACK note',
      expect.objectContaining({
        fallbackReason: 'ai_output_unparseable',
        attempts: 2,
        cause: expect.stringMatching(/Expected (double-quoted )?property name/),
        patientId: 7,
      }),
    );
    // The pre-existing catch-block log (asserted by soapFallbackPathIntegration) still fires.
    expect(consoleErrorSpy).toHaveBeenCalledWith('AI generation error:', expect.anything());
  });

  it('a call that throws (not a parse failure) is not retried and is flagged "ai_call_failed"', async () => {
    // No scripted reply: the mocked stream() throws on the first call.
    const result = await generateSoapNoteAndBilling(REQUEST);

    expect(streamCalls).toHaveLength(1);
    expect(result.generationMode).toBe('fallback');
    expect(result.fallbackReason).toBe('ai_call_failed');
    expect(errorSpy).toHaveBeenCalledWith(
      'SOAP AI generation failed; returning the rule-based FALLBACK note',
      expect.objectContaining({ fallbackReason: 'ai_call_failed', error: expect.stringContaining('no scripted reply') }),
    );
  });
});
