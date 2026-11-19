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

export interface ApplyDenialResult {
  claimId: number;
  /** The claim's status became 'denied'. */
  denied: boolean;
  denialReason: string;
  /** Why the claim was left in its status, when it was. */
  skippedReason?: 'not_denied' | 'claim_not_found' | 'claim_has_payments' | 'already_denied';
  pipeline?: { appealCreated: boolean; appealId?: number; followUpCreated: boolean; error?: string };
}

/**
 * Apply a denied remittance line to its claim. Call AFTER postPayment, which
 * owns paidAmount and sets paid/partial when money arrived; a denial of one
 * line on a claim another line paid keeps that status and only gets a
 * timeline note. Idempotent: a claim already denied is not re-processed.
 */
export async function applyRemittanceDenial(
  practiceId: number,
  claimId: number,
  line: RemittanceLineLike,
  opts: ApplyDenialOptions,
): Promise<ApplyDenialResult> {
  const denialReason = denialReasonForLine(line);
  const result: ApplyDenialResult = { claimId, denied: false, denialReason };

  if (!isDeniedRemittanceLine(line)) {
    result.skippedReason = 'not_denied';
    return result;
  }

  const claim = await storage.getClaim(claimId);
  if (!claim || claim.practiceId !== practiceId) {
    result.skippedReason = 'claim_not_found';
    logger.warn('ERA denial: claim not found for practice', { practiceId, claimId, remittanceId: opts.remittanceId });
    return result;
  }

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

  if (claim.status === 'paid' || claim.status === 'partial') {
    // Money was recorded on this claim (this line or another), so the
    // claim is not denied as a whole. Keep the fact visible on the timeline.
    result.skippedReason = 'claim_has_payments';
    await recordClaimEvent({
      claimId,
      practiceId,
      eventType: 'note_added',
      summary: `ERA denied ${line.cptCode ? `line ${line.cptCode}` : 'a line'}: ${clip(denialReason)} (claim stays ${claim.status}; other lines paid)`,
      metadata: { ...baseMetadata, previousStatus: claim.status, statusChanged: false },
      createdBy: opts.postedBy ?? null,
    });
    return result;
  }

  if (claim.status === 'denied') {
    result.skippedReason = 'already_denied';
    return result;
  }

  await storage.updateClaim(claimId, { status: 'denied', denialReason } as any);
  result.denied = true;

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

  // Appeal draft + denial_appeal follow-up, same as the Deny button and the
  // 277 poller. Its failures are reported, never thrown: the denial itself
  // is already on the claim.
  try {
    const pipeline = await processDeniedClaim(claimId);
    result.pipeline = {
      appealCreated: pipeline.appealCreated,
      appealId: pipeline.appealId,
      followUpCreated: pipeline.followUpCreated,
      error: pipeline.error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('ERA denial: denial pipeline failed', { claimId, error: message });
    result.pipeline = { appealCreated: false, followUpCreated: false, error: message };
  }

  return result;
}
