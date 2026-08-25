/**
 * Claim dry run — rehearsing an 837P without filing it.
 *
 * `usageIndicator` did not appear anywhere in this codebase. Stedi's rule is
 * that "all API claim submissions are sent as production claims unless you
 * explicitly designate them as test data", so every submission this system
 * could make was a real claim to a real payer. There was no way to rehearse
 * one — which mattered enormously, because the claims code path had never once
 * succeeded against Stedi (the endpoint 404'd silently until it was
 * corrected) and the first claim a practice ever filed was also the first test
 * of that fix.
 *
 * 'T' routes the claim to Stedi's test clearinghouse, which returns a 277CA
 * and never forwards to the payer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchMock, mockStorage } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  mockStorage: { getPractice: vi.fn() },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/phiEncryptionService', () => ({
  decryptField: (v: any) => v,
  encryptField: (v: any) => v,
}));

import { build837P, submitClaim } from '../services/stediService';

// Shaped to the real ClaimSubmission interface, so build837P exercises the
// same code path a genuine submission takes.
const CLAIM: any = {
  claimId: 'CLM-1',
  totalAmount: 250,
  placeOfService: '11',
  dateOfService: '2026-08-12',
  patient: {
    firstName: 'Eliyahu',
    lastName: 'Stein',
    dateOfBirth: '2015-04-02',
    gender: 'M',
    address: { line1: '1 Main St', city: 'Lakewood', state: 'NJ', zip: '08701' },
    memberId: 'M1',
  },
  provider: {
    npi: '1234567890',
    taxId: '12-3456789',
    organizationName: 'Wonderkids',
    address: { line1: '2 Clinic Way', city: 'Lakewood', state: 'NJ', zip: '08701' },
  },
  payer: { id: '22099', name: 'Horizon BCBS NJ' },
  serviceLines: [
    {
      procedureCode: '97153',
      diagnosisCodes: ['F80.2'],
      amount: 250,
      units: 1,
      dateOfService: '2026-08-12',
    },
  ],
  diagnosisCodes: ['F80.2'],
};

const bodyOf = (call: any) => JSON.parse(call[1].body);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STEDI_API_KEY = 'GLOBAL_KEY';
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ claimReference: {} }) });
  mockStorage.getPractice.mockResolvedValue({ id: 1, sandboxMode: false, stediApiKey: 'K' });
});

describe('build837P usageIndicator', () => {
  it("marks a real submission as production ('P')", () => {
    expect(build837P(CLAIM).usageIndicator).toBe('P');
  });

  it("marks a dry run as test data ('T')", () => {
    // Without this the "test" would be transmitted to the payer as a genuine
    // claim — the exact opposite of what the caller asked for.
    expect(build837P(CLAIM, true).usageIndicator).toBe('T');
  });

  it('defaults to production when the flag is omitted', () => {
    // Stedi's own default. Being explicit means a future caller cannot get a
    // real submission by forgetting an argument.
    expect(build837P(CLAIM).usageIndicator).toBe('P');
  });
});

describe('submitClaim test mode', () => {
  it('sends usageIndicator T on the wire for a dry run', async () => {
    await submitClaim(CLAIM, 1, { testMode: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0]).usageIndicator).toBe('T');
  });

  it('sends usageIndicator P for a real submission', async () => {
    await submitClaim(CLAIM, 1);

    expect(bodyOf(fetchMock.mock.calls[0]).usageIndicator).toBe('P');
  });

  it('lets a SANDBOX practice run a dry run', async () => {
    mockStorage.getPractice.mockResolvedValue({ id: 1, sandboxMode: true });

    const result = await submitClaim(CLAIM, 1, { testMode: true });

    // A test claim never reaches the payer, so refusing it would leave sandbox
    // mode with no way to test anything — the opposite of its purpose. What
    // matters is that the SANDBOX GUARD did not block it: the request went out
    // and was marked test data. Whether the (mocked) clearinghouse then
    // accepted the body is a different question and not what this pins.
    expect(result.errors?.join(' ') ?? '').not.toMatch(/sandbox mode/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0]).usageIndicator).toBe('T');
  });

  it('still refuses a REAL submission from a sandbox practice', async () => {
    mockStorage.getPractice.mockResolvedValue({ id: 1, sandboxMode: true });

    const result = await submitClaim(CLAIM, 1);

    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toMatch(/sandbox mode/i);
    // Nothing may go over the wire.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a real submission with no practice context', async () => {
    const result = await submitClaim(CLAIM, undefined);

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
