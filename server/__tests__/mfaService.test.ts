/**
 * Tests for server/services/mfaService.ts
 *
 * Focus: the TOTP acceptance window. This is a real-user-impact setting —
 * a window that is too tight rejects codes from phones whose clock has drifted
 * by a few tens of seconds, which reads to the user as "MFA is broken" and
 * burns their backup codes.
 */

import { describe, it, expect } from 'vitest';
import * as OTPAuth from 'otpauth';
import { generateSecret, verifyToken, generateBackupCodes, hashBackupCode, verifyBackupCode } from '../services/mfaService';

const PERIOD_MS = 30_000;

/** Produce the code a correctly-configured authenticator would show at `atMs`. */
function tokenAt(secret: string, atMs: number): string {
  const totp = new OTPAuth.TOTP({
    issuer: 'TherapyBill',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.generate({ timestamp: atMs });
}

describe('mfaService TOTP verification', () => {
  const { secret } = generateSecret('user@example.com');

  it('accepts the current code', () => {
    expect(verifyToken(secret, tokenAt(secret, Date.now()))).toBe(true);
  });

  // Offsets are exact multiples of the 30s period, so each maps to a fixed
  // step delta regardless of where "now" sits inside the current step —
  // these cases cannot flake on timing.
  it.each([
    ['60s slow', -2 * PERIOD_MS],
    ['30s slow', -1 * PERIOD_MS],
    ['30s fast', 1 * PERIOD_MS],
    ['60s fast', 2 * PERIOD_MS],
  ])('accepts a code from a phone whose clock is %s', (_label, offsetMs) => {
    expect(verifyToken(secret, tokenAt(secret, Date.now() + offsetMs))).toBe(true);
  });

  it.each([
    ['90s slow', -3 * PERIOD_MS],
    ['90s fast', 3 * PERIOD_MS],
  ])('still rejects a code from a phone whose clock is %s', (_label, offsetMs) => {
    expect(verifyToken(secret, tokenAt(secret, Date.now() + offsetMs))).toBe(false);
  });

  it('rejects a wrong code and a code from a different secret', () => {
    const { secret: otherSecret } = generateSecret('someone-else@example.com');
    expect(verifyToken(secret, '000000')).toBe(false);
    expect(verifyToken(secret, tokenAt(otherSecret, Date.now()))).toBe(false);
  });
});

describe('mfaService backup codes', () => {
  it('issues 10 distinct codes and verifies them against their hashes', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);

    const hashed = codes.map(hashBackupCode);
    expect(verifyBackupCode(codes[0], hashed)).toBe(true);
    expect(verifyBackupCode('not-a-real-code', hashed)).toBe(false);
  });

  it('does not store the raw code in its hash', () => {
    const [code] = generateBackupCodes();
    expect(hashBackupCode(code)).not.toContain(code);
  });
});
