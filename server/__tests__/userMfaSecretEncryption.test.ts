/**
 * GET /api/auth/user no longer leaks mfaSecret (PR #404), but the secret
 * itself was still written and read back as a raw, unencrypted TOTP seed
 * despite the schema comment claiming encryption. This covers the fix:
 * storage.updateUserMfa() now encrypts mfaSecret the same way every other
 * user PHI field is encrypted (server/services/phiEncryptionService.ts),
 * and storage.getUser() decrypts it back transparently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_KEY_HEX = 'b'.repeat(64);

// In-memory stand-in for the users table row the fluent query builder below
// reads from / writes to, so update() can be observed by a later select().
let storedRow: Record<string, any> = {};

vi.mock('../db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => (storedRow.id ? [storedRow] : []),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, any>) => ({
        where: () => ({
          returning: async () => {
            storedRow = { ...storedRow, ...patch };
            return [storedRow];
          },
        }),
      }),
    }),
  },
}));

describe('user mfaSecret encryption at rest', () => {
  beforeEach(() => {
    process.env.PHI_ENCRYPTION_KEY = TEST_KEY_HEX;
    storedRow = { id: 'u1', email: 'therapist@example.com', mfaEnabled: false };
  });

  it('updateUserMfa stores mfaSecret encrypted, not as the raw TOTP seed', async () => {
    const { updateUserMfa } = await import('../storage/users');
    await updateUserMfa('u1', { mfaSecret: 'JBSWY3DPEHPK3PXP', mfaBackupCodes: ['hash1'] });

    // The row as actually persisted (bypassing decryptUserRecord) must not
    // contain the plaintext seed anywhere.
    expect(JSON.stringify(storedRow)).not.toContain('JBSWY3DPEHPK3PXP');
    expect(storedRow.mfaSecret).toMatchObject({ ciphertext: expect.any(String), iv: expect.any(String), tag: expect.any(String) });
    // Backup codes are already one-way hashed — left untouched.
    expect(storedRow.mfaBackupCodes).toEqual(['hash1']);
  });

  it('getUser decrypts mfaSecret back to the original TOTP seed', async () => {
    const { updateUserMfa, getUser } = await import('../storage/users');
    await updateUserMfa('u1', { mfaSecret: 'JBSWY3DPEHPK3PXP' });

    const user = await getUser('u1');
    expect(user!.mfaSecret).toBe('JBSWY3DPEHPK3PXP');
  });

  it('getUser tolerates a legacy plaintext mfaSecret written before this fix', async () => {
    storedRow = { id: 'u1', mfaEnabled: true, mfaSecret: 'LEGACYSECRETBASE32' };
    const { getUser } = await import('../storage/users');

    const user = await getUser('u1');
    expect(user!.mfaSecret).toBe('LEGACYSECRETBASE32');
  });
});
