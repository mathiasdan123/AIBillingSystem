/**
 * Sync the Anthem payer_crosswalk rows in an already-seeded database.
 * NOT YET APPLIED to prod.
 *
 * WHAT WAS WRONG
 *
 * seeds.ts originally mapped subPlanName "Anthem BCBS" to trading partner /
 * Stedi payer ID 00805, with a note listing a dozen Anthem states. Per Stedi's
 * payer registry (verified 2026-09-10 via GET /2024-04-01/payers/search),
 * 00805 is an alias of Excellus BlueCross BlueShield of New York (stediId
 * HIANX) — not Anthem at all. Stedi has no single "Anthem" payer: each state
 * is its own entity. Any eligibility check or claim routed through the old
 * crosswalk row went to Excellus instead of Anthem.
 *
 * The seed fix (same PR) only runs against an empty payer_crosswalk table, so
 * a database seeded before it keeps the bad row — hence this script. It
 * brings the table in line with the canonical row set in
 * server/data/anthemCrosswalk.ts:
 *
 *   1. The mislabeled "Anthem BCBS" / 00805 row is rewritten in place to the
 *      Anthem BCBS of New York row (primary payer ID 803) — the entity our
 *      practices actually bill (Wonder Kids, confirmed by Daniel 2026-09-10).
 *      Rewritten rather than deleted+inserted so the row id (and anything
 *      referencing it) survives.
 *   2. Any canonical row not present (matched by subPlanName) is inserted —
 *      the state-specific Anthem entities added for future practices.
 *
 * Idempotent: re-running is a no-op once the table matches. Run it the way
 * repair-claim-46-submission-state.ts was run: a one-off ECS Fargate task
 * (RDS is in a private subnet; nothing here reaches it from a laptop).
 *
 * Usage:
 *   tsx scripts/repair-anthem-crosswalk-payer-id.ts --dry-run
 *   tsx scripts/repair-anthem-crosswalk-payer-id.ts
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../server/db.js';
import { ANTHEM_CROSSWALK_ROWS } from '../server/data/anthemCrosswalk.js';
import { payerCrosswalk } from '../shared/schema.js';

const BAD_PAYER_ID = '00805';
const BAD_SUB_PLAN_NAME = 'Anthem BCBS';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const db = await getDb();
  const existing = await db.select().from(payerCrosswalk);
  const byName = new Map(existing.map((r) => [r.subPlanName, r]));

  const nyRow = ANTHEM_CROSSWALK_ROWS.find((r) => r.state === 'NY');
  if (!nyRow) throw new Error('Canonical Anthem NY row missing from anthemCrosswalk.ts');

  // 1. Rewrite the mislabeled Excellus row to Anthem NY.
  const bad = existing.find(
    (r) => r.tradingPartnerId === BAD_PAYER_ID && r.subPlanName === BAD_SUB_PLAN_NAME,
  );
  if (bad) {
    console.log('BEFORE:', JSON.stringify(bad));
    if (DRY_RUN) {
      console.log(`--dry-run: would rewrite row ${bad.id} to`, JSON.stringify(nyRow));
    } else {
      const [after] = await db
        .update(payerCrosswalk)
        .set(nyRow)
        .where(eq(payerCrosswalk.id, bad.id))
        .returning();
      console.log('AFTER:', JSON.stringify(after));
    }
    byName.set(nyRow.subPlanName, bad);
  } else {
    console.log(`No ${BAD_SUB_PLAN_NAME}/${BAD_PAYER_ID} row found — skipping rewrite.`);
  }

  // 2. Insert canonical rows that are missing.
  const missing = ANTHEM_CROSSWALK_ROWS.filter((r) => !byName.has(r.subPlanName));
  if (missing.length === 0) {
    console.log('All canonical Anthem rows present — nothing to insert.');
    return;
  }
  if (DRY_RUN) {
    console.log(`--dry-run: would insert ${missing.length} rows:`, missing.map((r) => r.subPlanName).join(', '));
    return;
  }
  const inserted = await db.insert(payerCrosswalk).values(missing).returning();
  console.log(`Inserted ${inserted.length} rows:`, inserted.map((r) => `${r.id}:${r.subPlanName}`).join(', '));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Repair failed:', err);
    process.exit(1);
  });
