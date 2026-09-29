/**
 * ERA auto-matching and payment posting.
 *
 * Matching (linking a remit line to a claim) and posting (recording money)
 * are DIFFERENT steps with different kill switches:
 *
 *   - matchRemittanceLineItems: matching only. Runs on every ingest and on
 *     the poller's backfill pass, regardless of ERA_AUTO_POST — a linked line
 *     is information, not money.
 *   - autoMatchRemittance: matching + posting. Runs from the Auto-Match
 *     button and from the poller only when ERA_AUTO_POST is not 'false'.
 *     It posts every auto-matched line whose payment is not yet recorded,
 *     which is how lines linked by a match-only pass get their money posted
 *     when a human presses the button.
 *
 * Matching rules, in order:
 *
 *   1. Claim reference (CLP01). The 837 submission sets patientControlNumber
 *      to claims.claimNumber (or `CLM{id}`), and the payer echoes it back on
 *      the 835. If the reference names exactly one claim of this practice AND
 *      the line's charged amount agrees with that claim (claim total or one
 *      of its line charges, within CLAIM_REFERENCE_AMOUNT_TOLERANCE), link
 *      it. A reference matching several claims, or an amount disagreement,
 *      leaves the line unmatched with a visible matchReviewReason — never
 *      guess with money.
 *   2. Scored identity fallback (eraMatchScoring): patient identity is
 *      mandatory and the score must clear AUTO_MATCH_THRESHOLD. If more than
 *      one claim clears the bar and the best does not beat the runner-up by
 *      at least AMBIGUITY_MARGIN, the line is left unmatched for review.
 *
 * Idempotency: only lines with status 'unmatched' and no claimId are ever
 * examined, so poller re-runs (the cursor rewinds by design) re-decide only
 * still-unmatched lines, and a manual match (status 'matched') is never
 * touched or overwritten.
 */
import { db } from '../db';
import {
  remittanceAdvice,
  remittanceLineItems,
  claims,
  claimLineItems,
  cptCodes,
  patients,
  feeSchedules,
} from '@shared/schema';
import { eq, and, desc, sql, ilike, lte } from 'drizzle-orm';
import { postPayment } from './paymentPostingService';
import { ensureUnderpaymentFollowUp } from './underpaymentPipelineService';
import { scoreClaimAgainstRemittanceLine, isAutoMatch } from './eraMatchScoring';
import { decryptRemittanceLineItem, decryptField } from './phiEncryptionService';
import logger from './logger';

/**
 * A claim-reference match must also agree on money: the line's charged
 * amount must be within this many dollars of the claim's total or one of its
 * line charges. References are typed and re-keyed by payers; the amount
 * check catches a reference that points at the wrong claim.
 */
export const CLAIM_REFERENCE_AMOUNT_TOLERANCE = 1.0;

/**
 * When several claims clear the scored threshold, the best must beat the
 * runner-up by at least this many points to be trusted. Anything closer is
 * ambiguous and goes to a human. 15 exceeds the 10-point amount tie-breaker,
 * so two same-patient claims separated only by amount agreement still count
 * as ambiguous.
 */
export const AMBIGUITY_MARGIN = 15;

export type MatchReviewReason =
  | 'ambiguous_claim_reference'
  | 'claim_number_amount_mismatch'
  | 'multiple_candidates';

export interface MatchOnlyResult {
  /** Lines newly linked to a claim by this pass. */
  linked: number;
  /** Unmatched lines examined by this pass. */
  total: number;
  /** Lines left unmatched with a review reason set. */
  needsReview: number;
  results: Array<{
    lineItemId: number;
    claimId: number | null;
    matchType: string;
    reviewReason?: MatchReviewReason;
  }>;
}

export interface AutoMatchResult {
  /** Lines newly linked by this run (same meaning as MatchOnlyResult.linked). */
  matched: number;
  /** Payments recorded by this run — includes lines linked by an earlier match-only pass. */
  posted: number;
  /** Lines this run had work to consider: unmatched + auto-matched-but-unposted. */
  total: number;
  needsReview: number;
  results: Array<{ lineItemId: number; claimId: number | null; matchType: string }>;
  /**
   * Lines matched to a claim whose payment posting FAILED. Non-empty means
   * money was matched but not recorded — callers must not present that as a
   * clean success.
   */
  postingFailures: Array<{ claimId: number; lineItemId: number }>;
}

interface ClaimCandidate {
  claimId: number;
  claimNumber: string | null;
  patientId: number;
  patientFirstName: string | null;
  patientLastName: string | null;
  totalAmount: string | null;
  status: string | null;
  createdAt: Date | null;
}

interface MatchContext {
  practiceClaims: ClaimCandidate[];
  claimLineItemsByClaimId: Map<number, any[]>;
  cptCodeById: Map<number, string>;
}

/** Load the practice's matchable claims and lookup structures. */
async function loadMatchContext(practiceId: number): Promise<MatchContext> {
  // A payer cannot be paying a claim that was never transmitted, so drafts
  // and held claims are not candidates. Leaving them in only creates
  // opportunities to link real money onto the wrong record.
  const practiceClaims = (await db
    .select({
      claimId: claims.id,
      claimNumber: claims.claimNumber,
      patientId: claims.patientId,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      totalAmount: claims.totalAmount,
      status: claims.status,
      createdAt: claims.createdAt,
    })
    .from(claims)
    .innerJoin(patients, eq(claims.patientId, patients.id))
    .where(
      and(
        eq(claims.practiceId, practiceId),
        sql`${claims.status} NOT IN ('draft', 'held')`,
      ),
    )) as ClaimCandidate[];

  // patients.firstName/lastName are PHI-encrypted at rest and this is a raw
  // join, so decrypt them — otherwise the name-matching below compares the
  // (decrypted) remittance name against ciphertext and never matches.
  for (const c of practiceClaims) {
    c.patientFirstName = decryptField(c.patientFirstName) as any;
    c.patientLastName = decryptField(c.patientLastName) as any;
  }

  // Claim line items for service date + CPT + per-line amount matching.
  const allClaimLineItems = await db
    .select()
    .from(claimLineItems)
    .where(
      sql`${claimLineItems.claimId} IN (SELECT id FROM claims WHERE practice_id = ${practiceId})`
    );

  // Resolve CPT ids to their actual codes. Without this the "CPT match"
  // could only test that a line HAD a cpt id — which, on a NOT NULL column,
  // is always true.
  const allCptCodes = await db.select({ id: cptCodes.id, code: cptCodes.code }).from(cptCodes);
  const cptCodeById = new Map<number, string>();
  for (const c of allCptCodes) cptCodeById.set(c.id, String(c.code));

  const claimLineItemsByClaimId = new Map<number, any[]>();
  for (const cli of allClaimLineItems as any[]) {
    const existing = claimLineItemsByClaimId.get(cli.claimId) || [];
    existing.push(cli);
    claimLineItemsByClaimId.set(cli.claimId, existing);
  }

  return { practiceClaims, claimLineItemsByClaimId, cptCodeById };
}

type MatchDecision =
  | { outcome: 'match'; claimId: number; matchType: string }
  | { outcome: 'review'; reason: MatchReviewReason }
  | { outcome: 'none' };

const normalizeReference = (v: unknown): string | null => {
  const s = String(v ?? '').trim().toUpperCase();
  return s.length > 0 ? s : null;
};

/** Does the line's charged amount agree with this claim, within tolerance? */
function amountAgreesWithClaim(
  lineItem: any,
  claim: ClaimCandidate,
  claimLines: any[],
): boolean {
  const charged = parseFloat(String(lineItem.chargedAmount ?? ''));
  // No charged amount on the line means there is nothing to disagree with —
  // the reference identifies our own claim number, which is evidence enough.
  if (!Number.isFinite(charged) || charged <= 0) return true;

  const targets: number[] = [];
  const claimTotal = parseFloat(String(claim.totalAmount ?? ''));
  if (Number.isFinite(claimTotal)) targets.push(claimTotal);
  for (const cli of claimLines) {
    const lineAmount = parseFloat(String(cli.amount ?? ''));
    if (Number.isFinite(lineAmount)) targets.push(lineAmount);
  }
  // A claim with no recorded amounts cannot fail the check.
  if (targets.length === 0) return true;

  return targets.some((t) => Math.abs(t - charged) <= CLAIM_REFERENCE_AMOUNT_TOLERANCE);
}

/** Decide what to do with one unmatched line. Pure decision — writes nothing. */
function decideMatch(lineItem: any, ctx: MatchContext): MatchDecision {
  // ---- Rule 1: claim reference (CLP01 → claims.claimNumber) ----
  const ref = normalizeReference(lineItem.claimReference);
  if (ref) {
    const byReference = ctx.practiceClaims.filter(
      (c) =>
        (c.claimNumber != null && normalizeReference(c.claimNumber) === ref) ||
        // The 837 path falls back to `CLM{id}` when a claim has no number.
        `CLM${c.claimId}` === ref,
    );

    if (byReference.length > 1) {
      return { outcome: 'review', reason: 'ambiguous_claim_reference' };
    }

    if (byReference.length === 1) {
      const claim = byReference[0];
      const claimLines = ctx.claimLineItemsByClaimId.get(claim.claimId) || [];
      if (!amountAgreesWithClaim(lineItem, claim, claimLines)) {
        // The reference says one thing and the money says another. That is
        // exactly the case a human must look at — never link it on a guess.
        return { outcome: 'review', reason: 'claim_number_amount_mismatch' };
      }
      return { outcome: 'match', claimId: claim.claimId, matchType: 'claim_number' };
    }
    // Reference present but unknown to us (e.g. payer re-keyed it): fall
    // through to the scored identity rules rather than giving up.
  }

  // ---- Rule 2: scored identity fallback ----
  const scored = ctx.practiceClaims
    .map((claim) => ({
      claim,
      candidate: scoreClaimAgainstRemittanceLine(
        claim,
        ctx.claimLineItemsByClaimId.get(claim.claimId) || [],
        lineItem,
        ctx.cptCodeById,
      ),
    }))
    // Identity is mandatory: corroborating signals can raise confidence in a
    // claim already tied to this patient, but can never establish the tie.
    .filter((entry) => isAutoMatch(entry.candidate))
    .sort((a, b) => b.candidate.score - a.candidate.score);

  if (scored.length === 0) {
    return { outcome: 'none' };
  }

  if (
    scored.length > 1 &&
    scored[0].candidate.score - scored[1].candidate.score < AMBIGUITY_MARGIN
  ) {
    // Several claims clear the bar and none clearly wins. Choosing the
    // "best" here is a guess about where real dollars land.
    return { outcome: 'review', reason: 'multiple_candidates' };
  }

  return {
    outcome: 'match',
    claimId: scored[0].claim.claimId,
    matchType: scored[0].candidate.matchTypes.join('+'),
  };
}

/**
 * Match a remittance's unmatched line items to claims. Matching ONLY — no
 * payment is posted and claim balances are untouched.
 *
 * Returns null when the remittance does not exist for this practice.
 */
export async function matchRemittanceLineItems(
  practiceId: number,
  remittanceId: number,
): Promise<MatchOnlyResult | null> {
  const remittance = await db.query.remittanceAdvice.findFirst({
    where: and(
      eq(remittanceAdvice.id, remittanceId),
      eq(remittanceAdvice.practiceId, practiceId),
    ),
    with: { lineItems: true },
  });

  if (!remittance) {
    return null;
  }

  // Decrypt line-item PHI before matching — the matcher compares patientName
  // against claim patient names.
  const lineItems = (remittance.lineItems ?? []).map(decryptRemittanceLineItem) as any[];

  // Only never-matched lines are examined. A matched line — whether a human
  // linked it or a previous pass did — is never re-decided or overwritten.
  const unmatchedItems = lineItems.filter(
    (li: any) => li.status === 'unmatched' && li.claimId == null,
  );

  const result: MatchOnlyResult = { linked: 0, total: unmatchedItems.length, needsReview: 0, results: [] };
  if (unmatchedItems.length === 0) {
    return result;
  }

  const ctx = await loadMatchContext(practiceId);

  for (const lineItem of unmatchedItems) {
    const decision = decideMatch(lineItem, ctx);

    if (decision.outcome === 'match') {
      await db
        .update(remittanceLineItems)
        .set({
          claimId: decision.claimId,
          status: 'matched',
          matchType: decision.matchType,
          matchedAt: new Date(),
          matchReviewReason: null,
        })
        .where(eq(remittanceLineItems.id, lineItem.id));

      result.linked++;
      result.results.push({
        lineItemId: lineItem.id,
        claimId: decision.claimId,
        matchType: decision.matchType,
      });
    } else if (decision.outcome === 'review') {
      // Left unmatched ON PURPOSE, with the reason visible on the
      // remittance page. Re-running recomputes the same reason (or clears
      // it, if the ambiguity has since been resolved).
      if (lineItem.matchReviewReason !== decision.reason) {
        await db
          .update(remittanceLineItems)
          .set({ matchReviewReason: decision.reason })
          .where(eq(remittanceLineItems.id, lineItem.id));
      }
      result.needsReview++;
      result.results.push({
        lineItemId: lineItem.id,
        claimId: null,
        matchType: 'no_match',
        reviewReason: decision.reason,
      });
    } else {
      if (lineItem.matchReviewReason != null) {
        await db
          .update(remittanceLineItems)
          .set({ matchReviewReason: null })
          .where(eq(remittanceLineItems.id, lineItem.id));
      }
      result.results.push({ lineItemId: lineItem.id, claimId: null, matchType: 'no_match' });
    }
  }

  if (result.linked > 0) {
    logger.info('ERA line items matched to claims', {
      practiceId,
      remittanceId,
      linked: result.linked,
      needsReview: result.needsReview,
      total: result.total,
    });
  }

  return result;
}

/**
 * Remittances of this practice that still have unmatched line items — the
 * poller's backfill worklist, so remits ingested before matching existed
 * (or re-seen as duplicates) still get matched.
 */
export async function findRemittancesNeedingMatch(
  practiceId: number,
  limit: number,
): Promise<number[]> {
  const rows = await db
    .selectDistinct({ id: remittanceAdvice.id })
    .from(remittanceAdvice)
    .innerJoin(
      remittanceLineItems,
      eq(remittanceLineItems.remittanceId, remittanceAdvice.id),
    )
    .where(
      and(
        eq(remittanceAdvice.practiceId, practiceId),
        eq(remittanceLineItems.status, 'unmatched'),
      ),
    )
    .limit(limit);
  return rows.map((r: any) => r.id);
}

/**
 * Auto-match a remittance's unmatched line items AND post the payments.
 *
 * Runs the same matchRemittanceLineItems pass as the poller, then records a
 * payment posting for every auto-matched line that does not have one yet —
 * including lines a previous match-only pass linked while ERA_AUTO_POST was
 * off. Manual matches are posted by their own route; legacy rows (matched
 * before matchType existed) were posted under the old fused path — neither
 * is touched here.
 *
 * Returns null when the remittance does not exist for this practice.
 */
export async function autoMatchRemittance(
  practiceId: number,
  remittanceId: number,
  postedBy: string | null = null,
): Promise<AutoMatchResult | null> {
  const matchOutcome = await matchRemittanceLineItems(practiceId, remittanceId);
  if (!matchOutcome) {
    return null;
  }

  const remittance = await db.query.remittanceAdvice.findFirst({
    where: and(
      eq(remittanceAdvice.id, remittanceId),
      eq(remittanceAdvice.practiceId, practiceId),
    ),
    with: { lineItems: true },
  });
  if (!remittance) {
    return null;
  }

  const lineItems = (remittance.lineItems ?? []).map(decryptRemittanceLineItem) as any[];

  // Auto-matched lines whose money is not recorded yet. matchType null means
  // the row predates the match/post split and was posted by the old fused
  // path — posting it again would double-count real dollars.
  const toPost = lineItems.filter(
    (li: any) =>
      li.status === 'matched' &&
      li.claimId != null &&
      li.matchType != null &&
      li.matchType !== 'manual' &&
      li.autoPostedAt == null,
  );

  const linkedIds = new Set(
    matchOutcome.results.filter((r) => r.claimId != null).map((r) => r.lineItemId),
  );
  const carriedForward = toPost.filter((li: any) => !linkedIds.has(li.id)).length;

  const postingFailures: Array<{ claimId: number; lineItemId: number }> = [];
  let posted = 0;

  const claimNumberById = new Map<number, string | null>();
  if (toPost.length > 0) {
    const claimRows = await db
      .select({ claimId: claims.id, claimNumber: claims.claimNumber })
      .from(claims)
      .where(
        and(
          eq(claims.practiceId, practiceId),
          sql`${claims.id} IN (${sql.join(
            toPost.map((li: any) => sql`${li.claimId}`),
            sql`, `,
          )})`,
        ),
      );
    for (const row of claimRows as any[]) claimNumberById.set(row.claimId, row.claimNumber);
  }

  for (const lineItem of toPost) {
    const claimId = lineItem.claimId as number;
    const paidAmt = parseFloat(String(lineItem.paidAmount || '0'));
    const claimUpdate: Record<string, any> = {
      updatedAt: new Date(),
    };

    // --- Underpayment detection ---
    // Look up the fee schedule for this payer + CPT code to find expected reimbursement
    if (lineItem.cptCode && remittance.payerName) {
      try {
        const today = new Date().toISOString().split('T')[0];
        const feeScheduleEntries = await db
          .select()
          .from(feeSchedules)
          .where(
            and(
              eq(feeSchedules.practiceId, practiceId),
              eq(feeSchedules.cptCode, lineItem.cptCode),
              ilike(feeSchedules.payerName, `%${remittance.payerName}%`),
              lte(feeSchedules.effectiveDate, today),
            )
          )
          .orderBy(desc(feeSchedules.effectiveDate))
          .limit(1);

        if (feeScheduleEntries.length > 0) {
          const feeEntry = feeScheduleEntries[0];
          const expectedReimbursement = parseFloat(String(feeEntry.expectedReimbursement));

          // Flag as underpayment if paid amount is more than $5 below expected
          if (expectedReimbursement > 0 && paidAmt < expectedReimbursement - 5) {
            // Set expectedAmount on the claim for tracking
            claimUpdate.expectedAmount = String(expectedReimbursement);

            logger.info('Underpayment detected during ERA auto-match', {
              claimId,
              cptCode: lineItem.cptCode,
              payerName: remittance.payerName,
              expectedReimbursement,
              paidAmount: paidAmt,
              underpaymentAmount: expectedReimbursement - paidAmt,
            });

            // Surface the underpayment in the billing work queue.
            await ensureUnderpaymentFollowUp({
              claimId,
              practiceId,
              claimNumber: claimNumberById.get(claimId) ?? undefined,
              expectedAmount: expectedReimbursement,
              paidAmount: paidAmt,
              cptCode: lineItem.cptCode,
              payerName: remittance.payerName,
            });
          }
        }
      } catch (feeErr) {
        // Non-blocking — don't fail the posting if fee schedule lookup fails
        logger.error('Fee schedule lookup failed during underpayment detection', {
          error: feeErr instanceof Error ? feeErr.message : String(feeErr),
          cptCode: lineItem.cptCode,
          payerName: remittance.payerName,
        });
      }
    }

    await db
      .update(claims)
      .set(claimUpdate)
      .where(eq(claims.id, claimId));

    // Mark the line posted BEFORE calling postPayment and roll back on
    // failure. If the rollback itself fails, the failure is still visible in
    // postingFailures/logs — biasing toward "posting missed and flagged"
    // over "posting recorded twice", which inflates collections and the fee.
    await db
      .update(remittanceLineItems)
      .set({ autoPostedAt: new Date() })
      .where(eq(remittanceLineItems.id, lineItem.id));

    // The payment posting is the record the whole money path reads from
    // (A/R, patient statements, and the 6%-of-collections basis). postPayment
    // owns claim.paidAmount and status: it SUMS non-reversed postings, so a
    // multi-line ERA accumulates instead of the last line overwriting the
    // total, and a partial payment lands on 'partial' rather than closing
    // the claim.
    try {
      await postPayment(practiceId, {
        // Authoritative: supersedes any 277-derived posting on this claim.
        source: 'era',
        claimId,
        payerName: remittance.payerName,
        checkNumber: remittance.checkNumber ?? null,
        paymentDate: remittance.checkDate ?? remittance.receivedDate,
        paymentAmount: String(paidAmt.toFixed(2)),
        adjustmentAmount: String(parseFloat(String(lineItem.adjustmentAmount || '0')).toFixed(2)),
        // Only the PR group is billable to the patient. Statements read
        // this; deriving a balance from charge - paid instead would bill
        // them the contractual write-off (balance billing).
        patientResponsibility: String(
          parseFloat(String((lineItem as any).patientResponsibility ?? '0')).toFixed(2),
        ),
        allowedAmount: lineItem.allowedAmount != null ? String(lineItem.allowedAmount) : null,
        postedBy,
      } as any);
      posted++;
    } catch (postError) {
      // A failed posting must be visible, not swallowed — the claim would
      // otherwise show matched with no money behind it.
      logger.error('ERA auto-match: failed to record payment posting', {
        claimId,
        remittanceId: remittance.id,
        error: postError instanceof Error ? postError.message : String(postError),
      });
      postingFailures.push({ claimId, lineItemId: lineItem.id });
      try {
        await db
          .update(remittanceLineItems)
          .set({ autoPostedAt: null })
          .where(eq(remittanceLineItems.id, lineItem.id));
      } catch (rollbackError) {
        logger.error('ERA auto-match: failed to clear autoPostedAt after posting failure', {
          lineItemId: lineItem.id,
          remittanceId: remittance.id,
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
      }
    }
  }

  // Update remittance status. 'processed' means done: every line is matched
  // AND every auto-matched line has its payment recorded. A remittance with
  // matched-but-unposted lines stays 'pending' so the Auto-Match button
  // remains available to post them.
  const allItems = await db
    .select()
    .from(remittanceLineItems)
    .where(eq(remittanceLineItems.remittanceId, remittanceId));

  const allMatched =
    allItems.length > 0 && allItems.every((item: any) => item.status === 'matched');
  const allAutoPosted = allItems.every(
    (item: any) =>
      item.matchType == null || item.matchType === 'manual' || item.autoPostedAt != null,
  );

  await db
    .update(remittanceAdvice)
    .set({
      status: allMatched && allAutoPosted ? 'processed' : 'pending',
      processedAt: allMatched && allAutoPosted ? new Date() : undefined,
    })
    .where(eq(remittanceAdvice.id, remittanceId));

  return {
    matched: matchOutcome.linked,
    posted,
    total: matchOutcome.total + carriedForward,
    needsReview: matchOutcome.needsReview,
    results: matchOutcome.results,
    postingFailures,
  };
}
