/**
 * Tests for how the Stedi adapter treats 271 responses that carry AAA errors
 * (server/payer-integrations/adapters/payers/StediAdapter.ts).
 *
 * Regression cover for 2026-08-12: a payer rejected an eligibility request
 * outright (AAA 43, "Invalid/Missing Provider Identification") and the empty
 * response was parsed anyway → status 'unknown' → collapsed downstream to
 * 'inactive' → shown to the front desk as "Patient coverage has been
 * terminated". A processing error must never masquerade as a coverage verdict.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { StediAdapter, StediPayerRejectionError } from '../payer-integrations/adapters/payers/StediAdapter';

const PARAMS = {
  providerNpi: '1234567890',
  providerName: 'Test Practice',
  memberFirstName: 'Pat',
  memberLastName: 'Example',
  memberDob: '1990-01-01',
  memberId: 'M123',
  payerName: 'Aetna',
};

function stubStediResponse(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    })),
  );
}

describe('StediAdapter AAA error handling', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('throws StediPayerRejectionError when the payer rejects with no benefits', async () => {
    // The exact production shape from 2026-08-12.
    stubStediResponse({
      controlNumber: '1',
      errors: [
        {
          field: 'AAA',
          code: '43',
          description: 'Invalid/Missing Provider Identification',
          followupAction: 'Please Correct and Resubmit',
        },
      ],
    });

    const adapter = new StediAdapter('test-key');
    await expect(adapter.checkEligibility(PARAMS)).rejects.toThrow(StediPayerRejectionError);
    await expect(adapter.checkEligibility(PARAMS)).rejects.toThrow(
      /Invalid\/Missing Provider Identification — Please Correct and Resubmit/,
    );
  });

  it('parses on when errors arrive alongside real benefits (payer warnings)', async () => {
    stubStediResponse({
      controlNumber: '2',
      errors: [{ field: 'AAA', code: '33', description: 'Input Errors' }],
      benefitsInformation: [{ code: '1', informationCode: 'Active Coverage' }],
    });

    const adapter = new StediAdapter('test-key');
    const result = await adapter.checkEligibility(PARAMS);
    expect(result.eligibility.status).toBe('active');
    expect(result.eligibility.isEligible).toBe(true);
  });

  it('reports a genuine inactive verdict as inactive', async () => {
    stubStediResponse({
      controlNumber: '3',
      benefitsInformation: [{ code: '6', informationCode: 'Inactive' }],
    });

    const adapter = new StediAdapter('test-key');
    const result = await adapter.checkEligibility(PARAMS);
    expect(result.eligibility.status).toBe('inactive');
    expect(result.eligibility.isEligible).toBe(false);
  });

  it("keeps 'unknown' distinct from 'inactive' when benefits assert neither", async () => {
    // Benefits present (so no rejection) but neither active nor inactive —
    // e.g. only deductible rows. The verdict is unknown, not terminated.
    stubStediResponse({
      controlNumber: '4',
      benefitsInformation: [{ code: 'C', name: 'Deductible' }],
    });

    const adapter = new StediAdapter('test-key');
    const result = await adapter.checkEligibility(PARAMS);
    expect(result.eligibility.status).toBe('unknown');
    expect(result.eligibility.isEligible).toBe(false);
  });
});
