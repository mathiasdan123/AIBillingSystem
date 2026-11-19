/**
 * #489 review: the prompt, the timely-filing rule and the output guard
 * (sanitizeDateAdvice) must all judge dates against the same effective set,
 * line dates with the linked session's date as the fallback. Before this,
 * the guard built its dates from the raw line items only, so with every
 * line undated it had no dates at all and let a fabricated "future date of
 * service" finding through, and with a future session date it could not
 * tell a legitimate future-service finding from a fabricated one.
 *
 * The model is faked through aiProvider so the full predictDenial path runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { modelReply } = vi.hoisted(() => ({ modelReply: { text: '{}' } }));

vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../services/aiLearningService', () => ({ getRecommendationsForClaim: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/aiProvider', () => ({
  isAiConfigured: () => true,
  createAiClient: () => ({
    messages: {
      create: vi.fn(async () => ({ content: [{ type: 'text', text: modelReply.text }] })),
    },
  }),
}));

import { predictDenial, sanitizeDateAdvice, effectiveLineDates } from '../services/aiDenialPredictor';

const NOW = new Date('2026-11-19T15:00:00.000Z');
const PAST = '2026-10-26';
const FUTURE = '2027-01-15';

const fabricatedFutureFinding = {
  category: 'Future Date of Service',
  description: `The date of service (${PAST}) is in the future, which is invalid and will cause automatic rejection.`,
  suggestion: 'Correct the date of service to a valid past date and resubmit.',
  severity: 'critical' as const,
};
const legitimateFutureFinding = {
  category: 'Future Date of Service',
  description: `The date of service (${FUTURE}) is in the future; the claim cannot be submitted before care is rendered.`,
  suggestion: 'Hold the claim until the visit has taken place.',
  severity: 'critical' as const,
};

const line = (dateOfService: string | null) => ({
  cptCodeId: 1, icd10CodeId: 1, units: 1, rate: '100.00', amount: '100.00', modifier: 'GO', dateOfService,
  cptCode: { code: '97530', description: 'Therapeutic activities' }, icd10Code: { code: 'F82', description: 'DCD' },
});
const claim = (sessionDate: string | null) => ({ id: 1, claimNumber: 'C-1', totalAmount: '100.00', status: 'draft', insuranceId: 1, insuranceName: 'Aetna', sessionDate, sessionId: 9 });
const patient = { firstName: 'Ava', lastName: 'Sample', dateOfBirth: '2018-04-11', insuranceProvider: 'Aetna', insuranceId: 'X' };
const soap = { subjective: 'Patient reports steady progress toward goals at home and school.', objective: 'Demonstrated improved bilateral coordination during therapeutic activities.', assessment: 'Progressing toward functional independence goals; skilled intervention remains necessary.', plan: 'Continue therapeutic activities; update goals; home program assigned.', sessionType: 'individual', interventions: null, homeProgram: null, progressNotes: null };

describe('effectiveLineDates', () => {
  it('fills undated lines from the session and represents a line-less claim by its session date', () => {
    expect(effectiveLineDates({ sessionDate: PAST }, [line(null), line(FUTURE)])).toEqual([{ dateOfService: PAST }, { dateOfService: FUTURE }]);
    expect(effectiveLineDates({ sessionDate: null }, [line(null)])).toEqual([{ dateOfService: null }]);
    expect(effectiveLineDates({ sessionDate: PAST }, [])).toEqual([{ dateOfService: PAST }]);
    expect(effectiveLineDates({ sessionDate: null }, [])).toEqual([]);
  });
});

describe('sanitizeDateAdvice on the effective date set', () => {
  it('(a) all lines undated, past session date: a fabricated future-service finding is removed', () => {
    const result = { riskScore: 80, riskLevel: 'high' as const, issues: [fabricatedFutureFinding], overallRecommendation: 'Correct the date of service.', analyzedAt: NOW.toISOString() };
    const out = sanitizeDateAdvice(result, effectiveLineDates(claim(PAST), [line(null), line(null)]), NOW);
    expect(out.issues).toEqual([]);
    expect(out.riskScore).toBeLessThan(80);
    // The raw lines alone carry no dates, which is exactly what let the finding through before.
    expect(sanitizeDateAdvice(result, [line(null), line(null)], NOW).issues).toHaveLength(1);
  });

  it('(b) one past line plus an undated line taking a future session date: a legitimate future-service finding stays', () => {
    const result = { riskScore: 80, riskLevel: 'high' as const, issues: [legitimateFutureFinding], overallRecommendation: 'Hold the claim.', analyzedAt: NOW.toISOString() };
    const out = sanitizeDateAdvice(result, effectiveLineDates(claim(FUTURE), [line(PAST), line(null)]), NOW);
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0].category).toBe('Future Date of Service');
    expect(out.riskScore).toBe(80);
  });
});

describe('predictDenial end to end with a faked model', () => {
  beforeEach(() => { modelReply.text = '{}'; });

  it('(a) all lines undated, past session date: the model\'s fabricated future finding does not reach the output, and no missing-date issue is raised', async () => {
    modelReply.text = JSON.stringify({ riskScore: 85, riskLevel: 'high', additionalIssues: [fabricatedFutureFinding], overallRecommendation: 'Correct the date of service before resubmitting.' });
    const result = await predictDenial(claim(PAST), [line(null), line(null)], soap, patient);
    expect(result.issues.find((i) => /future/i.test(i.category))).toBeUndefined();
    expect(result.issues.find((i) => i.category === 'Missing Data')).toBeUndefined();
    expect(result.overallRecommendation).not.toMatch(/correct the date of service/i);
  });

  it('(b) one past line plus an undated line on a future session date: the legitimate future finding is kept', async () => {
    modelReply.text = JSON.stringify({ riskScore: 85, riskLevel: 'high', additionalIssues: [legitimateFutureFinding], overallRecommendation: 'Hold until the visit occurs.' });
    const result = await predictDenial(claim(FUTURE), [line(PAST), line(null)], soap, patient);
    expect(result.issues.find((i) => /future/i.test(i.category))).toBeDefined();
    expect(result.issues.find((i) => i.category === 'Missing Data')).toBeUndefined();
    expect(result.riskScore).toBe(85);
  });
});
