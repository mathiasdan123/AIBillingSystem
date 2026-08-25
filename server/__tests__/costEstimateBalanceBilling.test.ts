/**
 * A patient cost estimate must not bill the contractual write-off.
 *
 * balanceBilling — the gap between the practice's rate and what the plan
 * allows — was added to patient responsibility unconditionally. For an
 * IN-NETWORK practice that gap is the discount the practice agreed to accept
 * in its payer contract, and billing it is prohibited. This number is shown
 * to the PATIENT in the portal, so an inflated one can make someone decline
 * care over a price that was never real.
 *
 * Same defect class as the patient-statement fix (#253), in a second place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatient: vi.fn(),
    getPractice: vi.fn(),
    getCptCodes: vi.fn(),
    getInsuranceRateByCode: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({ db: {}, getDb: () => ({}) }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { estimatePatientCost } from '../services/insuranceCostEstimator';

const CPT = [{ code: '97110', units: 1 }];

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getPatient.mockResolvedValue({
    id: 9, practiceId: 1, insuranceProvider: 'Horizon BCBS NJ',
  });
  mockStorage.getCptCodes.mockResolvedValue([{ id: 1, code: '97110', baseRate: '300.00' }]);
  // Plan allows 110 of a 300 charge; 20% coinsurance, no copay.
  mockStorage.getInsuranceRateByCode.mockResolvedValue({
    inNetworkRate: '110.00', coinsurancePercent: '20', copayAmount: null, deductibleApplies: false,
  });
});

describe('in-network', () => {
  beforeEach(() => {
    mockStorage.getPractice.mockResolvedValue({ id: 1, networkStatus: 'in_network' });
  });

  it('never charges the patient the write-off', async () => {
    const estimate = await estimatePatientCost(9, CPT, 300);

    expect(estimate.breakdown.balanceBilling).toBe(0);
    // Coinsurance only: 20% of the 110 allowed = 22.
    expect(estimate.patientResponsibility).toBeCloseTo(22, 2);
    // Emphatically NOT the old figure, which added the ~190 write-off.
    expect(estimate.patientResponsibility).toBeLessThan(100);
  });

  it('tells the patient the difference is written off', async () => {
    const estimate = await estimatePatientCost(9, CPT, 300);
    expect(estimate.notes.join(' ')).toMatch(/written off/i);
  });
});

describe('out-of-network', () => {
  beforeEach(() => {
    mockStorage.getPractice.mockResolvedValue({ id: 1, networkStatus: 'out_of_network' });
  });

  it('still bills the balance, which is what out-of-network means', async () => {
    const estimate = await estimatePatientCost(9, CPT, 300);

    expect(estimate.breakdown.balanceBilling).toBeGreaterThan(0);
    expect(estimate.patientResponsibility).toBeGreaterThan(estimate.breakdown.balanceBilling);
    expect(estimate.notes.join(' ')).toMatch(/out-of-network/i);
  });
});

describe('network status not set', () => {
  it('defaults to the safe answer — no balance billing', async () => {
    mockStorage.getPractice.mockResolvedValue({ id: 1, networkStatus: null });

    const estimate = await estimatePatientCost(9, CPT, 300);

    // Unknown must not mean "bill them for it".
    expect(estimate.breakdown.balanceBilling).toBe(0);
  });
});
