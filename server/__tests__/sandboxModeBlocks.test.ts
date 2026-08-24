/**
 * Sandbox Mode must actually prevent real submissions.
 *
 * Settings tells a practice: "Claims are sent to a test environment. No real
 * submissions to insurance companies." That was false. sandboxMode resolved
 * to the SAME global production Stedi key, the returned isSandbox flag was
 * read nowhere, and the submit routes did not even pass practiceId — so
 * getHeaders fell back to the production key unconditionally. A practice that
 * believed it was testing would file real 837Ps to real payers under its own
 * NPI, damaging its own payer relationships.
 *
 * practices.sandboxMode defaults to TRUE, so this is the state every newly
 * onboarded practice starts in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: { getPractice: vi.fn() },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({ db: {}, getDb: () => ({}) }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/phiEncryptionService', () => ({
  decryptField: (v: any) => v,
  encryptField: (v: any) => v,
}));

const sampleClaim = {
  claimId: 'CLM001',
  totalAmount: 150.0,
  placeOfService: '11',
  dateOfService: '2026-03-01',
  patient: {
    firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1990-05-15', gender: 'F' as const,
    address: { line1: '1 Main St', city: 'Newark', state: 'NJ', zip: '07102' },
    memberId: 'MEM123',
  },
  provider: {
    npi: '1234567890', taxId: '123456789', organizationName: 'Test Practice',
    address: { line1: '1 Main St', city: 'Newark', state: 'NJ', zip: '07102' },
  },
  payer: { id: '60054', name: 'Aetna' },
  serviceLines: [{ procedureCode: '90837', diagnosisCodes: ['F41.1'], amount: 150.0, units: 1, dateOfService: '2026-03-01' }],
  diagnosisCodes: ['F41.1'],
} as any;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.STEDI_API_KEY = 'live_production_key';
});
afterEach(() => vi.unstubAllGlobals());

describe('submitClaim honors Sandbox Mode', () => {
  it('does NOT transmit for a practice in sandbox mode', async () => {
    mockStorage.getPractice.mockResolvedValue({ id: 2, sandboxMode: true });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { submitClaim } = await import('../services/stediService');
    const result = await submitClaim(sampleClaim, 2);

    // The decisive assertion: no HTTP call to the clearinghouse at all.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.errors?.join(' ')).toMatch(/sandbox mode/i);
  });

  it('refuses when no practice context is supplied rather than using the global production key', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { submitClaim } = await import('../services/stediService');
    const result = await submitClaim(sampleClaim);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it('DOES transmit for a practice in live mode', async () => {
    mockStorage.getPractice.mockResolvedValue({ id: 1, sandboxMode: false });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ claimId: 'STEDI-1' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { submitClaim } = await import('../services/stediService');
    const result = await submitClaim(sampleClaim, 1);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.status).toBe('accepted');
  });
});
