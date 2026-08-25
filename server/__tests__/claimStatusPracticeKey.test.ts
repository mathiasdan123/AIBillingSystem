/**
 * A 276 status inquiry must go out under the OWNING practice's Stedi key.
 *
 * checkClaimStatus took `practiceId?: number`, and four of its five callers
 * omitted it — including the 4-hourly automatedClaimStatusCheck cron. With no
 * practiceId there is no per-practice key lookup, so getHeaders falls through
 * to the global STEDI_API_KEY and every tenant's claim status was inquired for
 * under the platform's credentials rather than their own.
 *
 * The parameter is now required, so the compiler catches a new omission. This
 * test covers what the type cannot: that the resolved key is actually the one
 * put on the wire, and that the practice's own key wins over the global.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage, fetchMock } = vi.hoisted(() => ({
  mockStorage: { getPractice: vi.fn() },
  fetchMock: vi.fn(),
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/phiEncryptionService', () => ({
  // The practice key is stored encrypted; decryption is not what this tests.
  decryptField: (v: string | null) => v,
  encryptField: (v: string | null) => v,
}));

import { checkClaimStatus } from '../services/stediService';

const REQUEST = {
  claimId: 'CLM-1',
  payer: { id: '22099' },
  provider: { npi: '1234567890', taxId: '12-3456789' },
  subscriber: {
    memberId: 'M1',
    firstName: 'Test',
    lastName: 'Patient',
    dateOfBirth: '1990-01-01',
  },
  dateOfService: '2026-08-25',
};

const authHeaderOf = (call: any): string => {
  const headers = call[1].headers as Record<string, string>;
  return headers.Authorization;
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STEDI_API_KEY = 'GLOBAL_PLATFORM_KEY';
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ claimStatus: [] }),
  });
});

describe('checkClaimStatus key resolution', () => {
  it("uses the practice's own key, not the global platform key", async () => {
    mockStorage.getPractice.mockResolvedValue({
      id: 7,
      sandboxMode: false,
      stediApiKey: 'PRACTICE_7_KEY',
    });

    await checkClaimStatus(REQUEST as never, 7);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const auth = authHeaderOf(fetchMock.mock.calls[0]);
    expect(auth).toContain('PRACTICE_7_KEY');
    // The regression: this is what went out for every practice before.
    expect(auth).not.toContain('GLOBAL_PLATFORM_KEY');
  });

  it('looks the key up for the practice it was told about', async () => {
    mockStorage.getPractice.mockResolvedValue({
      id: 7,
      sandboxMode: false,
      stediApiKey: 'PRACTICE_7_KEY',
    });

    await checkClaimStatus(REQUEST as never, 7);

    // Not "some practice was fetched" — the one owning the claim.
    expect(mockStorage.getPractice).toHaveBeenCalledWith(7);
  });
});
