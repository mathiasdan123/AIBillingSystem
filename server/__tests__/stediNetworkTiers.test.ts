/**
 * Tests for network-tier separation in 271 parsing
 * (parseNetworkTiers / networkIndicatorOf in server/services/stediService.ts
 * and their use by StediAdapter.parseBenefits).
 *
 * Production finding 2026-08-18: both parsers checked
 * `benefit.inPlanNetworkIndicator !== 'N'`, but Stedi puts the X12 EB12 code
 * in `inPlanNetworkIndicatorCode` — `inPlanNetworkIndicator` holds the word
 * "Yes"/"No", which never equals 'N'. Every out-of-network row leaked into
 * the "in-network" summary: a real Horizon 271 displayed the OON family
 * deductible ($10,000) as THE deductible next to the in-network copay ($30)
 * and the OON coinsurance (20%).
 *
 * The fixtures below mirror that Horizon PPO response's shape.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseNetworkTiers, networkIndicatorOf } from '../services/stediService';
import { StediAdapter } from '../payer-integrations/adapters/payers/StediAdapter';

/** Rows shaped like the real Horizon BCBS NJ PPO 271 from 2026-08-18. */
function horizonBenefits() {
  return [
    { code: '1', name: 'Active Coverage', serviceTypeCodes: ['30'] },
    // In-network tier (EB12 code 'Y', human word "Yes")
    {
      code: 'C', name: 'Deductible', serviceTypeCodes: ['30'],
      inPlanNetworkIndicatorCode: 'Y', inPlanNetworkIndicator: 'Yes',
      benefitAmount: '4000', coverageLevelCode: 'FAM', timeQualifierCode: '22',
    },
    {
      code: 'C', name: 'Deductible', serviceTypeCodes: ['30'],
      inPlanNetworkIndicatorCode: 'Y', inPlanNetworkIndicator: 'Yes',
      benefitAmount: '0', coverageLevelCode: 'FAM', timeQualifierCode: '29',
    },
    {
      code: 'G', name: 'Out of Pocket (Stop Loss)', serviceTypeCodes: ['30'],
      inPlanNetworkIndicatorCode: 'Y', inPlanNetworkIndicator: 'Yes',
      benefitAmount: '14400', coverageLevelCode: 'FAM', timeQualifierCode: '22',
    },
    {
      code: 'B', name: 'Co-Payment', serviceTypeCodes: ['98'],
      inPlanNetworkIndicatorCode: 'Y', inPlanNetworkIndicator: 'Yes',
      benefitAmount: '30', coverageLevelCode: 'IND', timeQualifierCode: '27',
    },
    // Out-of-network tier (EB12 code 'N', human word "No")
    {
      code: 'C', name: 'Deductible', serviceTypeCodes: ['30'],
      inPlanNetworkIndicatorCode: 'N', inPlanNetworkIndicator: 'No',
      benefitAmount: '10000', coverageLevelCode: 'FAM', timeQualifierCode: '22',
    },
    {
      code: 'G', name: 'Out of Pocket (Stop Loss)', serviceTypeCodes: ['30'],
      inPlanNetworkIndicatorCode: 'N', inPlanNetworkIndicator: 'No',
      benefitAmount: '28800', coverageLevelCode: 'FAM', timeQualifierCode: '22',
    },
    {
      code: 'G', name: 'Out of Pocket (Stop Loss)', serviceTypeCodes: ['30'],
      inPlanNetworkIndicatorCode: 'N', inPlanNetworkIndicator: 'No',
      benefitAmount: '12577.04', coverageLevelCode: 'FAM', timeQualifierCode: '29',
    },
    {
      code: 'A', name: 'Co-Insurance', serviceTypeCodes: ['33'],
      inPlanNetworkIndicatorCode: 'N', inPlanNetworkIndicator: 'No',
      benefitPercent: '0.2', coverageLevelCode: 'IND',
    },
  ];
}

describe('networkIndicatorOf', () => {
  it('reads the EB12 code field', () => {
    expect(networkIndicatorOf({ inPlanNetworkIndicatorCode: 'N' })).toBe('N');
    expect(networkIndicatorOf({ inPlanNetworkIndicatorCode: 'Y' })).toBe('Y');
    expect(networkIndicatorOf({ inPlanNetworkIndicatorCode: 'W' })).toBe('W');
  });

  it('falls back to the human-readable word (the field the old check misread)', () => {
    expect(networkIndicatorOf({ inPlanNetworkIndicator: 'No' })).toBe('N');
    expect(networkIndicatorOf({ inPlanNetworkIndicator: 'Yes' })).toBe('Y');
    expect(networkIndicatorOf({ inPlanNetworkIndicator: 'Not Applicable' })).toBe('W');
  });

  it('returns empty for unlabeled rows', () => {
    expect(networkIndicatorOf({})).toBe('');
    expect(networkIndicatorOf({ inPlanNetworkIndicator: '' })).toBe('');
  });
});

describe('parseNetworkTiers', () => {
  it('splits the Horizon-shaped 271 into correct tiers', () => {
    const tiers = parseNetworkTiers(horizonBenefits());

    // In-network: $30 copay, $4,000 family deductible fully met, $14,400 OOP
    expect(tiers.inNetwork.copay).toBe(30);
    expect(tiers.inNetwork.deductible.family).toBe(4000);
    expect(tiers.inNetwork.deductible.familyMet).toBe(4000); // 4000 total − 0 remaining
    expect(tiers.inNetwork.outOfPocketMax.family).toBe(14400);
    expect(tiers.inNetwork.coinsurance).toBeUndefined();

    // Out-of-network: no copay, 20% coinsurance, $10,000 family deductible,
    // $28,800 OOP with $12,577.04 remaining
    expect(tiers.outOfNetwork.copay).toBeUndefined();
    expect(tiers.outOfNetwork.coinsurance).toBe(20); // normalized from 0.2
    expect(tiers.outOfNetwork.deductible.family).toBe(10000);
    expect(tiers.outOfNetwork.outOfPocketMax.family).toBe(28800);
    expect(tiers.outOfNetwork.outOfPocketMax.familyMet).toBeCloseTo(28800 - 12577.04, 2);
    expect(tiers.hasOutOfNetworkBenefits).toBe(true);
  });

  it('reports no OON benefits when the payer returns only in-network rows (HMO/EPO shape)', () => {
    const tiers = parseNetworkTiers([
      { code: '1', name: 'Active Coverage', serviceTypeCodes: ['30'] },
      {
        code: 'B', inPlanNetworkIndicatorCode: 'Y', benefitAmount: '25',
        serviceTypeCodes: ['98'],
      },
    ]);
    expect(tiers.inNetwork.copay).toBe(25);
    expect(tiers.hasOutOfNetworkBenefits).toBe(false);
  });

  it('leaves met undefined when the payer sends a remaining row without a total', () => {
    const tiers = parseNetworkTiers([
      {
        code: 'C', inPlanNetworkIndicatorCode: 'Y', benefitAmount: '500',
        coverageLevelCode: 'IND', timeQualifierCode: '29',
      },
    ]);
    expect(tiers.inNetwork.deductible.individual).toBeUndefined();
    expect(tiers.inNetwork.deductible.individualMet).toBeUndefined();
  });

  it('treats unlabeled rows as in-network (legacy default)', () => {
    const tiers = parseNetworkTiers([
      { code: 'B', benefitAmount: '15', serviceTypeCodes: ['98'] },
    ]);
    expect(tiers.inNetwork.copay).toBe(15);
    expect(tiers.hasOutOfNetworkBenefits).toBe(false);
  });
});

describe('StediAdapter tier separation', () => {
  function mock271(benefitsInformation: any[]) {
    return {
      controlNumber: '123456789',
      planStatus: [{ statusCode: '1', status: 'Active Coverage', serviceTypeCodes: ['30'] }],
      planInformation: {},
      subscriber: { memberId: '3123456789', firstName: 'Test', lastName: 'Member' },
      benefitsInformation,
    };
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

  it('keeps OON rows out of the flat in-network summary (the 2026-08-18 leak)', async () => {
    const result = await runCheck(horizonBenefits());

    // Flat fields are the in-network numbers only. Before the fix, the
    // "No" !== 'N' bug let the OON family deductible ($10,000) and OON
    // coinsurance (20%) overwrite these.
    expect(result.benefits.copay).toBe(30);
    expect(result.benefits.coinsurance).toBe(0); // no in-network coinsurance row
    expect(result.benefits.deductible.family).toBe(4000);
    expect(result.benefits.deductible.individual).toBe(0); // Horizon sent FAM rows only
    expect(result.benefits.outOfPocketMax.family).toBe(14400);
  });

  it('exposes both tiers via networkTiers', async () => {
    const result = await runCheck(horizonBenefits());
    const tiers = result.benefits.networkTiers!;
    expect(tiers.outOfNetwork.coinsurance).toBe(20);
    expect(tiers.outOfNetwork.deductible.family).toBe(10000);
    expect(tiers.inNetwork.copay).toBe(30);
    expect(tiers.hasOutOfNetworkBenefits).toBe(true);
  });
});
