/**
 * Treatment Authorization Routes
 *
 * Handles:
 * - GET    /api/treatment-authorizations              - List authorizations with filters
 * - GET    /api/treatment-authorizations/:id           - Get single authorization
 * - POST   /api/treatment-authorizations               - Create authorization
 * - PATCH  /api/treatment-authorizations/:id           - Update authorization
 * - POST   /api/treatment-authorizations/:id/use-units - Increment used units
 * - GET    /api/treatment-authorizations/expiring      - Get expiring authorizations
 * - GET    /api/treatment-authorizations/utilization   - Get utilization summary
 */

import { Router, type Response } from 'express';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import {
  createAuthorization,
  getAuthorizations,
  getAuthorization,
  updateAuthorization,
  incrementUsedUnits,
  getExpiringAuthorizations,
  getAuthorizationUtilization,
} from '../services/authorizationService';

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

// GET /expiring - Get expiring authorizations (must be before /:id)
router.get('/expiring', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const daysAhead = req.query.daysAhead ? parseInt(req.query.daysAhead as string) : 14;
    const results = await getExpiringAuthorizations(practiceId, daysAhead);
    res.json(results);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch expiring authorizations', error);
  }
});

// GET /utilization - Get utilization summary (must be before /:id)
router.get('/utilization', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const summary = await getAuthorizationUtilization(practiceId);
    res.json(summary);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch authorization utilization', error);
  }
});

// GET / - List authorizations with optional filters
router.get('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
      status: req.query.status as string | undefined,
      expiringSoon: req.query.expiringSoon === 'true',
    };
    const results = await getAuthorizations(practiceId, filters);
    res.json(results);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch treatment authorizations', error);
  }
});

// GET /:id - Get single authorization
router.get('/:id', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid authorization ID' });
    }
    const authorization = await getAuthorization(id, practiceId);
    if (!authorization) {
      return res.status(404).json({ message: 'Authorization not found' });
    }
    res.json(authorization);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch authorization', error);
  }
});

// POST / - Create authorization
router.post('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { patientId, authorizedUnits, startDate, endDate } = req.body;

    if (!patientId || !authorizedUnits || !startDate || !endDate) {
      return res.status(400).json({
        message: 'Missing required fields: patientId, authorizedUnits, startDate, endDate',
      });
    }

    const authorization = await createAuthorization(practiceId, req.body);
    res.status(201).json(authorization);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to create treatment authorization', error);
  }
});

// PATCH /:id - Update authorization
router.patch('/:id', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid authorization ID' });
    }
    const authorization = await updateAuthorization(id, practiceId, req.body);
    res.json(authorization);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update authorization';
    const statusCode = message.includes('not found') ? 404 : 500;
    safeErrorResponse(res, statusCode, message, error);
  }
});

// POST /:id/use-units - Increment used units
router.post('/:id/use-units', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid authorization ID' });
    }
    const units = req.body.units ? parseInt(req.body.units) : 1;
    const authorization = await incrementUsedUnits(id, practiceId, units);
    res.json(authorization);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to increment units';
    const statusCode = message.includes('not found') ? 404 : message.includes('not active') ? 409 : 500;
    safeErrorResponse(res, statusCode, message, error);
  }
});

export default router;
