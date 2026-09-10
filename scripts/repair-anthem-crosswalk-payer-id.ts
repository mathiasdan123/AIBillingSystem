/**
 * One-time repair of the Anthem payer_crosswalk row. NOT YET APPLIED.
 *
 * WHAT IS WRONG
 *
 * seeds.ts originally mapped subPlanName "Anthem BCBS" to trading partner /
 * Stedi payer ID 00805, with a note listing a dozen Anthem states. Per Stedi's
 * payer registry (verified 2026-09-10 via GET /2024-04-01/payers/search),
 * 00805 is an alias of Excellus BlueCross BlueShield of New York (stediId
 * HIANX) — not Anthem at all. Stedi has no single "Anthem" payer: each state
 * is its own entity (New York OLQXL/803, Indiana AOQAR/130, California
 * LAESW/040, Ohio BHNXS/00834, ...). Any eligibility check or claim routed
 * through this crosswalk row goes to Excellus instead of Anthem.
 *
 * The seed fix (same commit) only runs against an empty payer_crosswalk
 * table, so a database that was already seeded keeps the bad row — hence this
 * script. It rewrites the row to Anthem Blue Cross Blue Shield of New York
 * (primary payer ID 803), the Anthem entity our practices actually bill
 * (Wonder Kids). Add per-state rows if a practice onboards with a different
 * Anthem entity.
 *
 * Matches the new seed values exactly; re-runnable no-op once applied. Run it
 * the way repair-claim-46-submission-state.ts was run: a one-off ECS Fargate
 * task with a `node -e` container-command override (RDS is in a private
 * subnet; nothing here reaches it from a laptop).
 *
 * Usage:
 *   tsx scripts/repair-anthem-crosswalk-payer-id.ts --dry-run
 *   tsx scripts/repair-anthem-crosswalk-payer-id.ts
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../server/db.js';
import { payerCrosswalk } from '../shared/schema.js';

const BAD_PAYER_ID = '00805';
const FIXED = {
  subPlanName: 'Anthem BCBS of New York',
  subPlanKeywords: ['anthem', 'anthem bcbs', 'anthem blue cross', 'anthem ny', 'anthem new york', 'empire bcbs'],
  tradingPartnerId: '803',
  stediPayerId: '803',
  state: 'NY',
  notes:
    'Anthem BCBS of New York (formerly Empire BCBS), Stedi OLQXL / primary payer ID 803. ' +
    'Prior value 00805 resolved to Excellus BCBS of NY, not Anthem. Repaired by scripts/repair-anthem-crosswalk-payer-id.ts.',
};

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const db = await getDb();

  const rows = await db
    .select()
    .from(payerCrosswalk)
    .where(eq(payerCrosswalk.tradingPartnerId, BAD_PAYER_ID));

  if (rows.length === 0) {
    console.log(`No payer_crosswalk rows with trading_partner_id=${BAD_PAYER_ID} — nothing to do.`);
    return;
  }

  for (const row of rows) {
    console.log('BEFORE:', JSON.stringify(row));
    if (row.subPlanName !== 'Anthem BCBS') {
      // 00805 legitimately belongs to Excellus; only rewrite the row that
      // mislabels it as Anthem.
      console.log(`Row ${row.id} is not the mislabeled Anthem row. Skipping.`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`--dry-run: would update row ${row.id} to`, JSON.stringify(FIXED));
      continue;
    }
    const [after] = await db
      .update(payerCrosswalk)
      .set(FIXED)
      .where(eq(payerCrosswalk.id, row.id))
      .returning();
    console.log('AFTER:', JSON.stringify(after));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Repair failed:', err);
    process.exit(1);
  });
