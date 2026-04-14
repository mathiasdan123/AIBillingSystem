/**
 * Credentialing Routes
 *
 * Handles:
 * - GET    /api/credentialing             - List all credentials for the practice
 * - POST   /api/credentialing             - Add new credential record
 * - PATCH  /api/credentialing/:id         - Update status, dates, notes
 * - DELETE /api/credentialing/:id         - Remove credential
 * - GET    /api/credentialing/expiring    - Get credentials expiring in next 90 days
 */

import { Router, type Response } from 'express';
import { eq, and, lte, gte, sql } from 'drizzle-orm';
import { isAuthenticated } from '../replitAuth';
import { db, dbReady } from '../db';
import { providerCredentials } from '@shared/schema';
import logger from '../services/logger';

const router = Router();

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
    logger.warn(`Practice access restricted: User requested practice ${requestedPracticeId} but assigned to ${userPracticeId}`);
    return userPracticeId;
  }

  return requestedPracticeId || userPracticeId;
};

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

// GET /expiring - Get credentials expiring in next 90 days
// NOTE: This route must be defined BEFORE /:id to avoid matching "expiring" as an id
router.get('/expiring', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const daysAhead = parseInt(req.query.days as string) || 90;

    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const results = await db
      .select()
      .from(providerCredentials)
      .where(
        and(
          eq(providerCredentials.practiceId, practiceId),
          lte(providerCredentials.expirationDate, futureDate.toISOString().split('T')[0]),
          gte(providerCredentials.expirationDate, now.toISOString().split('T')[0])
        )
      )
      .orderBy(providerCredentials.expirationDate);

    res.json(results);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch expiring credentials', error);
  }
});

// GET / - List all credentials for the practice
router.get('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const status = req.query.status as string | undefined;

    let query = db
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.practiceId, practiceId));

    if (status && status !== 'all') {
      query = db
        .select()
        .from(providerCredentials)
        .where(
          and(
            eq(providerCredentials.practiceId, practiceId),
            eq(providerCredentials.enrollmentStatus, status)
          )
        );
    }

    const results = await query.orderBy(providerCredentials.providerName);
    res.json(results);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch credentials', error);
  }
});

// POST / - Add new credential record
router.post('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);

    const {
      providerId,
      providerName,
      providerNpi,
      payerName,
      payerId,
      caqhProfileId,
      enrollmentStatus,
      enrollmentDate,
      expirationDate,
      reCredentialingDate,
      applicationSubmittedAt,
      notes,
      documents,
    } = req.body;

    if (!providerId || !providerName || !payerName) {
      return res.status(400).json({ message: 'providerId, providerName, and payerName are required' });
    }

    const [result] = await db
      .insert(providerCredentials)
      .values({
        practiceId,
        providerId,
        providerName,
        providerNpi: providerNpi || null,
        payerName,
        payerId: payerId || null,
        caqhProfileId: caqhProfileId || null,
        enrollmentStatus: enrollmentStatus || 'pending',
        enrollmentDate: enrollmentDate || null,
        expirationDate: expirationDate || null,
        reCredentialingDate: reCredentialingDate || null,
        applicationSubmittedAt: applicationSubmittedAt || null,
        notes: notes || null,
        documents: documents || null,
      })
      .returning();

    res.status(201).json(result);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to create credential record', error);
  }
});

// PATCH /:id - Update status, dates, notes
router.patch('/:id', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid credential ID' });
    }

    // Only allow updating fields that exist
    const allowedFields = [
      'providerName', 'providerNpi', 'payerName', 'payerId', 'caqhProfileId',
      'enrollmentStatus', 'enrollmentDate', 'expirationDate', 'reCredentialingDate',
      'applicationSubmittedAt', 'notes', 'documents', 'providerId',
    ];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    updates.updatedAt = new Date();

    const [result] = await db
      .update(providerCredentials)
      .set(updates)
      .where(
        and(
          eq(providerCredentials.id, id),
          eq(providerCredentials.practiceId, practiceId)
        )
      )
      .returning();

    if (!result) {
      return res.status(404).json({ message: 'Credential record not found' });
    }

    res.json(result);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to update credential record', error);
  }
});

// DELETE /:id - Remove credential
router.delete('/:id', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid credential ID' });
    }

    const [deleted] = await db
      .delete(providerCredentials)
      .where(
        and(
          eq(providerCredentials.id, id),
          eq(providerCredentials.practiceId, practiceId)
        )
      )
      .returning();

    if (!deleted) {
      return res.status(404).json({ message: 'Credential record not found' });
    }

    res.json({ message: 'Credential record deleted' });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to delete credential record', error);
  }
});

export default router;
