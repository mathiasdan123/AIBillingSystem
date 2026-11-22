/**
 * Force re-enrollment of every currently-MFA-enabled user.
 *
 * Background: mfaSecret (the TOTP seed) was written and read as a raw,
 * unencrypted string despite the users.mfa_secret schema comment claiming
 * encryption — and until PR #404, GET /api/auth/user shipped it to the
 * browser on every authenticated page load. server/services/phiEncryptionService.ts
 * now actually encrypts mfaSecret at rest (storage.updateUserMfa), closing
 * the write path going forward, but that doesn't retroactively protect
 * secrets already stored (and potentially already exposed) in plaintext.
 * Rather than re-encrypt those in place, Daniel chose force re-enrollment:
 * wipe every currently-enrolled user's secret and backup codes outright.
 *
 * Mechanism: this sets mfa_enabled=false, mfa_secret=NULL,
 * mfa_backup_codes=NULL for every row where mfa_enabled was true — the same
 * three fields server/routes/auth.ts's admin-initiated POST
 * /users/:id/mfa/reset already sets for one user at account recovery. That
 * existing mechanism is also what re-enrollment goes through afterward:
 * mfaSetupRequired (server/middleware/mfa-setup-required.ts) blocks any user
 * with mfaEnabled=false from every PHI route with 403 MFA_SETUP_REQUIRED
 * until they complete POST /mfa/setup + /mfa/verify again, which now stores
 * the freshly-generated secret encrypted.
 *
 * Idempotent: re-running only ever affects rows that still have
 * mfa_enabled=true, so a second run updates zero rows.
 *
 * Fed to the prod app container verbatim as `node -e <this file>` by
 * scripts/run-force-mfa-reenrollment.sh (same mechanism as the Anthem
 * crosswalk and billing-percentage repairs — the prod image has no tsx and
 * no scripts/ directory).
 *
 * Runs in one transaction. DRY_RUN=1 in the environment rolls it back.
 */
const { Client } = require('pg');

(async () => {
  const dryRun = process.env.DRY_RUN === '1';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(
      `SELECT id, role, practice_id
         FROM users
        WHERE mfa_enabled = true
        ORDER BY id`
    );
    console.log(`Currently MFA-enabled: ${before.rowCount} user(s)`);
    for (const r of before.rows) {
      console.log(`  ${r.id} — role=${r.role} practice=${r.practice_id ?? 'none'}`);
    }

    const updated = await client.query(
      `UPDATE users
          SET mfa_enabled = false,
              mfa_secret = NULL,
              mfa_backup_codes = NULL
        WHERE mfa_enabled = true
        RETURNING id`
    );
    console.log(`\nForced re-enrollment for ${updated.rowCount} user(s):`);
    for (const r of updated.rows) {
      console.log(`  ${r.id}`);
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — transaction rolled back, nothing changed.');
    } else {
      await client.query('COMMIT');
      console.log('\nCommitted. Affected users must complete MFA setup again before touching any PHI route.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Repair failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
