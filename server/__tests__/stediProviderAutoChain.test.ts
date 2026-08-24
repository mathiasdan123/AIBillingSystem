/**
 * Auto-chain: a practice's Stedi provider record is created automatically the
 * moment its provider profile is complete AND enrollment is authorized —
 * fired from profile save and from /authorize, so a new practice leaves
 * onboarding clearinghouse-ready without knowing Stedi exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage, mockEnsureProvider, mockGetKey } = vi.hoisted(() => ({
  mockStorage: { getPractice: vi.fn(), updatePractice: vi.fn() },
  mockEnsureProvider: vi.fn(),
  mockGetKey: vi.fn(),
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/stediEnrollmentService', () => ({
  ensureStediProvider: mockEnsureProvider,
}));
vi.mock('../services/stediService', () => ({
  getStediApiKeyForPractice: mockGetKey,
}));
vi.mock('../services/phiEncryptionService', () => ({
  decryptField: (v: string | null) => v,
}));
vi.mock('../replitAuth', () => ({ isAuthenticated: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/npiValidation', () => ({ isValidNpi: () => true, lookupNpi: vi.fn() }));
vi.mock('../services/errorSanitizer', () => ({ sanitizeExternalError: (e: any) => String(e) }));

import { tryCreateStediProvider } from '../routes/provider-profile';

const READY_PRACTICE = {
  id: 7,
  name: 'New Practice PT LLC',
  npi: '1234567893',
  npiType: 'organization',
  taxId: '123456789',
  taxonomyCode: '225X00000X',
  addressStreet: '1 Main St',
  addressCity: 'Newark',
  addressState: 'NJ',
  addressZip: '07102',
  billingContactName: 'Pat Biller',
  billingContactEmail: 'pat@newpractice.com',
  billingContactPhone: '9735551234',
  enrollmentNotificationEmail: 'pat@newpractice.com',
  ownerName: 'Dr. Owner',
  enrollmentAuthorizedAt: new Date('2026-08-24T00:00:00Z'),
  stediProviderId: null,
};

describe('tryCreateStediProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetKey.mockResolvedValue({ apiKey: 'key_test' });
  });

  it('creates and stores the provider record when profile is complete + authorized', async () => {
    mockStorage.getPractice.mockResolvedValue({ ...READY_PRACTICE });
    mockEnsureProvider.mockResolvedValue({ ok: true, providerId: 'prov_123' });
    mockStorage.updatePractice.mockResolvedValue({});

    const r = await tryCreateStediProvider(7);
    expect(r).toEqual({ attempted: true, ok: true, stediProviderId: 'prov_123' });
    expect(mockStorage.updatePractice).toHaveBeenCalledWith(7, { stediProviderId: 'prov_123' });
  });

  it('does nothing when a provider record already exists (idempotent)', async () => {
    mockStorage.getPractice.mockResolvedValue({ ...READY_PRACTICE, stediProviderId: 'prov_x' });
    const r = await tryCreateStediProvider(7);
    expect(r).toEqual({ attempted: false, reason: 'already_linked' });
    expect(mockEnsureProvider).not.toHaveBeenCalled();
  });

  it('does nothing when authorization has not been recorded', async () => {
    mockStorage.getPractice.mockResolvedValue({ ...READY_PRACTICE, enrollmentAuthorizedAt: null });
    const r = await tryCreateStediProvider(7);
    expect(r).toEqual({ attempted: false, reason: 'not_ready' });
    expect(mockEnsureProvider).not.toHaveBeenCalled();
  });

  it('does nothing when the profile is incomplete', async () => {
    mockStorage.getPractice.mockResolvedValue({ ...READY_PRACTICE, npi: null });
    const r = await tryCreateStediProvider(7);
    expect(r).toEqual({ attempted: false, reason: 'not_ready' });
    expect(mockEnsureProvider).not.toHaveBeenCalled();
  });

  it('reports failure without throwing when Stedi rejects (profile save must not fail)', async () => {
    mockStorage.getPractice.mockResolvedValue({ ...READY_PRACTICE });
    mockEnsureProvider.mockResolvedValue({ ok: false, error: 'duplicate NPI' });

    const r = await tryCreateStediProvider(7);
    expect(r.attempted).toBe(true);
    expect((r as any).ok).toBe(false);
    expect(mockStorage.updatePractice).not.toHaveBeenCalled();
  });

  it('reports failure without throwing when the Stedi call itself throws', async () => {
    mockStorage.getPractice.mockResolvedValue({ ...READY_PRACTICE });
    mockEnsureProvider.mockRejectedValue(new Error('network down'));

    const r = await tryCreateStediProvider(7);
    expect(r).toEqual({ attempted: true, ok: false, error: 'Stedi provider creation failed' });
  });
});
