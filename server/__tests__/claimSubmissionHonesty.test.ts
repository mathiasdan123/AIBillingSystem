/**
 * A claim is only "submitted" if the clearinghouse actually accepted it.
 *
 * Two failures used to be reported as success:
 *  1. stediService treated ANY 2xx as accepted without reading the body, so
 *     an edit-level rejection returned 200 and became status 'accepted'.
 *  2. The submit routes wrote status 'submitted' and answered "submitted
 *     successfully" even when clearinghouseResult.success was false.
 *
 * Net effect: claims that were never accepted looked filed, and surfaced only
 * after the timely-filing window closed — silent revenue loss.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const { mockStorage } = vi.hoisted(() => ({
  mockStorage: { getPractice: vi.fn(), getPracticeStediConfig: vi.fn() },
}));
vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/phiEncryptionService', () => ({
  decryptField: (v: any) => v,
  encryptField: (v: any) => v,
}));
vi.mock('../db', () => ({ db: {}, getDb: () => ({}) }));

const sampleClaim = {
  claimId: 'CLM001',
  totalAmount: 150.0,
  placeOfService: '11',
  dateOfService: '2026-03-01',
  patient: {
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-05-15',
    gender: 'F' as const,
    address: { line1: '123 Main St', city: 'Springfield', state: 'IL', zip: '62701' },
    memberId: 'MEM123',
  },
  provider: {
    npi: '1234567890',
    taxId: '123456789',
    organizationName: 'Test Practice',
    address: { line1: '456 Oak Ave', city: 'Springfield', state: 'IL', zip: '62702' },
  },
  payer: { id: '60054', name: 'Aetna' },
  serviceLines: [
    {
      procedureCode: '90837',
      diagnosisCodes: ['F41.1'],
      amount: 150.0,
      units: 1,
      dateOfService: '2026-03-01',
    },
  ],
  diagnosisCodes: ['F41.1'],
} as any;

function mockFetchJson(ok: boolean, body: any) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: vi.fn().mockResolvedValue(body) }));
}

beforeEach(() => {
  vi.resetModules();
  process.env.STEDI_API_KEY = 'test_key';
  // Live mode: sandbox mode legitimately refuses to transmit, which would
  // short-circuit these response-parsing tests before any fetch happens.
  mockStorage.getPractice.mockResolvedValue({ id: 1, sandboxMode: false });
});
afterEach(() => vi.unstubAllGlobals());

describe('submitClaim — a 2xx is not proof of acceptance', () => {
  it('treats a 200 carrying errors[] as rejected, not accepted', async () => {
    mockFetchJson(true, { claimId: 'STEDI-9', errors: ['Missing subscriber ID'] });
    const { submitClaim } = await import('../services/stediService');

    const result = await submitClaim(sampleClaim, 1);

    expect(result.success).toBe(false);
    expect(result.status).toBe('rejected');
    expect(result.errors).toContain('Missing subscriber ID');
  });

  it('treats a 200 whose status says rejected as rejected', async () => {
    mockFetchJson(true, { claimId: 'STEDI-9', status: 'REJECTED' });
    const { submitClaim } = await import('../services/stediService');

    const result = await submitClaim(sampleClaim, 1);

    expect(result.success).toBe(false);
    expect(result.status).toBe('rejected');
  });

  it('does not claim acceptance when the response carries no claim identifier', async () => {
    mockFetchJson(true, {});
    const { submitClaim } = await import('../services/stediService');

    const result = await submitClaim(sampleClaim, 1);

    expect(result.success).toBe(false);
    expect(result.status).toBe('pending');
    expect(result.errors?.join(' ')).toMatch(/could not be confirmed/i);
  });

  /**
   * The validation endpoint deliberately creates nothing, so it has no
   * identifier to return. Applying the guard above to a dry run reported a
   * clean validation as a failed submission and told the biller to check the
   * portal for a duplicate — of a claim that was never transmitted.
   */
  it('treats a clean dry run with no identifier as a PASS, not an unconfirmed submission', async () => {
    mockFetchJson(true, {});
    const { submitClaim } = await import('../services/stediService');

    const result = await submitClaim(sampleClaim, 1, { testMode: true });

    expect(result.success).toBe(true);
    expect(result.errors ?? []).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/duplicate/i);
  });

  it('still reports a dry run that the clearinghouse actually rejected', async () => {
    mockFetchJson(true, { errors: ['Missing subscriber ID'] });
    const { submitClaim } = await import('../services/stediService');

    const result = await submitClaim(sampleClaim, 1, { testMode: true });

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Missing subscriber ID');
  });

  it('still accepts a clean success response', async () => {
    mockFetchJson(true, { claimId: 'STEDI-001' });
    const { submitClaim } = await import('../services/stediService');

    const result = await submitClaim(sampleClaim, 1);

    expect(result.success).toBe(true);
    expect(result.status).toBe('accepted');
    expect(result.stediClaimId).toBe('STEDI-001');
  });
});
