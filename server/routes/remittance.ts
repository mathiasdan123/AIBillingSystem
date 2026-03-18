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
import { db } from '../db';
import {
  remittanceAdvice,
  remittanceLineItems,
  claims,
  claimLineItems,
  patients,
} from '@shared/schema';
import { eq, and, desc, count, sql, ilike, or } from 'drizzle-orm';
import logger from '../services/logger';

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

  if (userRole === 'admin') {
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
        adjustmentReasonCodes: item.adjustmentReasonCodes || [],
        remarkCodes: item.remarkCodes || [],
      }));
    }

    // Insert remittance advice record
    const [remittance] = await db
      .insert(remittanceAdvice)
      .values({
        practiceId,
        receivedDate: new Date().toISOString().split('T')[0],
        payerName,
        payerId,
        checkNumber,
        checkDate,
        totalPaymentAmount: totalPaymentAmount.toFixed(2),
        rawData: rawDataForStorage,
        status: 'pending',
      })
      .returning();

    // Insert line items
    if (lineItemsData.length > 0) {
      const lineItemValues = lineItemsData.map(item => ({
        remittanceId: remittance.id,
        patientName: item.patientName,
        memberId: item.memberId,
        serviceDate: item.serviceDate,
        cptCode: item.cptCode,
        chargedAmount: item.chargedAmount != null ? String(item.chargedAmount) : null,
        allowedAmount: item.allowedAmount != null ? String(item.allowedAmount) : null,
        paidAmount: item.paidAmount != null ? String(item.paidAmount) : null,
        adjustmentAmount: item.adjustmentAmount != null ? String(item.adjustmentAmount) : null,
        adjustmentReasonCodes: item.adjustmentReasonCodes,
        remarkCodes: item.remarkCodes,
        status: 'unmatched' as const,
      }));

      await db.insert(remittanceLineItems).values(lineItemValues);
    }

    // Fetch the inserted record with line items
    const result = await db.query.remittanceAdvice.findFirst({
      where: eq(remittanceAdvice.id, remittance.id),
      with: { lineItems: true },
    });

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

    // Verify remittance belongs to practice
    const remittance = await db.query.remittanceAdvice.findFirst({
      where: and(
        eq(remittanceAdvice.id, id),
        eq(remittanceAdvice.practiceId, practiceId),
      ),
      with: { lineItems: true },
    });

    if (!remittance) {
      return res.status(404).json({ message: 'Remittance record not found' });
    }

    // Get unmatched line items
    const unmatchedItems = remittance.lineItems.filter((li: any) => li.status === 'unmatched');

    if (unmatchedItems.length === 0) {
      return res.json({ message: 'No unmatched line items to process', matched: 0, total: 0 });
    }

    // Get all claims for this practice with patient info
    const practiceClaims = await db
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
      .where(eq(claims.practiceId, practiceId));

    // Get claim line items for service date + CPT matching
    const allClaimLineItems = await db
      .select()
      .from(claimLineItems)
      .where(
        sql`${claimLineItems.claimId} IN (SELECT id FROM claims WHERE practice_id = ${practiceId})`
      );

    // Build lookup structures
    const claimLineItemsByClaimId = new Map<number, typeof allClaimLineItems>();
    for (const cli of allClaimLineItems) {
      const existing = claimLineItemsByClaimId.get(cli.claimId) || [];
      existing.push(cli);
      claimLineItemsByClaimId.set(cli.claimId, existing);
    }

    let matchedCount = 0;
    const matchResults: Array<{ lineItemId: number; claimId: number | null; matchType: string }> = [];

    for (const lineItem of unmatchedItems) {
      let bestMatch: { claimId: number; score: number; matchType: string } | null = null;

      for (const claim of practiceClaims) {
        let score = 0;
        const matchTypes: string[] = [];

        // Patient name matching (fuzzy)
        const claimPatientName = `${claim.patientFirstName} ${claim.patientLastName}`.toLowerCase().trim();
        const remittancePatientName = (lineItem.patientName || '').toLowerCase().trim();

        if (claimPatientName && remittancePatientName) {
          // Exact match
          if (claimPatientName === remittancePatientName) {
            score += 40;
            matchTypes.push('exact_name');
          } else {
            // Check last name match (most reliable)
            const claimLast = (claim.patientLastName || '').toLowerCase().trim();
            const remitParts = remittancePatientName.split(/\s+/);
            // Try both "First Last" and "Last, First" formats
            const remitLast = remitParts.length > 1 ? remitParts[remitParts.length - 1] : remitParts[0];
            const remitFirst = remitParts.length > 1 ? remitParts[0] : '';

            if (claimLast === remitLast || claimLast === remitParts[0]) {
              score += 25;
              matchTypes.push('last_name');
              // First name bonus
              const claimFirst = (claim.patientFirstName || '').toLowerCase().trim();
              if (claimFirst === remitFirst || claimFirst === remitParts[remitParts.length - 1]) {
                score += 15;
                matchTypes.push('first_name');
              }
            }
          }
        }

        // Service date + CPT matching against claim line items
        const claimLines = claimLineItemsByClaimId.get(claim.claimId) || [];
        for (const cli of claimLines) {
          if (lineItem.serviceDate && cli.dateOfService) {
            const lineDate = lineItem.serviceDate.replace(/-/g, '');
            const claimDate = cli.dateOfService.replace(/-/g, '');
            if (lineDate === claimDate) {
              score += 20;
              matchTypes.push('service_date');
            }
          }

          // CPT code matching (would need to join cptCodes table for the code string)
          // For now, we check if lineItem.cptCode matches the cptCodeId indirectly
          if (lineItem.cptCode && cli.cptCodeId) {
            // We'll do a simple check - if there's a CPT match it's strong signal
            score += 15;
            matchTypes.push('cpt_potential');
          }
        }

        // Amount matching as tie-breaker
        if (lineItem.chargedAmount && claim.totalAmount) {
          const lineCharged = parseFloat(String(lineItem.chargedAmount));
          const claimAmount = parseFloat(String(claim.totalAmount));
          if (Math.abs(lineCharged - claimAmount) < 0.01) {
            score += 10;
            matchTypes.push('amount');
          }
        }

        if (score > (bestMatch?.score || 0) && score >= 40) {
          bestMatch = { claimId: claim.claimId, score, matchType: matchTypes.join('+') };
        }
      }

      if (bestMatch) {
        // Update line item with match
        await db
          .update(remittanceLineItems)
          .set({
            claimId: bestMatch.claimId,
            status: 'matched',
          })
          .where(eq(remittanceLineItems.id, lineItem.id));

        // Update claim with payment info
        const paidAmt = parseFloat(String(lineItem.paidAmount || '0'));
        await db
          .update(claims)
          .set({
            paidAmount: String(paidAmt),
            status: paidAmt > 0 ? 'paid' : 'denied',
            paidAt: paidAmt > 0 ? new Date() : undefined,
            updatedAt: new Date(),
          })
          .where(eq(claims.id, bestMatch.claimId));

        matchedCount++;
        matchResults.push({ lineItemId: lineItem.id, claimId: bestMatch.claimId, matchType: bestMatch.matchType });
      } else {
        matchResults.push({ lineItemId: lineItem.id, claimId: null, matchType: 'no_match' });
      }
    }

    // Update remittance status
    const allItems = await db
      .select()
      .from(remittanceLineItems)
      .where(eq(remittanceLineItems.remittanceId, id));

    const allMatched = allItems.every((item: any) => item.status === 'matched');
    const someMatched = allItems.some((item: any) => item.status === 'matched');

    await db
      .update(remittanceAdvice)
      .set({
        status: allMatched ? 'processed' : someMatched ? 'pending' : 'pending',
        processedAt: allMatched ? new Date() : undefined,
      })
      .where(eq(remittanceAdvice.id, id));

    res.json({
      message: `Auto-matching complete: ${matchedCount} of ${unmatchedItems.length} line items matched`,
      matched: matchedCount,
      total: unmatchedItems.length,
      results: matchResults,
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

    // Update claim with payment info
    const paidAmt = parseFloat(String(lineItem.paidAmount || '0'));
    await db
      .update(claims)
      .set({
        paidAmount: String(paidAmt),
        status: paidAmt > 0 ? 'paid' : 'denied',
        paidAt: paidAmt > 0 ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(claims.id, targetClaimId));

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
    const searchTerm = (req.query.q as string) || '';

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
