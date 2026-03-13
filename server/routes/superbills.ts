/**
 * Superbill Routes
 *
 * Handles:
 * - GET    /api/superbills         - List superbills with filters
 * - GET    /api/superbills/:id     - Get single superbill
 * - POST   /api/superbills         - Create superbill from data
 * - POST   /api/superbills/from-appointment - Auto-generate from appointment
 * - POST   /api/superbills/:id/finalize     - Finalize superbill
 * - POST   /api/superbills/:id/send         - Mark as sent
 */

import { Router, type Response } from 'express';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import {
  generateSuperbill,
  generateFromAppointment,
  getSuperbills,
  getSuperbill,
  finalizeSuperbill,
  markSent,
} from '../services/superbillService';

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

// GET /superbills - List superbills with optional filters
router.get('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
      status: req.query.status as string | undefined,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
    };
    const results = await getSuperbills(practiceId, filters);
    res.json(results);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch superbills', error);
  }
});

// GET /superbills/:id - Get single superbill
router.get('/:id', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid superbill ID' });
    }
    const superbill = await getSuperbill(id, practiceId);
    if (!superbill) {
      return res.status(404).json({ message: 'Superbill not found' });
    }
    res.json(superbill);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch superbill', error);
  }
});

// POST /superbills - Create superbill
router.post('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { patientId, providerId, appointmentId, dateOfService, diagnosisCodes, procedureCodes, totalAmount, notes } = req.body;

    if (!patientId || !providerId || !dateOfService || !diagnosisCodes || !procedureCodes || !totalAmount) {
      return res.status(400).json({ message: 'Missing required fields: patientId, providerId, dateOfService, diagnosisCodes, procedureCodes, totalAmount' });
    }

    const superbill = await generateSuperbill(practiceId, {
      patientId,
      providerId,
      appointmentId,
      dateOfService,
      diagnosisCodes,
      procedureCodes,
      totalAmount,
      notes,
    });
    res.status(201).json(superbill);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to create superbill', error);
  }
});

// POST /superbills/from-appointment - Auto-generate from appointment
router.post('/from-appointment', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { appointmentId } = req.body;

    if (!appointmentId) {
      return res.status(400).json({ message: 'Missing required field: appointmentId' });
    }

    const superbill = await generateFromAppointment(appointmentId, practiceId);
    res.status(201).json(superbill);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate superbill from appointment';
    const statusCode = message.includes('not found') ? 404 : 500;
    safeErrorResponse(res, statusCode, message, error);
  }
});

// POST /superbills/:id/finalize - Finalize superbill
router.post('/:id/finalize', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid superbill ID' });
    }
    const superbill = await finalizeSuperbill(id, practiceId);
    res.json(superbill);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to finalize superbill';
    const statusCode = message.includes('not found') ? 404 : message.includes('already') ? 409 : 500;
    safeErrorResponse(res, statusCode, message, error);
  }
});

// POST /superbills/:id/send - Mark superbill as sent
router.post('/:id/send', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid superbill ID' });
    }
    const { method } = req.body;
    if (!method || !['email', 'portal', 'print'].includes(method)) {
      return res.status(400).json({ message: 'Invalid or missing method. Must be email, portal, or print.' });
    }
    const superbill = await markSent(id, practiceId, method);
    res.json(superbill);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to mark superbill as sent';
    const statusCode = message.includes('not found') ? 404 : message.includes('must be finalized') ? 409 : 500;
    safeErrorResponse(res, statusCode, message, error);
  }
});

export default router;
