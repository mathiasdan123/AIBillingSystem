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
import { eq, and, desc, count, sql, ilike, or, lte, gte } from 'drizzle-orm';
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
      return res.json({ message: 'No unmatched line items to process', matched: 0, total: 0 });
    }

    res.json({
      message:
        result.postingFailures.length > 0
          ? `Auto-matching complete: ${result.matched} of ${result.total} line items matched, ` +
            `but ${result.postingFailures.length} payment(s) could not be recorded — review before relying on these totals.`
          : `Auto-matching complete: ${result.matched} of ${result.total} line items matched`,
      matched: result.matched,
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

    // Update line item
    await db
      .update(remittanceLineItems)
      .set({
        claimId: targetClaimId,
        status: 'matched',
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
      postedBy: req.user?.claims?.sub ?? null,
    } as any);

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

    res.json({
      message: 'Line item matched to claim successfully',
      lineItemId,
      claimId: targetClaimId,
    });
  } catch (error) {
    return safeErrorResponse(res, 500, 'Failed to manually match line item', error);
  }
});

// ==================== GET /claims/search ====================
// Search claims for manual matching (by patient name)
router.get('/claims/search', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    // Guard against parameter tampering: req.query.q may be an array or object
    // if the client sends repeated/structured params. Require a string.
    const searchTerm = typeof req.query.q === 'string' ? req.query.q : '';

    if (searchTerm.length < 2) {
      return res.json([]);
    }

    const results = await db
      .select({
        id: claims.id,
        claimNumber: claims.claimNumber,
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
          or(
            ilike(patients.firstName, `%${searchTerm}%`),
            ilike(patients.lastName, `%${searchTerm}%`),
            ilike(claims.claimNumber, `%${searchTerm}%`),
          ),
        )
      )
      .orderBy(desc(claims.createdAt))
      .limit(20);

    res.json(results);
  } catch (error) {
    return safeErrorResponse(res, 500, 'Failed to search claims', error);
  }
});

export default router;
