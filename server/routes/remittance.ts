/**
 * Remittance Routes (ERA/835 Processing)
 *
 * Handles:
 * - POST   /api/remittance/upload          - Upload & parse 835 file or JSON remittance data
 * - GET    /api/remittance                 - List remittance records (paginated)
 * - GET    /api/remittance/:id             - Get remittance detail with line items
 * - POST   /api/remittance/:id/auto-match  - Auto-match line items to claims
 * - POST   /api/remittance/:id/line-items/:lineItemId/match - Manual match a line item to a claim
 */

import { Router, type Response } from 'express';
import { isAuthenticated } from '../replitAuth';
import { parsePagination, paginatedResponse } from '../utils/pagination';
import { parse835, flattenToLineItems } from '../services/edi835Parser';
import { assessUnderpayment } from '../services/underpaymentAnalyzer';
import { postPayment } from '../services/paymentPostingService';
import { ensureUnderpaymentFollowUp } from '../services/underpaymentPipelineService';
import { autoMatchRemittance } from '../services/eraAutoMatchService';
import { ingestRemittance } from '../services/remittanceIngestionService';
import {
  applyRemittanceDenialToLine,
  DENIAL_PENDING_MARKER,
  POSTING_CONFIRMED_MARKER,
  isDenialPending,
  isDeniedRemittanceLine,
  isLineNeedingReview,
  isPostingConfirmed,
  NEEDS_REVIEW_TEXT,
  postingReasonFields,
  type ApplyDenialResult,
} from '../services/eraDenialService';
import { needsTransmissionEvidence, transmissionEvidence } from '../services/claimTransmissionEvidence';
import { db } from '../db';
import {
  remittanceAdvice,
  remittanceLineItems,
  claims,
  claimEvents,
  claimLineItems,
  cptCodes,
  patients,
  feeSchedules,
} from '@shared/schema';
import { eq, and, desc, count, sql, ilike, or, lte, gte, inArray } from 'drizzle-orm';
import { storage } from '../storage';
import logger from '../services/logger';
import { encryptRemittanceLineItem, decryptRemittanceLineItem, decryptField } from '../services/phiEncryptionService';

const router = Router();

// Safe error response helper
const safeErrorResponse = (res: Response, statusCode: number, publicMessage: string, error?: any) => {
  if (error) {
    logger.error(publicMessage, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
  return res.status(statusCode).json({ message: publicMessage });
};

// Helper to get authorized practiceId from request
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) {
    return req.authorizedPracticeId;
  }
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;

  if (userRole === 'admin' && req.isPlatformAdmin) {
    return requestedPracticeId || userPracticeId || 1;
  }

  if (!userPracticeId) {
    throw new Error('User not assigned to a practice. Contact administrator.');
  }

  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    return userPracticeId;
  }

  return userPracticeId;
};

// ==================== POST /upload ====================
// Accept either raw X12 835 text or JSON remittance data
router.post('/upload', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const contentType = req.headers['content-type'] || '';

    let parsedData: any;
    let rawDataForStorage: any;
    let payerName: string;
    let payerId: string | null;
    let checkNumber: string | null;
    let checkDate: string | null;
    let totalPaymentAmount: number;
    let lineItemsData: any[];

    if (contentType.includes('text/plain') || (typeof req.body === 'string') || req.body?.rawEdi) {
      // X12 835 EDI format
      const rawEdi = typeof req.body === 'string' ? req.body : (req.body.rawEdi || '');
      if (!rawEdi || rawEdi.trim().length === 0) {
        return res.status(400).json({ message: 'Empty 835 EDI data provided' });
      }

      try {
        parsedData = parse835(rawEdi);
      } catch (parseError) {
        return safeErrorResponse(res, 400, 'Failed to parse 835 EDI data. Ensure the file is valid X12 835 format.', parseError);
      }

      rawDataForStorage = parsedData;
      payerName = parsedData.payment.payerName || 'Unknown Payer';
      payerId = parsedData.payment.payerId || null;
      checkNumber = parsedData.payment.checkNumber || null;
      checkDate = parsedData.payment.checkDate || null;
      totalPaymentAmount = parsedData.payment.totalAmount;
      lineItemsData = flattenToLineItems(parsedData);

    } else {
      // JSON remittance data
      const body = req.body;
      if (!body || !body.payerName) {
        return res.status(400).json({ message: 'Missing required fields. Provide payerName, totalPaymentAmount, and lineItems.' });
      }

      payerName = body.payerName;
      payerId = body.payerId || null;
      checkNumber = body.checkNumber || null;
      checkDate = body.checkDate || null;
      totalPaymentAmount = parseFloat(body.totalPaymentAmount) || 0;
      rawDataForStorage = body;
      lineItemsData = (body.lineItems || []).map((item: any) => ({
        patientName: item.patientName || 'Unknown',
        memberId: item.memberId || null,
        claimReference: item.claimReference || null,
        payerClaimId: item.payerClaimId || null,
        claimStatusCode: item.claimStatusCode != null && item.claimStatusCode !== '' ? String(item.claimStatusCode) : null,
        serviceDate: item.serviceDate || null,
        cptCode: item.cptCode || null,
        chargedAmount: parseFloat(item.chargedAmount) || 0,
        allowedAmount: item.allowedAmount != null ? parseFloat(item.allowedAmount) : null,
        paidAmount: parseFloat(item.paidAmount) || 0,
        adjustmentAmount: parseFloat(item.adjustmentAmount) || 0,
        patientResponsibility: item.patientResponsibility != null ? parseFloat(item.patientResponsibility) : null,
        contractualAdjustment: item.contractualAdjustment != null ? parseFloat(item.contractualAdjustment) : null,
        adjustmentReasonCodes: item.adjustmentReasonCodes || [],
        remarkCodes: item.remarkCodes || [],
      }));
    }

    // Idempotency, duplicate detection and insertion all live in
    // remittanceIngestionService, shared with the automated ERA poller. Two
    // ingestion paths would drift, and the half that drifted would be the
    // idempotency — the half that decides whether money is recorded twice.
    const outcome = await ingestRemittance(
      practiceId,
      {
        payerName,
        payerId,
        checkNumber,
        checkDate,
        totalPaymentAmount,
        lineItems: lineItemsData as any,
      },
      {
        rawData: rawDataForStorage,
        allowDuplicateCheck: !!req.body?.allowDuplicateCheck,
        encryptLineItem: encryptRemittanceLineItem,
      },
    );

    if (outcome.status === 'duplicate') {
      const messages = {
        transaction_id: 'This remittance has already been ingested from the clearinghouse.',
        file_hash: 'This remittance has already been uploaded — its payments are already recorded.',
        check_number:
          `Check ${checkNumber} from ${payerName} is already recorded. ` +
          'Re-send with allowDuplicateCheck to record it anyway.',
      } as const;
      return res.status(409).json({
        message: messages[outcome.reason],
        code: outcome.reason === 'check_number' ? 'duplicate_check_number' : 'duplicate_remittance',
        existingRemittanceId: outcome.remittanceId,
      });
    }

    // Fetch the inserted record with line items
    const result = await db.query.remittanceAdvice.findFirst({
      where: eq(remittanceAdvice.id, outcome.remittanceId),
      with: { lineItems: true },
    });

    if (result?.lineItems) {
      result.lineItems = result.lineItems.map(decryptRemittanceLineItem) as any;
    }
    res.status(201).json(result);
  } catch (error) {
    return safeErrorResponse(res, 500, 'Failed to process remittance upload', error);
  }
});

// ==================== GET / ====================
// List remittance records with pagination
router.get('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { page, limit, offset } = parsePagination(req.query);
    const statusFilter = req.query.status as string | undefined;

    // Build conditions
    const conditions = [eq(remittanceAdvice.practiceId, practiceId)];
    if (statusFilter && statusFilter !== 'all') {
      conditions.push(eq(remittanceAdvice.status, statusFilter));
    }

    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

    // Get total count
    const [totalResult] = await db
      .select({ count: count() })
      .from(remittanceAdvice)
      .where(whereClause);

    const total = totalResult?.count || 0;

    // Get paginated results
    const results = await db
      .select()
      .from(remittanceAdvice)
      .where(whereClause)
      .orderBy(desc(remittanceAdvice.createdAt))
      .limit(limit)
      .offset(offset);

    // For each remittance, get line item counts
    const enriched = await Promise.all(
      results.map(async (r: any) => {
        const [lineItemCount] = await db
          .select({ total: count(), matched: count(remittanceLineItems.claimId) })
          .from(remittanceLineItems)
          .where(eq(remittanceLineItems.remittanceId, r.id));

        return {
          ...r,
          lineItemCount: lineItemCount?.total || 0,
          matchedCount: lineItemCount?.matched || 0,
        };
      })
    );

    if (!req.query.page && !req.query.limit) {
      res.json(enriched);
    } else {
      res.json(paginatedResponse(enriched, total, page, limit));
    }
  } catch (error) {
    return safeErrorResponse(res, 500, 'Failed to fetch remittance records', error);
  }
});

// ==================== GET /:id ====================
// Get remittance detail with line items
router.get('/:id', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid remittance ID' });
    }

    const result = await db.query.remittanceAdvice.findFirst({
      where: and(
        eq(remittanceAdvice.id, id),
        eq(remittanceAdvice.practiceId, practiceId),
      ),
      with: {
        lineItems: true,
      },
    });

    if (!result) {
      return res.status(404).json({ message: 'Remittance record not found' });
    }

    if (result.lineItems) {
      // Per matched line: whether its posting was confirmed by this flow and
      // whether it needs manual review (never inferred from amounts or other
      // postings), so the page can show "Denial pending" apart from "Needs
      // manual review".
      result.lineItems = (result.lineItems.map(decryptRemittanceLineItem) as any[]).map((li: any) => ({
        ...li,
        postingConfirmed: li.status === 'matched' ? isPostingConfirmed(li) : null,
        needsReview: isLineNeedingReview(li),
        denialPending: isDenialPending(li),
      })) as any;
    }
    res.json(result);
  } catch (error) {
    return safeErrorResponse(res, 500, 'Failed to fetch remittance detail', error);
  }
});

// ==================== POST /:id/auto-match ====================
// Auto-match line items to claims by patient name + service date + CPT code
router.post('/:id/auto-match', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid remittance ID' });
    }

    // Delegates to eraAutoMatchService so this button and the automated ERA
    // poller run identical matching and posting logic.
    const result = await autoMatchRemittance(practiceId, id, req.user?.claims?.sub ?? null);

    if (!result) {
      return res.status(404).json({ message: 'Remittance record not found' });
    }

    const reviewNote =
      result.needsReview > 0
        ? ` ${result.needsReview} line item(s) need manual review.`
        : '';
    const denialNote =
      (result.denialFailures.length > 0
        ? ` ${result.denialFailures.length} payer denial(s) could not be applied to their claim (payments are recorded); use the line's Retry denial button or run Auto-Match again.`
        : result.denialsApplied > 0
          ? ` ${result.denialsApplied} payer denial(s) applied to their claim.`
          : '') +
      (result.linesNeedingReview.length > 0
        ? ` ${result.linesNeedingReview.length} matched line(s) need manual review: their posting could not be confirmed by this flow, so nothing was applied to them.`
        : '');
    // No early return on total === 0: autoMatchRemittance has already retried
    // any pending denials, and that outcome must be reported (#497 review).
    res.json({
      message:
        result.total === 0
          ? `No unmatched line items to process.${denialNote}`
          : result.postingFailures.length > 0
            ? `Auto-matching complete: ${result.matched} line item(s) matched and ${result.posted} payment(s) recorded, ` +
              `but ${result.postingFailures.length} payment(s) could not be recorded — review before relying on these totals.` +
              reviewNote + denialNote
            : `Auto-matching complete: ${result.matched} line item(s) matched, ${result.posted} payment(s) recorded.` +
              reviewNote + denialNote,
      matched: result.matched,
      posted: result.posted,
      denialsApplied: result.denialsApplied,
      denialFailures: result.denialFailures,
      linesNeedingReview: result.linesNeedingReview,
      needsReview: result.needsReview,
      // Non-empty means money was matched but NOT recorded — must not be
      // presented as a clean success.
      postingFailures: result.postingFailures,
      total: result.total,
      results: result.results,
    });
  } catch (error) {
    return safeErrorResponse(res, 500, 'Failed to auto-match remittance line items', error);
  }
});

/**
 * One truthful description of what happened to a denied line's claim, for
 * the manual match and retry-denial routes. Says only what the pipeline
 * reported: an appeal drafted vs an existing one kept vs none; a follow-up
 * added vs not created (one may already exist) vs the step not run. On a
 * failure it is a partial success with the retry path, never "an appeal was
 * drafted".
 */
function describeDenialOutcome(
  denial: ApplyDenialResult | null,
  claimLabel: string,
  lead: string,
): { message: string; partial: boolean; denialBlock: Record<string, unknown> | null } {
  if (!denial) {
    return { message: lead, partial: false, denialBlock: null };
  }
  const denialBlock = {
    applied: denial.applied,
    alreadyApplied: false,
    statusChanged: denial.denied,
    claimStatus: denial.claimStatus,
    skippedReason: denial.skippedReason ?? null,
    pipelineRan: denial.pipeline.ran,
    appealCreated: denial.pipeline.appealCreated,
    appealReused: denial.pipeline.appealReused,
    appealId: denial.pipeline.appealId ?? null,
    followUpCreated: denial.pipeline.followUpCreated,
    error: denial.pipeline.error ?? null,
    persistenceError: denial.persistenceError ?? null,
  };
  if (!denial.applied) {
    const what = denial.denied || denial.claimStatus === 'denied'
      ? `claim ${claimLabel} is marked Denied (${denial.denialReason}), but the appeal draft / follow-up step failed`
      : denial.persistenceError && denial.claimStatus
        ? `claim ${claimLabel} is ${denial.claimStatus}, but the outcome could not be recorded on the remittance line`
        : `the payer's denial could not be applied to claim ${claimLabel}`;
    return {
      message:
        `${lead} However ${what}: ${denial.pipeline.error ?? denial.skippedReason ?? 'unknown error'}. ` +
        'Use the line\'s Retry denial button to retry the denial step; it never posts the payment again.',
      partial: true,
      denialBlock,
    };
  }
  if (denial.skippedReason === 'claim_has_payments') {
    return { message: `${lead} The payer denied this line; claim ${claimLabel} keeps its ${denial.claimStatus} status because other lines were paid.`, partial: false, denialBlock };
  }
  if (denial.skippedReason === 'claim_reopened') {
    return { message: `${lead} The payer denied the earlier submission (${denial.denialReason}); claim ${claimLabel} stays a draft while you correct it.`, partial: false, denialBlock };
  }
  if (!denial.pipeline.ran && denial.claimStatus === 'appeal') {
    return {
      message: `${lead} The payer denied claim ${claimLabel} (${denial.denialReason}); the claim is already under appeal, so the appeal draft and follow-up steps did not run.`,
      partial: false,
      denialBlock,
    };
  }
  const statusText = denial.denied
    ? 'is now Denied'
    : `was already ${denial.claimStatus === 'denied' ? 'Denied' : denial.claimStatus}`;
  const appealText = denial.pipeline.appealCreated
    ? `an appeal was drafted${denial.pipeline.appealId ? ` (#${denial.pipeline.appealId})` : ''}`
    : denial.pipeline.appealReused
      ? `the existing appeal${denial.pipeline.appealId ? ` #${denial.pipeline.appealId}` : ''} was kept`
      : 'no appeal was drafted';
  const followUpText = !denial.pipeline.ran
    ? 'the follow-up step was not run'
    : denial.pipeline.followUpCreated
      ? 'a denial follow-up was added to the work queue'
      : 'no new follow-up was created (one may already exist)';
  return {
    message: `${lead} The payer denied claim ${claimLabel} (${denial.denialReason}); it ${statusText}, ${appealText}, and ${followUpText}.`,
    partial: false,
    denialBlock,
  };
}

// ==================== POST /:id/line-items/:lineItemId/retry-denial ====================
// Re-run ONLY the denial step for a posted, denied (CLP02 4) line whose
// claim status / appeal / follow-up did not go through. Never posts money:
// the line must already have its payment recorded (isLinePaymentRecorded,
// and an active ERA posting on the claim) or it is refused.
router.post('/:id/line-items/:lineItemId/retry-denial', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const remittanceId = parseInt(req.params.id, 10);
    const lineItemId = parseInt(req.params.lineItemId, 10);
    if (isNaN(remittanceId) || isNaN(lineItemId)) {
      return res.status(400).json({ message: 'Invalid remittance or line item ID' });
    }

    const remittance = await db.query.remittanceAdvice.findFirst({
      where: and(eq(remittanceAdvice.id, remittanceId), eq(remittanceAdvice.practiceId, practiceId)),
    });
    if (!remittance) {
      return res.status(404).json({ message: 'Remittance record not found' });
    }

    const [lineItem] = await db
      .select()
      .from(remittanceLineItems)
      .where(and(eq(remittanceLineItems.id, lineItemId), eq(remittanceLineItems.remittanceId, remittanceId)));
    if (!lineItem) {
      return res.status(404).json({ message: 'Line item not found' });
    }

    if (!isDeniedRemittanceLine(lineItem as any)) {
      return res.status(400).json({ message: 'This line is not a payer denial (835 claim status is not 4); there is no denial to apply.', code: 'not_a_denial' });
    }
    if (lineItem.status !== 'matched' || lineItem.claimId == null) {
      return res.status(400).json({ message: 'This line is not matched to a claim yet. Match it first; the denial is applied as part of matching.', code: 'line_not_matched' });
    }
    const [claim] = await db
      .select({ id: claims.id, claimNumber: claims.claimNumber, practiceId: claims.practiceId })
      .from(claims)
      .where(and(eq(claims.id, lineItem.claimId), eq(claims.practiceId, practiceId)));
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found in this practice' });
    }
    const label = claim.claimNumber || String(claim.id);
    if ((lineItem as any).denialAppliedAt != null) {
      return res.json({
        message: `Line is matched to claim ${label}; its payment was already recorded and is not posted again. The payer's denial was already applied; nothing to retry.`,
        lineItemId,
        claimId: lineItem.claimId,
        partial: false,
        denial: { applied: true, alreadyApplied: true },
      });
    }
    // Money first, always: this route acts ONLY on a line carrying the
    // "denial pending" marker, which the match flow wrote right after that
    // line's own postPayment succeeded. Nothing is inferred from matchType,
    // amounts, dates, check numbers or other postings; a failed or crashed
    // manual post, or a line from before the marker existed, fails closed.
    if (!isDenialPending(lineItem as any)) {
      return res.status(409).json({
        message: `This line's denial cannot be applied. ${NEEDS_REVIEW_TEXT}`,
        code: 'line_not_confirmed',
        needsReview: true,
      });
    }

    const lead = `Line is matched to claim ${label}; its payment was already recorded and is not posted again.`;

    const outcome = await applyRemittanceDenialToLine(practiceId, lineItem as any, {
      remittanceId,
      payerName: remittance.payerName,
      checkNumber: remittance.checkNumber ?? null,
      postedBy: req.user?.claims?.sub ?? null,
    });

    if (outcome.applied) {
      // The remittance may now be complete.
      const allItems = (await db.select().from(remittanceLineItems).where(eq(remittanceLineItems.remittanceId, remittanceId))) as any[];
      const done =
        allItems.every((item: any) => item.status === 'matched') &&
        allItems.every((item: any) => isPostingConfirmed(item)) &&
        !allItems.some((item: any) => isDenialPending(item) || isLineNeedingReview(item));
      if (done) {
        await db.update(remittanceAdvice).set({ status: 'processed', processedAt: new Date() }).where(eq(remittanceAdvice.id, remittanceId));
      }
    }

    const { message, denialBlock, partial } = describeDenialOutcome(outcome, label, lead);
    res.json({
      message,
      lineItemId,
      claimId: lineItem.claimId,
      partial,
      denied: outcome.denied,
      claimStatus: outcome.claimStatus,
      denialReason: outcome.denialReason,
      denial: denialBlock,
    });
  } catch (error) {
    return safeErrorResponse(res, 500, 'Failed to retry the denial', error);
  }
});

// ==================== POST /:id/line-items/:lineItemId/match ====================
// Manually match a line item to a claim
router.post('/:id/line-items/:lineItemId/match', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const remittanceId = parseInt(req.params.id, 10);
    const lineItemId = parseInt(req.params.lineItemId, 10);
    const { claimId } = req.body;

    if (isNaN(remittanceId) || isNaN(lineItemId)) {
      return res.status(400).json({ message: 'Invalid remittance or line item ID' });
    }

    if (!claimId) {
      return res.status(400).json({ message: 'claimId is required' });
    }

    const targetClaimId = parseInt(claimId, 10);
    if (isNaN(targetClaimId)) {
      return res.status(400).json({ message: 'Invalid claimId' });
    }

    // Verify remittance belongs to practice
    const remittance = await db.query.remittanceAdvice.findFirst({
      where: and(
        eq(remittanceAdvice.id, remittanceId),
        eq(remittanceAdvice.practiceId, practiceId),
      ),
    });

    if (!remittance) {
      return res.status(404).json({ message: 'Remittance record not found' });
    }

    // Verify line item belongs to this remittance
    const [lineItem] = await db
      .select()
      .from(remittanceLineItems)
      .where(
        and(
          eq(remittanceLineItems.id, lineItemId),
          eq(remittanceLineItems.remittanceId, remittanceId),
        )
      );

    if (!lineItem) {
      return res.status(404).json({ message: 'Line item not found' });
    }

    // Verify claim belongs to practice
    const [claim] = await db
      .select()
      .from(claims)
      .where(and(eq(claims.id, targetClaimId), eq(claims.practiceId, practiceId)));

    if (!claim) {
      return res.status(404).json({ message: 'Claim not found in this practice' });
    }

    // A payer cannot have adjudicated a claim that was never sent. Auto-match
    // excludes draft/held claims outright; this route used to accept them,
    // so a remittance could land on a Draft that then carried a payment or a
    // denial it could never have received (demo billing test 2026-11-19).
    // But 'held' is not "never sent": the submit route holds a claim the
    // clearinghouse rejected, or one that was SENT but unconfirmed ("DO NOT
    // RESUBMIT"), and a reopened draft was filed before. For those an ERA is
    // the evidence that settles it, so the refusal needs local evidence of
    // a transmission to be absent — and absence of local evidence is not
    // proof the claim was never filed (it may have been filed outside
    // TherapyBill), so the message says to verify, never to send.
    if (needsTransmissionEvidence(claim.status)) {
      const submittedEvents = await db
        .select({ eventType: claimEvents.eventType })
        .from(claimEvents)
        .where(and(eq(claimEvents.claimId, targetClaimId), eq(claimEvents.eventType, 'submitted')));
      const evidence = transmissionEvidence(claim as any, submittedEvents as any[]);
      if (!evidence.transmitted) {
        return res.status(400).json({
          message:
            `Claim ${claim.claimNumber || claim.id} is ${claim.status} and TherapyBill has no record of it being sent to a payer ` +
            '(no submission date, no clearinghouse attempt, no "submitted" event), so this remittance cannot be matched to it. ' +
            'If it was filed outside TherapyBill, mark it submitted and match again. Otherwise verify whether it was ever filed ' +
            'before taking any send action.',
          code: 'claim_not_submitted',
          claimStatus: claim.status,
        });
      }
      logger.info('Manual ERA match onto a non-filed claim with transmission evidence', {
        claimId: targetClaimId,
        claimStatus: claim.status,
        signal: evidence.signal,
      });
    }

    // A line already matched to ANOTHER claim is not re-pointed here. There
    // is no supported unmatch/reassign flow; say so plainly.
    if (lineItem.claimId != null && lineItem.claimId !== targetClaimId) {
      const confirmed = isPostingConfirmed(lineItem as any);
      const moneyText = confirmed ? 'its posting is confirmed on that claim' : "its posting could not be confirmed (reconcile existing payments before changing anything)";
      return res.status(409).json({
        message:
          `This line is already matched to claim ${lineItem.claimId} and ${moneyText}. ` +
          'Reassigning a matched line to a different claim is not supported here; it stays with that claim.',
        code: 'line_already_matched',
        matchedClaimId: lineItem.claimId,
        postingConfirmed: confirmed,
      });
    }

    // Update line item. matchType 'manual' marks this as a human decision:
    // auto-match never re-decides or overwrites it, and the auto path never
    // posts it (this route records the payment itself, below).
    await db
      .update(remittanceLineItems)
      .set({
        claimId: targetClaimId,
        status: 'matched',
        matchType: 'manual',
        matchedAt: new Date(),
        matchReviewReason: null,
      })
      .where(eq(remittanceLineItems.id, lineItemId));

    // Record the payment. postPayment owns claim.paidAmount and status (it
    // sums non-reversed postings), and writes the payment_postings row that
    // A/R, patient statements and the collections basis all read from.
    const paidAmt = parseFloat(String(lineItem.paidAmount || '0'));
    await postPayment(practiceId, {
      // Authoritative: supersedes any 277-derived posting on this claim.
      source: 'era',
      claimId: targetClaimId,
      payerName: remittance.payerName,
      checkNumber: remittance.checkNumber ?? null,
      paymentDate: remittance.checkDate ?? remittance.receivedDate,
      paymentAmount: String(paidAmt.toFixed(2)),
      adjustmentAmount: String(parseFloat(String(lineItem.adjustmentAmount || '0')).toFixed(2)),
      patientResponsibility: String(
        parseFloat(String((lineItem as any).patientResponsibility ?? '0')).toFixed(2),
      ),
      allowedAmount: lineItem.allowedAmount != null ? String(lineItem.allowedAmount) : null,
      // CARC / RARC on the posting, so the Payments tab says WHY an amount
      // was adjusted instead of showing a bare write-off.
      ...postingReasonFields(lineItem as any),
      postedBy: req.user?.claims?.sub ?? null,
    } as any);

    // A denied line (CLP02 4) marks the claim denied with the CARC as the
    // reason and runs the appeal draft + follow-up. After postPayment: it
    // owns paidAmount and the paid/partial status. The outcome is recorded
    // on the line (denialAppliedAt / denialError) and reported truthfully
    // below; a failure leaves the denial pending for the line's Retry
    // denial button (or Auto-Match), which never posts the payment again.
    // postPayment returned for THIS line: that is the proof of payment.
    // Write the durable post-success marker now, in the same flow: the
    // "denial pending" marker for a denied line (the denial step and any
    // retry act only on it), the posting-confirmed marker otherwise.
    // autoPostedAt is set as well so the auto path never considers the line
    // again, but it is not the proof. Nothing is ever inferred from
    // matchType, amounts, dates, check numbers or other postings. If this
    // write fails, the payment IS recorded but the line shows "needs manual
    // review" rather than being guessed at. A marker proves this historical
    // post succeeded, not that the payment is still unreversed.
    const isDenial = isDeniedRemittanceLine(lineItem as any);
    let postingConfirmed = false;
    let markerError: string | null = null;
    try {
      await db
        .update(remittanceLineItems)
        .set({ autoPostedAt: new Date(), denialError: isDenial ? DENIAL_PENDING_MARKER : POSTING_CONFIRMED_MARKER, denialAppliedAt: null })
        .where(eq(remittanceLineItems.id, lineItemId));
      postingConfirmed = true;
    } catch (error) {
      markerError = error instanceof Error ? error.message : String(error);
      logger.error('Manual ERA match: payment recorded but the posting-confirmed marker could not be written', {
        remittanceId,
        lineItemId,
        claimId: targetClaimId,
        error: markerError,
      });
    }

    const denialLine = {
      ...(lineItem as any),
      claimId: targetClaimId,
      status: 'matched',
      matchType: 'manual',
      autoPostedAt: postingConfirmed ? new Date() : (lineItem as any).autoPostedAt ?? null,
      denialError: postingConfirmed ? (isDenial ? DENIAL_PENDING_MARKER : POSTING_CONFIRMED_MARKER) : (lineItem as any).denialError ?? null,
    };
    let denial: ApplyDenialResult | null = null;
    if (isDenial && isDenialPending(denialLine)) {
      denial = await applyRemittanceDenialToLine(practiceId, denialLine, {
        remittanceId,
        payerName: remittance.payerName,
        checkNumber: remittance.checkNumber ?? null,
        postedBy: req.user?.claims?.sub ?? null,
      });
    }

    // 'processed' means done: every line matched, every line's posting
    // confirmed by this flow, and no denied line pending or needing review.
    const allItems = (await db
      .select()
      .from(remittanceLineItems)
      .where(eq(remittanceLineItems.remittanceId, remittanceId))) as any[];
    const allMatched = allItems.every((item: any) => item.status === 'matched');
    const allConfirmed = allItems.every((item: any) => isPostingConfirmed(item));
    const noDenialWaiting = !allItems.some((item: any) => isDenialPending(item) || isLineNeedingReview(item));

    if (allMatched && allConfirmed && noDenialWaiting) {
      await db
        .update(remittanceAdvice)
        .set({ status: 'processed', processedAt: new Date() })
        .where(eq(remittanceAdvice.id, remittanceId));
    }

    const label = claim.claimNumber || String(claim.id);
    const described = !postingConfirmed
      ? {
          message:
            `Line matched to claim ${label} and the payment was recorded, but the line's posting-confirmed marker could not be written (${markerError}). ` +
            `${NEEDS_REVIEW_TEXT}${isDenial ? " The payer's denial was NOT applied." : ''}`,
          partial: true,
          denialBlock: isDenial ? { applied: false, needsReview: true } : null,
        }
      : describeDenialOutcome(denial, label, denial ? `Line matched to claim ${label}. Payment recorded.` : 'Line item matched to claim successfully');
    const { message, denialBlock, partial } = described;

    res.json({
      message,
      lineItemId,
      claimId: targetClaimId,
      postingConfirmed,
      needsReview: !postingConfirmed,
      partial,
      denied: Boolean(denial?.denied),
      claimStatus: denial?.claimStatus ?? null,
      denialReason: denial && denial.skippedReason !== 'not_denied' ? denial.denialReason : null,
      denial: denialBlock,
    });
  } catch (error) {
    return safeErrorResponse(res, 500, 'Failed to manually match line item', error);
  }
});

// ==================== GET /claims/search ====================
// Search claims for manual matching (by patient name)
/**
 * Claim search for the manual ERA match dialog.
 *
 * Patient names are PHI-encrypted at rest (JSON ciphertext in
 * patients.first_name / last_name). This endpoint used to ILIKE those
 * columns, which can never match a typed name, and returned the raw
 * ciphertext objects to the dialog (demo billing test 2026-11-19:
 * "Ethan Example" found nothing; the claim-number hit showed
 * {"ciphertext","iv","tag"} as the patient). Names are now resolved from
 * the practice's decrypted patient list in memory, the claim-number match
 * stays in SQL, and the response carries the decrypted names.
 */
router.get('/claims/search', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    // Guard against parameter tampering: req.query.q may be an array or object
    // if the client sends repeated/structured params. Require a string.
    const searchTerm = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    if (searchTerm.length < 2) {
      return res.json([]);
    }

    // Archived patients included: an ERA can arrive for a patient archived since the visit.
    const practicePatients = await storage.getPatients(practiceId, { archived: 'include' });
    const patientById = new Map<number, { firstName: string | null; lastName: string | null }>();
    const term = searchTerm.toLowerCase();
    const nameMatchIds: number[] = [];
    for (const p of practicePatients as any[]) {
      patientById.set(p.id, { firstName: p.firstName ?? null, lastName: p.lastName ?? null });
      const full = `${p.firstName ?? ''} ${p.lastName ?? ''}`.toLowerCase();
      if (full.includes(term) || `${p.lastName ?? ''}, ${p.firstName ?? ''}`.toLowerCase().includes(term)) {
        nameMatchIds.push(p.id);
      }
    }

    const matchers = [ilike(claims.claimNumber, `%${searchTerm}%`)];
    if (nameMatchIds.length > 0) matchers.push(inArray(claims.patientId, nameMatchIds));

    const rows = await db
      .select({
        id: claims.id,
        claimNumber: claims.claimNumber,
        patientId: claims.patientId,
        totalAmount: claims.totalAmount,
        status: claims.status,
        createdAt: claims.createdAt,
      })
      .from(claims)
      .where(and(eq(claims.practiceId, practiceId), or(...matchers)))
      .orderBy(desc(claims.createdAt))
      .limit(20);

    res.json(
      rows.map((r: any) => ({
        id: r.id,
        claimNumber: r.claimNumber,
        patientId: r.patientId,
        patientFirstName: patientById.get(r.patientId)?.firstName ?? null,
        patientLastName: patientById.get(r.patientId)?.lastName ?? null,
        totalAmount: r.totalAmount,
        status: r.status,
        createdAt: r.createdAt,
      })),
    );
  } catch (error) {
    return safeErrorResponse(res, 500, 'Failed to search claims', error);
  }
});

export default router;
