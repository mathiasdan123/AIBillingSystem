/**
 * Sandbox/live resolution must fail safe, and must agree with the UI.
 *
 * getStediApiKeyForPractice decided live mode with `!practice.sandboxMode`,
 * which treats NULL as live. But:
 *   - the column's DB default is true (shared/schema.ts), and
 *   - the Settings toggle renders it with `sandboxMode !== false`, i.e. NULL
 *     displays as Sandbox.
 *
 * So for any legacy practice row predating the column, the screen said
 * "Sandbox — nothing is transmitted" while the server said "live" and sent
 * real 837Ps to real payers under that practice's own NPI. That is precisely
 * the failure the submitClaim sandbox guard was added to prevent; it just had
 * a second door in.
 *
 * Live now requires an explicit false. Unset resolves to the state that cannot
 * accidentally file a claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({ mockStorage: { getPractice: vi.fn() } }));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/phiEncryptionService', () => ({
  decryptField: (v: string | null) => v,
  encryptField: (v: string | null) => v,
}));

import { getStediApiKeyForPractice } from '../services/stediService';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STEDI_API_KEY = 'GLOBAL_KEY';
});

describe('getStediApiKeyForPractice sandbox resolution', () => {
  it('treats an UNSET sandboxMode as sandbox, not live', async () => {
    mockStorage.getPractice.mockResolvedValue({ id: 1, sandboxMode: null });

    const { isSandbox } = await getStediApiKeyForPractice(1);

    // The regression: this returned false, so submitClaim's guard never fired
    // and a legacy practice transmitted real claims while its Settings screen
    // showed Sandbox.
    expect(isSandbox).toBe(true);
  });

  it('treats a MISSING sandboxMode column as sandbox', async () => {
    mockStorage.getPractice.mockResolvedValue({ id: 1 });

    expect((await getStediApiKeyForPractice(1)).isSandbox).toBe(true);
  });

  it('goes live only on an explicit false', async () => {
    mockStorage.getPractice.mockResolvedValue({
      id: 1,
      sandboxMode: false,
      stediApiKey: 'PRACTICE_KEY',
    });

    const result = await getStediApiKeyForPractice(1);

    expect(result.isSandbox).toBe(false);
    expect(result.apiKey).toBe('PRACTICE_KEY');
  });

  it('stays sandbox when explicitly true', async () => {
    mockStorage.getPractice.mockResolvedValue({ id: 1, sandboxMode: true });

    expect((await getStediApiKeyForPractice(1)).isSandbox).toBe(true);
  });

  it('falls back to sandbox when the practice cannot be loaded', async () => {
    mockStorage.getPractice.mockRejectedValue(new Error('db down'));

    // A lookup failure must not become permission to transmit.
    expect((await getStediApiKeyForPractice(1)).isSandbox).toBe(true);
  });

  it('agrees with how the Settings toggle renders the same value', async () => {
    // client/src/pages/settings.tsx: const isSandbox = practice?.sandboxMode !== false
    const uiSaysSandbox = (v: unknown) => v !== false;

    for (const value of [null, undefined, true, false]) {
      mockStorage.getPractice.mockResolvedValue({ id: 1, sandboxMode: value });
      const { isSandbox } = await getStediApiKeyForPractice(1);

      expect({ value, server: isSandbox }).toEqual({
        value,
        server: uiSaysSandbox(value),
      });
    }
  });
});
