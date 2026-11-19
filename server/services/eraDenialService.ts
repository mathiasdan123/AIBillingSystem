/**
 * ERA denials (demo billing test 2026-11-19, item 5).
 *
 * An 835 says whether the payer DENIED a claim in CLP02, the claim status
 * code: 1/2/3 = processed as primary/secondary/tertiary, 4 = denied, 22 =
 * reversal of a previous payment. The parser read CLP02 but dropped it
 * before storage, and both posting paths (auto-match and the manual match
 * route) recorded only the money. So a denial — CLP02 4, paid $0, CAS
 * CO-197 $100 — matched to a claim left it in its old status with no denial
 * reason, no appeal draft, nothing in the work queue, and the Payments tab
 * showed the $100 as a 100% write-off with no reason code.
 *
 * Denial vs contractual write-off: both arrive as CAS adjustments in the CO
 * (contractual obligation) group, and neither is billable to the patient.
 * The difference is CLP02. On a PROCESSED claim (1/2/3) a CO adjustment is
 * the write-off the practice agreed to absorb (CO-45 "charge exceeds fee
 * schedule" is the usual one) and the payer paid the allowed amount. On a
 * DENIED claim (4) the payer adjudicated the whole claim as not payable;
 * the CO amount is the denied charge, and the CARC says why (CO-197
 * precertification absent, CO-16 missing information, CO-29 timely filing,
 * ...). It is recoverable by appeal or correction, so it must not be
 * written off silently.
 *
 * This module carries the CARC/RARC onto the payment posting (its
 * adjustmentReason / remarkCode columns were never filled by the ERA path)
 * and, for a denied line, marks the claim denied with the CARC as the
 * denial reason, records the timeline event and hands the claim to the
 * denial pipeline (appeal draft + work-queue follow-up), exactly as the
 * manual Deny button and the 277 status poller do.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db';
import { remittanceLineItems } from '@shared/schema';
import { storage } from '../storage';
import { recordClaimEvent, clip } from './claimEventService';
import { processDeniedClaim } from './denialPipelineService';
import { getAdjustmentGroupDescription, getReasonCodeDescription } from './edi835Parser';
import logger from './logger';

/** CLP02 values, X12 835 claim status codes. */
export const CLAIM_STATUS_PROCESSED_PRIMARY = '1';
export const CLAIM_STATUS_DENIED = '4';
export const CLAIM_STATUS_REVERSAL = '22';

export interface RemittanceLineLike {
  id?: number;
  cptCode?: string | null;
  paidAmount?: string | number | null;
  chargedAmount?: string | number | null;
  adjustmentAmount?: string | number | null;
  claimStatusCode?: string | null;
  /** `['45','2']` (Stedi normalizer) or `[{code:'CO-45',description}]` (835 parser). */
  adjustmentReasonCodes?: unknown;
  /** `['N130']` or `[{code:'N130',description}]`. */
  remarkCodes?: unknown;
}

type CodeEntry = { code: string; description: string };

function toCodeEntries(raw: unknown, describe: (code: string) => string): CodeEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CodeEntry[] = [];
  for (const entry of raw) {
    if (entry == null) continue;
    if (typeof entry === 'string' || typeof entry === 'number') {
      const code = String(entry).trim();
      if (code) out.push({ code, description: describe(code) });
    } else if (typeof entry === 'object' && (entry as any).code != null) {
      const code = String((entry as any).code).trim();
      if (!code) continue;
      const description = String((entry as any).description ?? '').trim();
      out.push({ code, description: description && description !== code ? description : describe(code) });
    }
  }
  return out;
}

/**
 * "CO-197: Precertification/authorization/notification absent". A bare
 * CARC from the Stedi normalizer ('197') has no group, so it is described
 * by reason only.
 */
function describeAdjustmentCode(code: string): string {
  const m = /^([A-Z]{2})-(\w+)$/.exec(code);
  if (m) return `${getAdjustmentGroupDescription(m[1])}: ${getReasonCodeDescription(m[2])}`;
  return getReasonCodeDescription(code);
}

export function adjustmentReasonCodeEntries(line: RemittanceLineLike): CodeEntry[] {
  return toCodeEntries(line.adjustmentReasonCodes, describeAdjustmentCode);
}

export function remarkCodeEntries(line: RemittanceLineLike): CodeEntry[] {
  return toCodeEntries(line.remarkCodes, (code) => code);
}

const REASON_TEXT_LIMIT = 500;

/** The posting's adjustmentReason / remarkCode text for a remittance line. */
export function postingReasonFields(line: RemittanceLineLike): { adjustmentReason: string | null; remarkCode: string | null } {
  const reasons = adjustmentReasonCodeEntries(line).map((e) => `${e.code}: ${e.description}`);
  const remarks = remarkCodeEntries(line).map((e) => e.code);
  return {
    adjustmentReason: reasons.length ? clip(reasons.join('; '), REASON_TEXT_LIMIT) : null,
    remarkCode: remarks.length ? clip(remarks.join(', '), REASON_TEXT_LIMIT) : null,
  };
}

/**
 * A line is a denial when the payer said so in CLP02. A $0 payment on a
 * processed claim (CLP02 1) is not: that is a zero allowed amount (bundled
 * service, deductible not met with the whole charge in PR, ...) and the
 * CARC on the posting tells the biller which. Lines without a status code
 * (legacy rows, JSON uploads that omit it) are never treated as denials.
 */
export function isDeniedRemittanceLine(line: RemittanceLineLike): boolean {
  return String(line.claimStatusCode ?? '').trim() === CLAIM_STATUS_DENIED;
}

/** The denial reason as the claim and the appeal generator see it. */
export function denialReasonForLine(line: RemittanceLineLike): string {
  const entries = adjustmentReasonCodeEntries(line);
  if (entries.length === 0) return 'Denied by payer (835 claim status 4, no adjustment reason code given)';
  return clip(entries.map((e) => `${e.code}: ${e.description}`).join('; '), REASON_TEXT_LIMIT);
}

export interface ApplyDenialOptions {
  remittanceId: number;
  payerName?: string | null;
  checkNumber?: string | null;
  postedBy?: string | null;
}

/** What the appeal-draft / follow-up pipeline actually did. Always reported, never assumed. */
export interface DenialPipelineState {
  /** False when the claim's status meant the pipeline had nothing to do (e.g. already under appeal). */
  ran: boolean;
  appealCreated: boolean;
  /** An appeal already existed for the claim and was kept. */
  appealReused: boolean;
  appealId?: number;
  followUpCreated: boolean;
  error?: string;
}

export interface ApplyDenialResult {
  claimId: number;
  /** This call changed the claim's status to 'denied'. */
  denied: boolean;
  /** The claim's status after this call. */
  claimStatus: string | null;
  denialReason: string;
  /**
   * Nothing is left to retry: the claim carries the denial (or legitimately
   * keeps its status) AND the pipeline finished. False means the caller
   * should leave the line's denial pending so the next run tries again.
   */
  applied: boolean;
  skippedReason?: 'not_denied' | 'claim_not_found' | 'claim_has_payments' | 'claim_reopened';
  pipeline: DenialPipelineState;
  /**
   * The denial itself went through but its outcome could not be written on
   * the line (applied is then false so the line is retried; the retry is a
   * no-op on the claim and only re-records the marker).
   */
  persistenceError?: string;
}

const NO_PIPELINE: DenialPipelineState = { ran: false, appealCreated: false, appealReused: false, followUpCreated: false };

/**
 * Run the appeal draft + denial_appeal follow-up for a denied claim and say
 * truthfully what happened. processDeniedClaim is idempotent (it keeps an
 * existing appeal and dedups the follow-up), so this is safe to rerun until
 * it succeeds. A draft that silently produced no appeal (the generator
 * returned nothing) is reported as an error so the step is retried.
 */
async function runDenialPipeline(claimId: number): Promise<DenialPipelineState> {
  try {
    const r = await processDeniedClaim(claimId);
    if (r.skippedReason === 'claim_status_appeal') {
      // The claim is already under appeal; the pipeline did not run and no
      // appeal was looked up, so nothing is claimed about one.
      return { ...NO_PIPELINE };
    }
    if (r.skippedReason && r.skippedReason !== 'appeal_exists') {
      return { ...NO_PIPELINE, error: `Denial pipeline skipped: ${r.skippedReason}` };
    }
    const state: DenialPipelineState = {
      ran: true,
      appealCreated: r.appealCreated,
      appealReused: r.skippedReason === 'appeal_exists',
      appealId: r.appealId,
      followUpCreated: r.followUpCreated,
      error: r.error,
    };
    if (!state.error && !state.appealCreated && !state.appealReused) {
      state.error = 'Appeal draft was not created (the generator returned nothing)';
    }
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('ERA denial: denial pipeline failed', { claimId, error: message });
    return { ...NO_PIPELINE, error: message };
  }
}

/**
 * Apply a denied remittance line to its claim. Call AFTER postPayment, which
 * owns paidAmount and sets paid/partial when money arrived; a denial of one
 * line on a claim another line paid keeps that status and only gets a
 * timeline note.
 *
 * Resumable: an already-denied claim is not re-flagged, but its appeal /
 * follow-up pipeline still runs, so a failure after the status change is
 * picked up by the next attempt. Nothing here posts money.
 */
export async function applyRemittanceDenial(
  practiceId: number,
  claimId: number,
  line: RemittanceLineLike,
  opts: ApplyDenialOptions,
): Promise<ApplyDenialResult> {
  const denialReason = denialReasonForLine(line);
  const result: ApplyDenialResult = {
    claimId,
    denied: false,
    claimStatus: null,
    denialReason,
    applied: true,
    pipeline: { ...NO_PIPELINE },
  };

  if (!isDeniedRemittanceLine(line)) {
    result.skippedReason = 'not_denied';
    return result;
  }

  const claim = await storage.getClaim(claimId);
  if (!claim || claim.practiceId !== practiceId) {
    result.skippedReason = 'claim_not_found';
    result.applied = false;
    logger.warn('ERA denial: claim not found for practice', { practiceId, claimId, remittanceId: opts.remittanceId });
    return result;
  }
  result.claimStatus = claim.status ?? null;

  const codes = adjustmentReasonCodeEntries(line).map((e) => e.code);
  const remarks = remarkCodeEntries(line).map((e) => e.code);
  const baseMetadata = {
    source: 'era',
    remittanceId: opts.remittanceId,
    remittanceLineItemId: line.id ?? null,
    claimStatusCode: CLAIM_STATUS_DENIED,
    adjustmentReasonCodes: codes,
    remarkCodes: remarks,
    cptCode: line.cptCode ?? null,
    payerName: opts.payerName ?? null,
    checkNumber: opts.checkNumber ?? null,
  };
  const lineLabel = line.cptCode ? `line ${line.cptCode}` : 'a line';

  if (claim.status === 'paid' || claim.status === 'partial') {
    // Money was recorded on this claim (this line or another), so the
    // claim is not denied as a whole. Keep the fact visible on the timeline.
    result.skippedReason = 'claim_has_payments';
    await recordClaimEvent({
      claimId,
      practiceId,
      eventType: 'note_added',
      summary: `ERA denied ${lineLabel}: ${clip(denialReason)} (claim stays ${claim.status}; other lines paid)`,
      metadata: { ...baseMetadata, previousStatus: claim.status, statusChanged: false },
      createdBy: opts.postedBy ?? null,
    });
    return result;
  }

  if (claim.status === 'draft') {
    // Only reachable for a claim that WAS transmitted and has since been
    // reopened for correction (the match routes refuse never-sent drafts).
    // The ERA is the verdict on the earlier filing; the biller is already
    // correcting it, so the draft is left alone and the fact goes on the
    // timeline. The reopen already created the correction follow-up.
    result.skippedReason = 'claim_reopened';
    await recordClaimEvent({
      claimId,
      practiceId,
      eventType: 'note_added',
      summary: `ERA for the earlier submission denied ${lineLabel}: ${clip(denialReason)} (claim is a draft being corrected; status unchanged)`,
      metadata: { ...baseMetadata, previousStatus: claim.status, statusChanged: false },
      createdBy: opts.postedBy ?? null,
    });
    return result;
  }

  if (claim.status !== 'denied' && claim.status !== 'appeal') {
    await storage.updateClaim(claimId, { status: 'denied', denialReason } as any);
    result.denied = true;
    result.claimStatus = 'denied';

    await recordClaimEvent({
      claimId,
      practiceId,
      eventType: 'denied',
      summary: `Denied by ${opts.payerName || 'payer'} (ERA): ${clip(denialReason)}`,
      metadata: { ...baseMetadata, denialReason, previousStatus: claim.status, statusChanged: true },
      createdBy: opts.postedBy ?? null,
    });

    logger.info('ERA denial applied to claim', {
      practiceId,
      claimId,
      remittanceId: opts.remittanceId,
      previousStatus: claim.status,
      adjustmentReasonCodes: codes,
    });
  }

  // Appeal draft + denial_appeal follow-up, same as the Deny button and the
  // 277 poller. Runs even when the claim was already denied, so a pipeline
  // failure after the status change is retried next time.
  result.pipeline = await runDenialPipeline(claimId);
  result.applied = !result.pipeline.error;
  return result;
}

/**
 * Apply a line's denial and record the outcome ON THE LINE: denialAppliedAt
 * when nothing is left to retry, denialError (with denialAppliedAt cleared)
 * otherwise. Both posting paths call this after the payment is recorded,
 * and the auto-match run retries every posted denied line that is still
 * pending. Never throws: a thrown error becomes a denialError.
 */
export async function applyRemittanceDenialToLine(
  practiceId: number,
  line: RemittanceLineLike & { id: number; claimId?: number | null },
  opts: ApplyDenialOptions,
): Promise<ApplyDenialResult> {
  const claimId = line.claimId as number;
  let result: ApplyDenialResult;
  try {
    result = await applyRemittanceDenial(practiceId, claimId, line, opts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('ERA denial: applying the denial threw', { claimId, lineItemId: line.id, remittanceId: opts.remittanceId, error: message });
    result = {
      claimId,
      denied: false,
      claimStatus: null,
      denialReason: denialReasonForLine(line),
      applied: false,
      pipeline: { ...NO_PIPELINE, error: message },
    };
  }

  const error = result.applied ? null : (result.pipeline.error ?? result.skippedReason ?? 'denial not applied');
  try {
    await db
      .update(remittanceLineItems)
      .set(
        result.applied
          ? { denialAppliedAt: new Date(), denialError: null }
          : { denialAppliedAt: null, denialError: clip(error, REASON_TEXT_LIMIT) },
      )
      .where(eq(remittanceLineItems.id, line.id));
  } catch (markError) {
    // The claim already carries whatever this call did; only the line's
    // record of it is missing. Say so explicitly and leave the line pending:
    // the retry re-runs an idempotent step and re-writes the marker.
    const message = markError instanceof Error ? markError.message : String(markError);
    logger.error('ERA denial: failed to record the denial outcome on the line', { lineItemId: line.id, error: message });
    result.persistenceError = `Denial outcome could not be recorded on the remittance line (retry needed): ${message}`;
    result.applied = false;
    if (!result.pipeline.error) result.pipeline = { ...result.pipeline, error: result.persistenceError };
  }
  return result;
}

export interface DenialPendingLineLike extends RemittanceLineLike {
  status?: string | null;
  claimId?: number | null;
  autoPostedAt?: Date | string | null;
  denialAppliedAt?: Date | string | null;
  denialError?: string | null;
}

/**
 * Written on a denied line in the same request, immediately after ITS
 * postPayment succeeded (manual match route and the Auto-Match posting
 * pass). It is the proof of payment the denial step runs on; the Retry
 * denial route and Auto-Match's denial retry act ONLY on lines carrying it
 * (or a later error text in its place). Nothing is ever inferred from
 * matchType, amounts, dates, check numbers or other postings.
 */
export const DENIAL_PENDING_MARKER = 'pending: payment posted, denial not yet applied';

/**
 * Written on a NON-denied line in the same request, immediately after ITS
 * postPayment succeeded. The post-success proof for lines that have no
 * denial step: autoPostedAt alone is not one — the auto path writes it
 * BEFORE postPayment as a re-post guard (and keeps it when the rollback
 * after a failed posting also fails), so a line carrying only that
 * timestamp may have no money behind it.
 */
export const POSTING_CONFIRMED_MARKER = 'posted: payment recorded';

/**
 * The line's posting was confirmed by this flow: a marker written right
 * after postPayment RETURNED for this line (POSTING_CONFIRMED_MARKER,
 * DENIAL_PENDING_MARKER or the denial step's later error text), or a
 * completed denial (denialAppliedAt, set only after such a marker). The
 * pre-payment autoPostedAt is never proof.
 *
 * Known, deliberate limit: a marker proves a historical successful post,
 * not an active, unreversed payment. The posting reversal path does not
 * invalidate these markers.
 */
export function isPostingConfirmed(line: DenialPendingLineLike): boolean {
  return (
    line.status === 'matched' &&
    line.claimId != null &&
    (line.denialAppliedAt != null || line.denialError != null)
  );
}

/** A denied line whose posting is confirmed and whose denial step has not completed: safe to (re)run. */
export function isDenialPending(line: DenialPendingLineLike): boolean {
  return (
    isPostingConfirmed(line) &&
    isDeniedRemittanceLine(line) &&
    line.denialAppliedAt == null &&
    line.denialError != null
  );
}

/**
 * A matched line this flow cannot vouch for: no post-success marker (a
 * failed or crashed post, a pre-payment autoPostedAt left behind by a
 * crash or a failed rollback, any line from before the markers existed).
 * Never applied, retried or reposted automatically; the biller reconciles
 * existing payments first.
 */
export function isLineNeedingReview(line: DenialPendingLineLike): boolean {
  if (line.status !== 'matched' || line.claimId == null) return false;
  return !isPostingConfirmed(line);
}

export const NEEDS_REVIEW_TEXT =
  "Could not confirm this line's posting. Reconcile existing payments before adding or re-matching anything.";
