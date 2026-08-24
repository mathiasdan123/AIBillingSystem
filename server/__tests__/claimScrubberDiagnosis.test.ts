/**
 * A claim with no diagnosis must NOT be submittable.
 *
 * Previously the scrubber only warned, and the submit routes substituted a
 * hardcoded 'F41.1' (generalized anxiety disorder) so the 837P would
 * validate — putting a fabricated psychiatric diagnosis on a real patient's
 * insurance record. The provider supplies the diagnosis; the system never
 * invents one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getClaim: vi.fn(),
    getPatient: vi.fn(),
    getPractice: vi.fn(),
    getClaimLineItems: vi.fn(),
    getInsurances: vi.fn(),
    getCptCodes: vi.fn(),
    getIcd10Codes: vi.fn(),
    getPatientEligibility: vi.fn(),
    getClaims: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
// The scrubber runs a duplicate-claim query directly against db; return empty.
vi.mock('../db', () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([]),
    then: (resolve: any) => resolve([]),
  };
  return { db: chain, getDb: () => chain };
});
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { scrubClaim } from '../services/claimScrubber';

const PRACTICE_ID = 1;
const CLAIM_ID = 100;

function lineItem(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    cptCodeId: 10,
    icd10CodeId: 20,
    dateOfService: '2026-08-01',
    amount: '150.00',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getClaim.mockResolvedValue({
    id: CLAIM_ID,
    practiceId: PRACTICE_ID,
    patientId: 5,
    insuranceId: 3,
    claimNumber: 'C-1',
  });
  mockStorage.getPatient.mockResolvedValue({
    id: 5,
    practiceId: PRACTICE_ID,
    firstName: 'Test',
    lastName: 'Patient',
    dateOfBirth: '2015-01-01',
    insuranceId: 'MEM1',
    policyNumber: 'P1',
  });
  mockStorage.getPractice.mockResolvedValue({
    id: PRACTICE_ID,
    name: 'Practice',
    npi: '1234567893',
    taxId: '123456789',
    address: '1 Main St, Newark, NJ 07102',
  });
  mockStorage.getInsurances.mockResolvedValue([{ id: 3, name: 'Aetna', payerId: '60054' }]);
  mockStorage.getCptCodes.mockResolvedValue([{ id: 10, code: '97110' }]);
  mockStorage.getIcd10Codes.mockResolvedValue([{ id: 20, code: 'M62.81' }]);
  mockStorage.getPatientEligibility.mockResolvedValue(null);
  mockStorage.getClaims.mockResolvedValue([]);
});

describe('scrubClaim — diagnosis is required', () => {
  it('FAILS a claim whose line item has no diagnosis linked', async () => {
    mockStorage.getClaimLineItems.mockResolvedValue([lineItem({ icd10CodeId: null })]);

    const result = await scrubClaim(CLAIM_ID, PRACTICE_ID);

    expect(result.passed).toBe(false);
    expect(result.errors.join(' ')).toMatch(/no diagnosis code/i);
    // It must be an error (blocks submission), not a warning.
    expect(result.warnings.join(' ')).not.toMatch(/no diagnosis code/i);
  });

  it('passes a claim whose line items carry a diagnosis', async () => {
    mockStorage.getClaimLineItems.mockResolvedValue([lineItem()]);

    const result = await scrubClaim(CLAIM_ID, PRACTICE_ID);

    expect(result.errors.join(' ')).not.toMatch(/no diagnosis code/i);
  });
});
