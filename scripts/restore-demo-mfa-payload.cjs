/**
 * Restore demo-user-001's MFA enrollment after force-mfa-reenrollment wiped it.
 *
 * Background: force-mfa-reenrollment-payload.cjs resets mfa_enabled=false for
 * every currently-enrolled user to retire plaintext-era MFA secrets. It
 * correctly treated demo-user-001 as "currently enrolled" (it genuinely was)
 * and reset it along with the real users -- but the public "Try Free Demo"
 * flow (POST /api/demo-login, server/routes/auth.ts) depends on that account
 * already having mfaEnabled=true: it stamps the session as pre-verified
 * (mfaVerifiedAt/mfaUserId) so a visitor never has to complete a TOTP
 * challenge, but server/middleware/mfa-setup-required.ts's gate checks
 * dbUser.mfaEnabled directly, independent of that session stamp. See the
 * explicit comment in mfa-required.ts: "Real demo accounts have MFA
 * enrolled and don't need this [env-allowlist bypass]" -- the demo account
 * was always meant to have MFA enabled, just pre-verified per-session rather
 * than challenged.
 *
 * This generates a fresh TOTP secret (same otpauth call server/routes/auth.ts's
 * real /mfa/setup route uses) and encrypts it with the same AES-256-GCM
 * scheme as server/services/phiEncryptionService.ts's encryptField, keyed by
 * the same PHI_ENCRYPTION_KEY the app container already has -- replicated
 * inline because the production image has no tsx and the compiled
 * dist/index.js doesn't expose these as separately requireable functions.
 * Nobody ever authenticates with this secret (the demo-login bypass means
 * /mfa/verify is never hit for this account), but it keeps the row in a
 * valid, self-consistent state rather than mfaEnabled=true with a null
 * secret.
 *
 * Idempotent: a no-op if demo-user-001 already has mfaEnabled=true (e.g. a
 * second run after a partial failure).
 *
 * Runs in one transaction. DRY_RUN=1 in the environment rolls it back.
 */
const { Client } = require('pg');
const crypto = require('crypto');
const OTPAuth = require('otpauth');

function encryptField(plaintext) {
  const keyHex = process.env.PHI_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(keyHex)) {
    throw new Error('PHI_ENCRYPTION_KEY missing or malformed in this container');
  }
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return { ciphertext, iv: iv.toString('hex'), tag: tag.toString('hex') };
}

(async () => {
  const dryRun = process.env.DRY_RUN === '1';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id, mfa_enabled FROM users WHERE id = 'demo-user-001'`
    );
    if (!existing.rowCount) {
      throw new Error('demo-user-001 not found -- refusing to proceed.');
    }
    if (existing.rows[0].mfa_enabled) {
      console.log('demo-user-001 already has mfa_enabled=true. Nothing to do.');
      await client.query('ROLLBACK');
      return;
    }

    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const encryptedSecret = encryptField(secret);

    const updated = await client.query(
      `UPDATE users
          SET mfa_enabled = true,
              mfa_secret = $1
        WHERE id = 'demo-user-001'
        RETURNING id`,
      [JSON.stringify(encryptedSecret)]
    );
    console.log(`Restored MFA enrollment for: ${updated.rows[0].id}`);

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — transaction rolled back, nothing changed.');
    } else {
      await client.query('COMMIT');
      console.log('\nCommitted. Public "Try Free Demo" should reach patients again.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Repair failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
