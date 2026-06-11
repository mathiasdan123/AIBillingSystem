/**
 * Compliance regression test: the reimbursement code/unit selection must follow
 * the documented clinical order, NEVER reimbursement rate ("accuracy not
 * maximization" per CLAUDE.md). These tests deliberately make the clinically
 * PRIMARY code pay LESS than its alternative, and assert the primary is still
 * chosen and leftover units still land on the primary/first intervention.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getCptCodes: vi.fn(),
    getInsuranceRateByCode: vi.fn(),
  },
}));
vi.mock('../storage', () => ({ storage: mockStorage }));

import { getOptimalCodeForIntervention, optimizeSessionCodes } from '../services/reimbursementOptimizer';

// Rates where the alternative code (97530) pays MORE than every primary code,
// so a rate-maximizing impl would prefer 97530 — proving order, not rate, wins.
const RATES: Record<string, string> = {
  '97533': '40.00', // sensory_processing primary (low)
  '97110': '40.00', // therapeutic_exercise primary (low)
  '97530': '99.00', // the lucrative alternative
};

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getCptCodes.mockResolvedValue(
    ['97533', '97110', '97530', '97112'].map((code, i) => ({ id: i + 1, code })),
  );
  mockStorage.getInsuranceRateByCode.mockImplementation(async (_p: string, code: string) =>
    RATES[code] ? { inNetworkRate: RATES[code] } : null,
  );
});

describe('reimbursement selection follows clinical order, not rate', () => {
  it('getOptimalCodeForIntervention picks the primary code even when an alternative pays more', async () => {
    const result = await getOptimalCodeForIntervention('therapeutic_exercise', 'TestPayer');
    // category codes are ["97110", "97530"]; 97530 pays >2x but 97110 is primary.
    expect(result?.recommendedCode).toBe('97110');
    expect(result?.alternativeCodes.map((a) => a.code)).toContain('97530');
  });

  it('optimizeSessionCodes keeps documented intervention order and sends leftover units to the primary', async () => {
    // 75 min = 5 units across 2 interventions, sensory documented FIRST.
    const rec = await optimizeSessionCodes(75, ['sensory_processing', 'therapeutic_exercise'], 'TestPayer');
    expect(rec.totalUnits).toBe(5);
    // First line item is the first-documented intervention's primary code...
    expect(rec.lineItems[0].code).toBe('97533');
    // ...and the leftover unit (5 - floor(5/2)*2 = 1) lands there, not on a higher payer.
    expect(rec.lineItems[0].units).toBe(3);
    // The rationale must not claim to maximize reimbursement.
    expect(rec.optimizationNotes.join(' ').toLowerCase()).not.toContain('highest-reimbursing');
  });
});
