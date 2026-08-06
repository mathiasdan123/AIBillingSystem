import * as OTPAuth from 'otpauth';
import crypto from 'crypto';

export function generateSecret(email: string): {
  secret: string;
  uri: string;
  backupCodes: string[];
} {
  const secret = new OTPAuth.Secret({ size: 20 });

  const totp = new OTPAuth.TOTP({
    issuer: 'TherapyBill',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  const uri = totp.toString();
  const backupCodes = generateBackupCodes();

  return { secret: secret.base32, uri, backupCodes };
}

export function verifyToken(secret: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: 'TherapyBill',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  // window: 2 => accept the current 30s step plus 2 steps either side (±60s).
  // window: 1 (±30s) was too tight in practice: ordinary phone clock drift put
  // real users' codes outside the window and locked them out of their own
  // accounts. ±60s is the common tolerance (RFC 6238 §5.2 explicitly allows a
  // small look-back/look-ahead for clock skew) and costs ~5 candidate codes per
  // attempt, which the per-account attempt limit still bounds tightly.
  const delta = totp.validate({ token, window: 2 });
  return delta !== null;
}

export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    codes.push(crypto.randomBytes(4).toString('hex'));
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export function verifyBackupCode(code: string, hashedCodes: string[]): boolean {
  const hashed = hashBackupCode(code);
  return hashedCodes.includes(hashed);
}
