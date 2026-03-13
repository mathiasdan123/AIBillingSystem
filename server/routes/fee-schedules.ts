/**
 * Fee Schedule Routes
 *
 * Handles:
 * - GET    /api/fee-schedules              - List fee schedule entries (with optional filters)
 * - GET    /api/fee-schedules/:id          - Get single entry (not used yet but reserved)
 * - POST   /api/fee-schedules              - Create entry
 * - POST   /api/fee-schedules/bulk-import  - Bulk import entries
 * - PUT    /api/fee-schedules/:id          - Update entry
 * - DELETE /api/fee-schedules/:id          - Delete entry
 * - GET    /api/fee-schedules/lookup       - Lookup expected reimbursement for payer/cpt
 * - GET    /api/fee-schedules/compare      - Compare actual vs expected payments
 * - GET    /api/fee-schedules/export       - Export as CSV
 */

import { Router, type Response } from 'express';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import {
  createFeeScheduleEntry,
  bulkImportFeeSchedule,
  getFeeSchedule,
  getExpectedReimbursement,
  updateFeeScheduleEntry,
  deleteFeeScheduleEntry,
  compareActualVsExpected,
  exportFeeSchedule,
} from '../services/feeScheduleService';

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

// GET / - List fee schedule entries
router.get('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const payerName = req.query.payerName as string | undefined;
    const cptCode = req.query.cptCode as string | undefined;
    const results = await getFeeSchedule(practiceId, payerName, cptCode);
    res.json(results);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch fee schedule', error);
  }
});

// GET /lookup - Lookup expected reimbursement for a specific payer/CPT combo
router.get('/lookup', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const payerName = req.query.payerName as string;
    const cptCode = req.query.cptCode as string;

    if (!payerName || !cptCode) {
      return res.status(400).json({ message: 'payerName and cptCode are required' });
    }

    const entry = await getExpectedReimbursement(practiceId, payerName, cptCode);
    if (!entry) {
      return res.status(404).json({ message: 'No fee schedule entry found for this payer/CPT combination' });
    }

    res.json(entry);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to lookup expected reimbursement', error);
  }
});

// GET /compare - Compare actual payments vs expected
router.get('/compare', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate are required' });
    }

    const report = await compareActualVsExpected(practiceId, startDate, endDate);
    res.json(report);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to compare actual vs expected reimbursement', error);
  }
});

// GET /export - Export fee schedule as CSV
router.get('/export', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const payerName = req.query.payerName as string | undefined;
    const csv = await exportFeeSchedule(practiceId, payerName);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="fee-schedule.csv"');
    res.send(csv);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to export fee schedule', error);
  }
});

// POST / - Create a fee schedule entry
router.post('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const entry = await createFeeScheduleEntry(practiceId, req.body);
    res.status(201).json(entry);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to create fee schedule entry', error);
  }
});

// POST /bulk-import - Bulk import fee schedule entries
router.post('/bulk-import', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { entries } = req.body;

    if (!Array.isArray(entries)) {
      return res.status(400).json({ message: 'entries must be an array' });
    }

    const results = await bulkImportFeeSchedule(practiceId, entries);
    res.status(201).json({ imported: results.length, entries: results });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to bulk import fee schedule', error);
  }
});

// PUT /:id - Update a fee schedule entry
router.put('/:id', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid fee schedule entry ID' });
    }

    const updated = await updateFeeScheduleEntry(id, practiceId, req.body);
    res.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ message: error.message });
    }
    safeErrorResponse(res, 500, 'Failed to update fee schedule entry', error);
  }
});

// DELETE /:id - Delete a fee schedule entry
router.delete('/:id', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid fee schedule entry ID' });
    }

    await deleteFeeScheduleEntry(id, practiceId);
    res.json({ message: 'Fee schedule entry deleted' });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ message: error.message });
    }
    safeErrorResponse(res, 500, 'Failed to delete fee schedule entry', error);
  }
});

export default router;
