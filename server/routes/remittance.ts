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
import { applyRemittanceDenialToLine, isDeniedRemittanceLine, postingReasonFields } from '../services/eraDenialService';
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
      result.lineItems = result.lineItems.map(decryptRemittanceLineItem) as any;
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

    if (result.total === 0) {
      return res.json({ message: 'No unmatched line items to process', matched: 0, posted: 0, total: 0 });
    }

    const reviewNote =
      result.needsReview > 0
        ? ` ${result.needsReview} line item(s) need manual review.`
        : '';
    const denialNote =
      result.denialFailures.length > 0
        ? ` ${result.denialFailures.length} payer denial(s) could not be applied to their claim (payments are recorded); run Auto-Match again to retry.`
        : result.denialsApplied > 0
          ? ` ${result.denialsApplied} payer denial(s) applied to their claim.`
          : '';
    res.json({
      message:
        result.postingFailures.length > 0
          ? `Auto-matching complete: ${result.matched} line item(s) matched and ${result.posted} payment(s) recorded, ` +
            `but ${result.postingFailures.length} payment(s) could not be recorded — review before relying on these totals.` +
            reviewNote + denialNote
          : `Auto-matching complete: ${result.matched} line item(s) matched, ${result.posted} payment(s) recorded.` +
            reviewNote + denialNote,
      matched: result.matched,
      posted: result.posted,
      denialsApplied: result.denialsApplied,
      denialFailures: result.denialFailures,
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
    // the evidence that settles it, so the refusal needs proof the claim was
    // never transmitted — and never tells the biller to resubmit.
    if (needsTransmissionEvidence(claim.status)) {
      const submittedEvents = await db
        .select({ eventType: claimEvents.eventType })
        .from(claimEvents)
        .where(and(eq(claimEvents.claimId, targetClaimId), eq(claimEvents.eventType, 'submitted')));
      const evidence = transmissionEvidence(claim as any, submittedEvents as any[]);
      if (!evidence.transmitted) {
        return res.status(400).json({
          message:
            `Claim ${claim.claimNumber || claim.id} is ${claim.status} and has never been sent to a payer, so a remittance ` +
            'cannot be matched to it. Submit the claim first (or mark it submitted if it was filed outside TherapyBill), then match.',
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

    // Idempotency (#497 review). This request has two durable steps — the
    // payment posting and, for a denied line, the denial on the claim — and
    // a failure after the first must not make a retry repeat it. postedAt
    // is the posting's marker: set before postPayment, cleared if it fails
    // (the auto path's autoPostedAt bias: "posting missed and flagged" over
    // "posting recorded twice"). A line already posted to this claim skips
    // straight to the denial step; one posted to a DIFFERENT claim is
    // refused rather than silently re-pointed with money behind it.
    const alreadyPosted = (lineItem as any).postedAt != null;
    if (lineItem.claimId != null && lineItem.claimId !== targetClaimId && (alreadyPosted || lineItem.status === 'matched')) {
      return res.status(409).json({
        message: `This line is already matched to claim ${lineItem.claimId}${alreadyPosted ? ' and its payment is recorded' : ''}. ` +
          'Reverse that posting before matching it elsewhere.',
        code: 'line_already_matched',
        matchedClaimId: lineItem.claimId,
      });
    }

    const postedBy = req.user?.claims?.sub ?? null;
    let postedNow = false;

    if (!alreadyPosted) {
      // Update line item. matchType 'manual' marks this as a human decision:
      // auto-match never re-decides or overwrites it, and the auto path never
      // posts it (this route records the payment itself, below).
      const postedAt = new Date();
      await db
        .update(remittanceLineItems)
        .set({
          claimId: targetClaimId,
          status: 'matched',
          matchType: 'manual',
          matchedAt: new Date(),
          matchReviewReason: null,
          postedAt,
        })
        .where(eq(remittanceLineItems.id, lineItemId));

      // Record the payment. postPayment owns claim.paidAmount and status (it
      // sums non-reversed postings), and writes the payment_postings row that
      // A/R, patient statements and the collections basis all read from.
      const paidAmt = parseFloat(String(lineItem.paidAmount || '0'));
      try {
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
          postedBy,
        } as any);
        postedNow = true;
      } catch (postError) {
        const errorMessage = postError instanceof Error ? postError.message : String(postError);
        logger.error('Manual ERA match: failed to record payment posting', {
          remittanceId,
          lineItemId,
          claimId: targetClaimId,
          error: errorMessage,
        });
        // Nothing was posted: clear the marker so a retry posts. If this
        // clear fails the line looks posted and the money is missed, not
        // doubled — the log above is the flag.
        try {
          await db
            .update(remittanceLineItems)
            .set({ postedAt: null })
            .where(eq(remittanceLineItems.id, lineItemId));
        } catch (clearError) {
          logger.error('Manual ERA match: failed to clear postedAt after posting failure', {
            lineItemId,
            error: clearError instanceof Error ? clearError.message : String(clearError),
          });
        }
        return res.status(502).json({
          message:
            `The line is matched to claim ${claim.claimNumber || claim.id} but the payment was NOT recorded (${errorMessage}). ` +
            'Match it again to retry; nothing has been posted.',
          code: 'posting_failed',
          lineItemId,
          claimId: targetClaimId,
          posted: false,
        });
      }
    }

    // A denied line (CLP02 4) marks the claim denied with the CARC as the
    // reason and runs the appeal draft + follow-up. After postPayment: it
    // owns paidAmount and the paid/partial status. The outcome is recorded
    // on the line (denialAppliedAt / denialError) and reported truthfully
    // below; a failure leaves the denial pending for a retry (match again,
    // or the next auto-match run) that never re-posts the money.
    const denialLine = { ...(lineItem as any), claimId: targetClaimId };
    const denial = isDeniedRemittanceLine(denialLine)
      ? await applyRemittanceDenialToLine(practiceId, denialLine, {
          remittanceId,
          payerName: remittance.payerName,
          checkNumber: remittance.checkNumber ?? null,
          postedBy,
        })
      : null;

    // Check if all line items are now matched
    const allItems = await db
      .select()
      .from(remittanceLineItems)
      .where(eq(remittanceLineItems.remittanceId, remittanceId));

    const allMatched = allItems.every((item: any) => item.status === 'matched');

    if (allMatched) {
      await db
        .update(remittanceAdvice)
        .set({ status: 'processed', processedAt: new Date() })
        .where(eq(remittanceAdvice.id, remittanceId));
    }

    const label = claim.claimNumber || String(claim.id);
    const postingText = postedNow ? 'Payment recorded.' : alreadyPosted ? 'Payment was already recorded; not posted again.' : '';
    let message: string;
    let partial = false;
    if (!denial) {
      message = alreadyPosted ? `Line already matched to claim ${label}. ${postingText}` : 'Line item matched to claim successfully';
    } else if (!denial.applied) {
      partial = true;
      const what = denial.denied || denial.claimStatus === 'denied'
        ? `claim ${label} is marked Denied (${denial.denialReason}), but the appeal draft / follow-up failed`
        : `the payer's denial could not be applied to claim ${label}`;
      message =
        `Line matched. ${postingText} However ${what}: ${denial.pipeline.error ?? denial.skippedReason ?? 'unknown error'}. ` +
        'Match this line again (or run Auto-Match) to retry the denial step; the payment will not be posted twice.';
    } else if (denial.skippedReason === 'claim_has_payments') {
      message = `Line matched. ${postingText} The payer denied this line; claim ${label} keeps its ${denial.claimStatus} status because other lines were paid.`;
    } else if (denial.skippedReason === 'claim_reopened') {
      message = `Line matched. ${postingText} The payer denied the earlier submission (${denial.denialReason}); claim ${label} stays a draft while you correct it.`;
    } else {
      const appealText = denial.pipeline.appealCreated
        ? `an appeal was drafted${denial.pipeline.appealId ? ` (#${denial.pipeline.appealId})` : ''}`
        : denial.pipeline.appealReused
          ? `the existing appeal${denial.pipeline.appealId ? ` #${denial.pipeline.appealId}` : ''} was kept`
          : 'no appeal was drafted';
      const followUpText = denial.pipeline.followUpCreated ? 'a denial follow-up was added to the work queue' : 'the denial follow-up already existed';
      message = `Line matched. ${postingText} The payer denied claim ${label} (${denial.denialReason}); it is ${denial.denied ? 'now' : 'already'} Denied, ${appealText}, and ${followUpText}.`;
    }

    res.json({
      message,
      lineItemId,
      claimId: targetClaimId,
      posted: postedNow,
      alreadyPosted,
      partial,
      denied: Boolean(denial?.denied),
      claimStatus: denial?.claimStatus ?? null,
      denialReason: denial && denial.skippedReason !== 'not_denied' ? denial.denialReason : null,
      denial: denial
        ? {
            applied: denial.applied,
            statusChanged: denial.denied,
            skippedReason: denial.skippedReason ?? null,
            appealCreated: denial.pipeline.appealCreated,
            appealReused: denial.pipeline.appealReused,
            appealId: denial.pipeline.appealId ?? null,
            followUpCreated: denial.pipeline.followUpCreated,
            error: denial.pipeline.error ?? null,
          }
        : null,
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
