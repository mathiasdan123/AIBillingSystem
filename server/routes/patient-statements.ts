/**
 * Patient Statement Routes
 *
 * Handles:
 * - POST   /api/patient-statements/generate        - Generate statement from claims
 * - GET    /api/patient-statements                  - List statements with filters
 * - GET    /api/patient-statements/outstanding      - Outstanding balances by patient
 * - GET    /api/patient-statements/aging            - Aging summary
 * - GET    /api/patient-statements/:id              - Get single statement
 * - POST   /api/patient-statements/:id/send         - Mark as sent
 * - POST   /api/patient-statements/:id/payment      - Record payment
 */

import { Router, type Response } from 'express';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import {
  generateStatement,
  getStatements,
  getStatement,
  sendStatement,
  recordPayment,
  getOutstandingBalances,
  getAgingSummary,
} from '../services/patientStatementService';

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

// POST /patient-statements/generate - Generate a statement from claims data
router.post('/generate', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { patientId, startDate, endDate } = req.body;

    if (!patientId || !startDate || !endDate) {
      return res.status(400).json({ message: 'patientId, startDate, and endDate are required' });
    }

    const statement = await generateStatement(practiceId, patientId, startDate, endDate);
    res.status(201).json(statement);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to generate patient statement', error);
  }
});

// GET /patient-statements - List statements with optional filters
router.get('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
      status: req.query.status as string | undefined,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
    };
    const results = await getStatements(practiceId, filters);
    res.json(results);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch patient statements', error);
  }
});

// GET /patient-statements/outstanding - Outstanding balances by patient
router.get('/outstanding', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const balances = await getOutstandingBalances(practiceId);
    res.json(balances);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch outstanding balances', error);
  }
});

// GET /patient-statements/aging - Aging summary
router.get('/aging', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const summary = await getAgingSummary(practiceId);
    res.json(summary);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch aging summary', error);
  }
});

// GET /patient-statements/:id - Get single statement
router.get('/:id', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid statement ID' });
    }

    const statement = await getStatement(id, practiceId);
    if (!statement) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    res.json(statement);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch patient statement', error);
  }
});

// POST /patient-statements/:id/send - Mark statement as sent
router.post('/:id/send', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid statement ID' });
    }

    const { method } = req.body;
    if (!method || !['email', 'portal', 'mail'].includes(method)) {
      return res.status(400).json({ message: 'Valid method (email, portal, mail) is required' });
    }

    const statement = await sendStatement(id, practiceId, method);
    if (!statement) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    res.json(statement);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to send patient statement', error);
  }
});

// POST /patient-statements/:id/payment - Record a payment
router.post('/:id/payment', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid statement ID' });
    }

    const { amount } = req.body;
    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ message: 'A positive payment amount is required' });
    }

    const statement = await recordPayment(id, practiceId, amount);
    if (!statement) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    res.json(statement);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to record payment', error);
  }
});

export default router;
