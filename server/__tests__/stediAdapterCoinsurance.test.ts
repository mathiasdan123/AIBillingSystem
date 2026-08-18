/**
 * Regression test for the StediAdapter coinsurance path
 * (server/payer-integrations/adapters/payers/StediAdapter.ts).
 *
 * Production failure 2026-08-18: Horizon BCBS NJ answered an eligibility
 * check for a real patient with a clean ACTIVE 271 — copay, deductible,
 * out-of-pocket max — and coinsurance as the X12 fraction "0.2". The adapter
 * passed the fraction straight through, Postgres rejected the insert into the
 * integer `eligibility_checks.coinsurance` column
 * (`invalid input syntax for type integer: "0.2"`, 22P02), and the payer's
 * ACTIVE answer surfaced to the front desk as "Failed to check eligibility".
 *
 * stediService's own parsers were given normalizeCoinsurancePercent after the
 * identical crash on 2026-08-06 (see coinsuranceNormalization.test.ts); the
 * adapter — the path the interactive endpoints actually use — was missed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { StediAdapter } from '../payer-integrations/adapters/payers/StediAdapter';

function mock271(benefitsInformation: any[]) {
  return {
    controlNumber: '123456789',
    planStatus: [{ statusCode: '1', status: 'Active Coverage', serviceTypeCodes: ['30'] }],
    planInformation: {},
    subscriber: { memberId: '3123456789', firstName: 'Test', lastName: 'Member' },
    benefitsInformation,
  };
}

function coverageActive() {
  return { code: '1', name: 'Active Coverage', serviceTypeCodes: ['30'] };
}

async function runCheck(benefitsInformation: any[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mock271(benefitsInformation),
    }),
  );
  const adapter = new StediAdapter('test-key');
  return adapter.checkEligibility({
    providerNpi: '1023896321',
    providerName: 'Test Practice',
    memberFirstName: 'Test',
    memberLastName: 'Member',
    memberDob: '1990-01-01',
    memberId: '3123456789',
    payerName: 'Horizon BCBS NJ',
    tradingPartnerServiceId: '22099',
    practiceSpecialty: 'OT',
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StediAdapter coinsurance normalization', () => {
  it('converts the X12 fraction to a whole percentage (the 2026-08-18 production payload)', async () => {
    const result = await runCheck([
      coverageActive(),
      { code: 'A', benefitPercent: '0.2', inPlanNetworkIndicator: 'Y' },
    ]);
    // 20, never 0.2 — the integer eligibility_checks.coinsurance column
    // rejects a fraction and the whole check is lost at the final insert.
    expect(result.benefits.coinsurance).toBe(20);
    expect(Number.isInteger(result.benefits.coinsurance)).toBe(true);
  });

  it('passes through payers that already send whole percentages', async () => {
    const result = await runCheck([
      coverageActive(),
      { code: 'A', benefitPercent: '20', inPlanNetworkIndicator: 'Y' },
    ]);
    expect(result.benefits.coinsurance).toBe(20);
  });

  it('always produces an integer for odd fractions', async () => {
    const result = await runCheck([
      coverageActive(),
      { code: 'A', benefitPercent: '0.333', inPlanNetworkIndicator: 'Y' },
    ]);
    expect(result.benefits.coinsurance).toBe(33);
  });
});
