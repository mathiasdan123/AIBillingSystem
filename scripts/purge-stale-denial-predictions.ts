/**
 * One-time cleanup of denial predictions produced before the date guardrails.
 *
 * WHY THIS EXISTS
 *
 * The Pre-Submission Denial Risk Check told a biller, about a real Cigna claim
 * whose date of service was 107 days PAST: "the date of service is in the
 * future, which is invalid... Immediately correct the date of service and
 * resubmit." On a live claim that is an instruction to falsify when treatment
 * happened. #321 fixed the generator (it now states today's date), and the
 * output guardrail in aiDenialPredictor.sanitizeDateAdvice enforces it on the
 * model's answer rather than trusting the prompt.
 *
 * Neither fix rewrites what was already stored. Predictions persist to
 * claims.denial_prediction, and the claims list renders that stored blob as a
 * clickable Risk badge WITHOUT re-running the prediction — so a pre-fix result
 * stays readable, and actionable, indefinitely. This clears them.
 *
 * SAFE TO RUN ONLINE & IDEMPOTENT:
 *  - denial_prediction is advisory, derived data. Clearing it removes the Risk
 *    badge; the biller regenerates a current (guarded) one with Check Risk.
 *  - Only rows analyzed BEFORE the cutoff are touched, so a re-run is a no-op.
 *  - Nothing else reads the blob for correctness. Note the one visible side
 *    effect: dashboards that count high-risk claims
 *    (storage/analytics.ts, storage/billerCockpit.ts, storage/recoveryLedger.ts
 *    filter on denial_prediction->>'riskLevel') will drop those claims from
 *    their counts until someone re-runs the check. That is the honest state —
 *    a stale verdict should not be counted as a current one. Already-recorded
 *    recovery_events are unaffected.
 *
 * Usage:
 *   # Count what WOULD be cleared, write nothing:
 *   tsx scripts/purge-stale-denial-predictions.ts --dry-run
 *
 *   # Clear them:
 *   tsx scripts/purge-stale-denial-predictions.ts
 *
 *   # Override the cutoff (ISO 8601):
 *   tsx scripts/purge-stale-denial-predictions.ts --cutoff=2026-08-27T20:30:00Z
 */
import { and, sql } from 'drizzle-orm';
import { getDb } from '../server/db.js';
import { claims } from '../shared/schema.js';

/**
 * #321 merged 2026-08-27T19:33Z; deploys take ~13-14 min. Rounded up to give
 * the rollout room — clearing a handful of already-good predictions costs a
 * re-run, while keeping a bad one costs a biller acting on it.
 */
const DEFAULT_CUTOFF = '2026-08-27T20:30:00.000Z';

const DRY_RUN = process.argv.includes('--dry-run');
const cutoffArg = process.argv.find((a) => a.startsWith('--cutoff='))?.split('=')[1];
const CUTOFF = cutoffArg || DEFAULT_CUTOFF;

async function main() {
  if (Number.isNaN(new Date(CUTOFF).getTime())) {
    console.error(`Invalid --cutoff: ${CUTOFF}`);
    process.exit(1);
  }

  const db = await getDb();

  // A prediction with no analyzedAt is treated as stale — it cannot be shown
  // to postdate the fix. ISO-8601 UTC strings compare correctly as text.
  const isStale = and(
    sql`${claims.denialPrediction} IS NOT NULL`,
    sql`COALESCE(${claims.denialPrediction}->>'analyzedAt', '') < ${CUTOFF}`
  );

  const stale = await db
    .select({
      id: claims.id,
      practiceId: claims.practiceId,
      status: claims.status,
      analyzedAt: sql<string | null>`${claims.denialPrediction}->>'analyzedAt'`,
      riskLevel: sql<string | null>`${claims.denialPrediction}->>'riskLevel'`,
    })
    .from(claims)
    .where(isStale);

  console.log(`Cutoff: ${CUTOFF}`);
  console.log(`Stale denial predictions found: ${stale.length}`);
  // Claim ids and risk levels only — issue text can quote claim data.
  for (const row of stale) {
    console.log(
      `  claim ${row.id} (practice ${row.practiceId ?? '?'}, ${row.status ?? '?'}) ` +
        `analyzedAt=${row.analyzedAt ?? 'MISSING'} riskLevel=${row.riskLevel ?? '?'}`
    );
  }

  if (stale.length === 0) {
    console.log('Nothing to clear.');
    return;
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: no rows written.');
    return;
  }

  await db.update(claims).set({ denialPrediction: null }).where(isStale);
  console.log(`\nCleared ${stale.length} stale prediction(s).`);
  console.log('Billers can regenerate a current one with Check Risk on the claim.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Purge failed:', err);
    process.exit(1);
  });
