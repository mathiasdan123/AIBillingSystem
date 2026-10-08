/**
 * Per-activity CPT pairing (Megan's ask, Kelli-approved with conditions):
 *
 *  - CONSERVATISM: an activity that doesn't clearly map to a more specific
 *    code is suggested as 97530 Therapeutic Activities ("sometimes insurance
 *    companies only reimburse for one type of code — Therapeutic Activity
 *    tends to be the best one"), flagged `source: 'default'` so the UI can
 *    surface it for review. Suggestions are never final.
 *
 *  - SINGLE SOURCE OF TRUTH: the aggregate billing-code output is re-derived
 *    from the per-activity pairings, so the Objective pairing and the
 *    generated codes can never contradict each other.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatient: vi.fn(),
    getCachedInsuranceData: vi.fn(async () => null),
    getActiveTreatmentPlan: vi.fn(async () => null),
    getPatientTreatmentPlans: vi.fn(async () => []),
    getTreatmentGoals: vi.fn(async () => []),
    getRecentSoapNotesForPatient: vi.fn(async () => []),
  },
}));
vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../utils/phiAiGuard', () => ({ assertPhiAiAllowed: vi.fn() }));
// Force the rule-based fallback path (no AI) so the conservatism and
// reconciliation behavior is deterministic end-to-end.
vi.mock('../services/aiProvider', () => ({
  isAiConfigured: () => false,
  createAiClient: vi.fn(),
  useBedrock: () => false,
}));

import {
  CONSERVATIVE_DEFAULT_CPT_CODE,
  normalizeActivityCptPairings,
  reconcileCptCodesWithPairings,
  type ActivityCptPairing,
} from '../../shared/activityCpt';
import { generateSoapNoteAndBilling } from '../services/aiSoapBillingService';

describe('normalizeActivityCptPairings — conservatism', () => {
  it('defaults an activity the AI skipped to 97530, flagged for review', () => {
    const pairings = normalizeActivityCptPairings(
      ['Platform Swing - Balance', 'Mystery Novel Activity'],
      [{ activity: 'Platform Swing - Balance', code: '97112', rationale: 'balance work' }],
    );
    expect(pairings).toHaveLength(2);
    expect(pairings[0]).toMatchObject({ activity: 'Platform Swing - Balance', code: '97112', source: 'ai' });
    expect(pairings[1]).toMatchObject({
      activity: 'Mystery Novel Activity',
      code: CONSERVATIVE_DEFAULT_CPT_CODE,
      name: 'Therapeutic Activities',
      source: 'default',
    });
  });

  it('defaults an invalid or non-CPT code to 97530', () => {
    const pairings = normalizeActivityCptPairings(
      ['Obstacle Course'],
      [{ activity: 'Obstacle Course', code: 'definitely-not-a-code' }],
    );
    expect(pairings[0]).toMatchObject({ code: '97530', source: 'default' });
  });

  it('drops AI entries for activities that were never documented', () => {
    const pairings = normalizeActivityCptPairings(
      ['Trampoline - Coordination'],
      [
        { activity: 'Trampoline - Coordination', code: '97112' },
        { activity: 'Undocumented Activity', code: '97533' },
      ],
    );
    expect(pairings).toHaveLength(1);
    expect(pairings.map((p) => p.activity)).toEqual(['Trampoline - Coordination']);
  });

  it('handles entirely missing AI output: every activity gets the conservative default', () => {
    const pairings = normalizeActivityCptPairings(['A', 'B'], undefined);
    expect(pairings.every((p) => p.code === '97530' && p.source === 'default')).toBe(true);
  });
});

describe('reconcileCptCodesWithPairings — single source of truth', () => {
  const pair = (activity: string, code: string): ActivityCptPairing => ({
    activity,
    code,
    name: code,
    rationale: 'r',
    source: 'ai',
  });

  it('rebuilds activitiesAssigned exactly from the pairings', () => {
    const result = reconcileCptCodesWithPairings(
      [pair('Swing', '97112'), pair('Obstacle', '97530'), pair('Putty', '97530')],
      [
        { code: '97112', name: 'Neuromuscular Re-education', units: 2, rationale: 'AI rationale', activitiesAssigned: ['Swing', 'Obstacle'] },
        { code: '97530', name: 'Therapeutic Activities', units: 1, rationale: 'TA rationale', activitiesAssigned: ['Putty'] },
      ],
      289,
      3,
    );
    const byCode = Object.fromEntries(result.map((c) => [c.code, c]));
    // 'Obstacle' moved to 97530 per the pairings — the aggregate follows.
    expect(byCode['97112'].activitiesAssigned).toEqual(['Swing']);
    expect(byCode['97530'].activitiesAssigned).toEqual(['Obstacle', 'Putty']);
    // Unit budget preserved, reimbursement follows units.
    expect(result.reduce((s, c) => s + c.units, 0)).toBe(3);
    expect(result.every((c) => c.reimbursement === c.units * 289)).toBe(true);
    // Surviving codes keep their AI clinical rationale.
    expect(byCode['97112'].rationale).toBe('AI rationale');
  });

  it('drops an aggregate code no activity is paired with anymore', () => {
    const result = reconcileCptCodesWithPairings(
      [pair('Swing', '97530'), pair('Obstacle', '97530')],
      [
        { code: '97112', units: 2, activitiesAssigned: ['Swing'] },
        { code: '97530', units: 1, activitiesAssigned: ['Obstacle'] },
      ],
      289,
      3,
    );
    expect(result.map((c) => c.code)).toEqual(['97530']);
    expect(result[0].units).toBe(3);
    expect(result[0].activitiesAssigned).toEqual(['Swing', 'Obstacle']);
  });

  it('adds an aggregate entry for a newly chosen code (therapist edit)', () => {
    const result = reconcileCptCodesWithPairings(
      [pair('Swing', '97112'), { ...pair('ADL dressing', '97535'), source: 'therapist' }],
      [{ code: '97112', units: 3, activitiesAssigned: ['Swing', 'ADL dressing'] }],
      289,
      3,
    );
    const codes = result.map((c) => c.code).sort();
    expect(codes).toEqual(['97112', '97535']);
    expect(result.reduce((s, c) => s + c.units, 0)).toBe(3);
    // Every billed code has at least one supporting activity and >= 1 unit.
    expect(result.every((c) => c.activitiesAssigned.length > 0 && c.units >= 1)).toBe(true);
  });
});

describe('generateSoapNoteAndBilling (rule-based fallback) — pairing conservatism and consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getPatient.mockResolvedValue({
      id: 7,
      practiceId: 1,
      firstName: 'Test',
      lastName: 'Child',
      dateOfBirth: '2019-03-01',
    });
  });

  const baseReq = {
    patientId: 7,
    practiceId: 1,
    mood: 'Cooperative',
    duration: 60,
    location: 'Clinic',
    assessment: {
      performance: 'Stable',
      assistance: 'Minimal Assist',
      strength: 'Adequate',
      motorPlanning: 'Mild Difficulty',
      sensoryRegulation: 'Needed Minimal Supports',
    },
    planNextSteps: 'Continue Current Goals',
  };

  it('suggests the conservative 97530 for an activity with no clear mapping', async () => {
    const result = await generateSoapNoteAndBilling({
      ...baseReq,
      activities: ['Completely Novel Custom Activity'],
    });
    expect(result.activityCptPairings).toHaveLength(1);
    expect(result.activityCptPairings[0]).toMatchObject({
      activity: 'Completely Novel Custom Activity',
      code: '97530',
      source: 'default',
    });
    expect(result.cptCodes.map((c) => c.code)).toEqual(['97530']);
  });

  it('keeps the Objective pairing and the billing output consistent', async () => {
    const result = await generateSoapNoteAndBilling({
      ...baseReq,
      activities: ['Platform Swing - Balance', 'Obstacle Course - Functional', 'Some Unmapped Thing'],
    });

    // Every documented activity has exactly one pairing.
    expect(result.activityCptPairings.map((p) => p.activity)).toEqual([
      'Platform Swing - Balance',
      'Obstacle Course - Functional',
      'Some Unmapped Thing',
    ]);

    // Each billed code's activitiesAssigned matches the pairings exactly.
    for (const code of result.cptCodes) {
      const pairedActivities = result.activityCptPairings
        .filter((p) => p.code === code.code)
        .map((p) => p.activity);
      expect(code.activitiesAssigned).toEqual(pairedActivities);
    }
    // And every pairing's code appears in the billing output (no orphans).
    const billedCodes = new Set(result.cptCodes.map((c) => c.code));
    for (const p of result.activityCptPairings) {
      expect(billedCodes.has(p.code)).toBe(true);
    }

    // Unit budget respected (60 min = 4 units) and timeBlocks mirror codes.
    expect(result.cptCodes.reduce((s, c) => s + c.units, 0)).toBe(4);
    expect(result.timeBlocks).toHaveLength(4);
  });
});
