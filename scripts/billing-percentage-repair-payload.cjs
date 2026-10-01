/**
 * Move existing practices' billing engine fee from 6% to 5% of collections.
 *
 * Background: PR #369 changed the schema DEFAULT for
 * practices.billing_percentage from 6 to 5, but a column default only applies
 * to rows created after the change — every existing practice row still
 * carries its stored 6. This payload updates those rows.
 *
 * Scope: rows where billing_percentage = 6 exactly. A practice with a
 * hand-negotiated rate (anything other than 6) is deliberately left alone.
 *
 * TIMING: the billing engine invoices on the 2nd of each month for the prior
 * month's collections, at the percentage stored AT BILLING TIME. Run this
 * BEFORE Oct 2 and September collections bill at 5%; run it AFTER the Oct 2
 * run and September bills at 6% with October onward at 5%.
 *
 * Fed to the prod app container verbatim as `node -e <this file>` by
 * scripts/run-billing-percentage-repair.sh (same mechanism as the Anthem
 * crosswalk repair and the deploy workflow's migration step — the prod image
 * has no tsx and no scripts/ directory).
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
      `SELECT id, name, billing_percentage, is_demo
         FROM practices
        ORDER BY id`
    );
    console.log('All practices before:');
    for (const r of before.rows) {
      console.log(
        `  #${r.id} ${r.name} — ${r.billing_percentage}%${r.is_demo ? ' (demo)' : ''}`
      );
    }

    const updated = await client.query(
      `UPDATE practices
          SET billing_percentage = 5
        WHERE billing_percentage = 6
        RETURNING id, name`
    );
    console.log(`\nUpdated ${updated.rowCount} practice(s) from 6% to 5%:`);
    for (const r of updated.rows) {
      console.log(`  #${r.id} ${r.name}`);
    }

    const skipped = await client.query(
      `SELECT id, name, billing_percentage
         FROM practices
        WHERE billing_percentage NOT IN (5, 6)
        ORDER BY id`
    );
    if (skipped.rowCount > 0) {
      console.log('\nLeft alone (custom rate, neither 5 nor 6):');
      for (const r of skipped.rows) {
        console.log(`  #${r.id} ${r.name} — ${r.billing_percentage}%`);
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — transaction rolled back, nothing changed.');
    } else {
      await client.query('COMMIT');
      console.log('\nCommitted.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Repair failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
