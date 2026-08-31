/**
 * One-time repair of claim 46's submission state. APPLIED 2026-08-31.
 *
 * Kept as the auditable record of a hand-correction to a live claim, and as a
 * re-runnable no-op. It was executed as a one-off ECS Fargate task against
 * prod (the app image has no tsx or scripts/, so the equivalent statements ran
 * via a `node -e` container-command override — the same mechanism the
 * migration step uses). RDS is in a private subnet; nothing here reaches it
 * from a laptop.
 *
 * WHAT WAS WRONG
 *
 * On 2026-08-27 claim 46 (Jude Spero / Cigna / $867, DOS 2026-05-12) was
 * submitted four times in 14 seconds. All four succeeded — the stored response
 * says so plainly: raw.status = "SUCCESS", raw.httpStatusCode = "200 OK", and
 * a full raw.claimReference. Cigna accepted all four for adjudication under
 * 26239-4GN81G000 / H000 / J000 / K000.
 *
 * The submit route read the identifier from `claimId`, a key Stedi does not
 * send (it sends claimReference/controlNumber — see #322). Every success
 * therefore parsed as "no identifier", and the safety rule added the week
 * before — never mark a claim submitted without clearinghouse confirmation —
 * did exactly its job on wrong input: it parked the claim as `held` and
 * returned 502. The biller saw four failures and retried, which is how one
 * claim became four.
 *
 * WHY THE STATE HAD TO BE REWRITTEN
 *
 * `held` is a dead zone. The 4-hourly status poller requires
 * status='submitted' AND clearinghouse_claim_id IS NOT NULL
 * (automatedClaimStatusService.ts:167-177); the daily reaper requires
 * status='submitted' AND submitted_at IS NOT NULL
 * (claimStatusReaperService.ts:189-197); and the ERA auto-matcher excludes
 * status IN ('draft','held') outright (eraAutoMatchService.ts:80-101).
 * A claim held after a "failed" submission is invisible to all three, so
 * Cigna's remittance — which is coming, since the patient's deductible is
 * unmet and the claim will process at $0 with patient responsibility — would
 * have landed as an unmatched remittance forever.
 *
 * WHAT WAS SET, AND WHY THESE VALUES
 *
 *  status                 'held' -> 'submitted'   (the claim was transmitted)
 *  submitted_at           2026-08-27T19:24:16.486Z
 *                         Already stored as clearinghouse_submitted_at — the
 *                         last of the four attempts.
 *  clearinghouse_claim_id 01M12AW5ZXXZSYKBQY67N4TRGX
 *                         raw.claimReference.correlationId. This column holds
 *                         STEDI's identifier, not the payer's: claim 47 stores
 *                         its own correlationId the same way. Deliberately NOT
 *                         a Cigna number (26239-4GN81G000) — that would be a
 *                         different namespace in a column with one meaning.
 *                         Functionally the value is only a presence gate; the
 *                         276 inquiry is built from claims.claimNumber
 *                         (automatedClaimStatusService.ts:211).
 *  clearinghouse_status   'pending' -> 'accepted'  (Stedi SUCCESS; four 277CAs
 *                         acknowledged receipt and Cigna accepted for
 *                         adjudication)
 *  hold_reason            cleared
 *
 * clearinghouse_response is left untouched as the historical record, and
 * last_status_check_at is left NULL so the next poll picks the claim up.
 *
 * NOT DONE, DELIBERATELY: the three duplicate copies were not withdrawn.
 * Jessann's call (2026-08-31) — Cigna processes repeats as duplicates and
 * takes no action on them, so a provider-services call buys nothing.
 *
 * ONE THING TO WATCH: claims 46 and 47 are the same patient, same three CPTs,
 * same $867, differing only in date of service (2026-05-12 vs 2026-08-27). ERA
 * matching scores name 40 / date 20 / CPT 15 / amount 10, so a remittance line
 * carrying a service date lands on the right claim (85 vs 65). A line with NO
 * service date ties at 65 and the winner is whichever row the unordered query
 * returns first (eraAutoMatchService.ts:157). Check the first Cigna remittance
 * posts against the claim it belongs to.
 *
 * Usage:
 *   tsx scripts/repair-claim-46-submission-state.ts --dry-run
 *   tsx scripts/repair-claim-46-submission-state.ts
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '../server/db.js';
import { claims } from '../shared/schema.js';

const CLAIM_ID = 46;
const CORRELATION_ID = '01M12AW5ZXXZSYKBQY67N4TRGX';
const SUBMITTED_AT = new Date('2026-08-27T19:24:16.486Z');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const db = await getDb();

  const [before] = await db
    .select({
      id: claims.id,
      status: claims.status,
      submittedAt: claims.submittedAt,
      clearinghouseClaimId: claims.clearinghouseClaimId,
      clearinghouseStatus: claims.clearinghouseStatus,
      holdReason: claims.holdReason,
    })
    .from(claims)
    .where(eq(claims.id, CLAIM_ID));

  if (!before) {
    console.log(`Claim ${CLAIM_ID} not found — nothing to do.`);
    return;
  }
  console.log('BEFORE:', JSON.stringify(before));

  if (before.status !== 'held' || before.clearinghouseClaimId !== null) {
    console.log('Claim is not in the held/no-identifier state this repairs. No-op.');
    return;
  }

  if (DRY_RUN) {
    console.log('--dry-run: would set status=submitted, ' +
      `submitted_at=${SUBMITTED_AT.toISOString()}, clearinghouse_claim_id=${CORRELATION_ID}, ` +
      'clearinghouse_status=accepted, hold_reason=null');
    return;
  }

  // The guard is in the WHERE clause too, so a concurrent run cannot double-apply.
  const updated = await db
    .update(claims)
    .set({
      status: 'submitted',
      submittedAt: SUBMITTED_AT,
      clearinghouseClaimId: CORRELATION_ID,
      clearinghouseStatus: 'accepted',
      holdReason: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(claims.id, CLAIM_ID),
        eq(claims.status, 'held'),
        isNull(claims.clearinghouseClaimId)
      )
    )
    .returning({ id: claims.id });

  console.log(updated.length ? `Repaired claim ${CLAIM_ID}.` : 'No rows changed.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Repair failed:', err);
    process.exit(1);
  });
