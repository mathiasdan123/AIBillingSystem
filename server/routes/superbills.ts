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

  if (userRole === 'admin' && req.isPlatformAdmin) {
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


/**
 * Turn the dialog's { cptCodeId, units, icd10CodeId } line items into the
 * resolved shape the superbills table stores.
 *
 * Prices from the practice's own fee schedule with NO fallback to the shared
 * catalog figure, matching the claim line-item rule: that column is a platform
 * suggestion, and putting it on a superbill would hand the patient an amount
 * their practice never agreed to — which they then submit to their insurer.
 */
async function resolveSuperbillLineItems(
  practiceId: number,
  lineItems: Array<{ cptCodeId: number; units?: number; icd10CodeId?: number }>,
): Promise<
  | { procedureCodes: any[]; diagnosisCodes: string[]; totalAmount: string }
  | { error: { message: string; code?: string; cptCode?: string } }
> {
  const { storage } = await import('../storage');
  const [cptCatalog, icdCatalog] = await Promise.all([
    storage.getCptCodes(),
    storage.getIcd10Codes(),
  ]);

  const procedureCodes: any[] = [];
  const diagnosisCodes: string[] = [];
  let totalCents = 0;

  for (const item of lineItems) {
    const cpt: any = cptCatalog.find((c: any) => c.id === item.cptCodeId);
    if (!cpt) {
      return { error: { message: `Invalid CPT code on one of the line items.` } };
    }

    const rate = await storage.resolvePracticeCptRate(practiceId, item.cptCodeId);
    if (rate === null) {
      return {
        error: {
          message: `No charge is set for CPT ${cpt.code}. Set your charge under Insurance Rates → Your Charges before creating a superbill with this code.`,
          code: 'RATE_NOT_SET',
          cptCode: cpt.code,
        },
      };
    }

    const units = item.units && item.units > 0 ? item.units : 1;
    // Integer cents: multiplying a float rate by units and summing reintroduces
    // binary-float error into a dollar figure the patient sees.
    const lineCents = Math.round(parseFloat(rate) * 100) * units;
    totalCents += lineCents;

    procedureCodes.push({
      code: cpt.code,
      description: cpt.description ?? cpt.shortDescription ?? '',
      units,
      fee: (lineCents / 100).toFixed(2),
    });

    if (item.icd10CodeId) {
      const icd: any = icdCatalog.find((c: any) => c.id === item.icd10CodeId);
      if (icd?.code && !diagnosisCodes.includes(icd.code)) {
        diagnosisCodes.push(icd.code);
      }
    }
  }

  if (diagnosisCodes.length === 0) {
    return {
      error: {
        message:
          'A superbill needs at least one diagnosis code — an insurer cannot reimburse without one. Add an ICD-10 code to a line item.',
      },
    };
  }

  return { procedureCodes, diagnosisCodes, totalAmount: (totalCents / 100).toFixed(2) };
}

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
    let { patientId, providerId, appointmentId, dateOfService, diagnosisCodes, procedureCodes, totalAmount, notes } = req.body;

    // The Create Superbill dialog sends what a user can actually pick — a
    // patient, a date, and CPT/ICD line items — not the fully-resolved
    // procedureCodes/diagnosisCodes/totalAmount this route originally
    // demanded. The two contracts never matched, so the dialog returned 400
    // on every attempt and no superbill could be created from the UI at all.
    //
    // Resolving here rather than in the client is deliberate: fees come from
    // THIS practice's own schedule, and a client that sent its own `fee` could
    // put an amount nobody chose on a document the patient submits to their
    // insurer.
    if (Array.isArray(req.body?.lineItems) && req.body.lineItems.length > 0) {
      const resolved = await resolveSuperbillLineItems(practiceId, req.body.lineItems);
      if ('error' in resolved) {
        return res.status(400).json(resolved.error);
      }
      procedureCodes = resolved.procedureCodes;
      diagnosisCodes = resolved.diagnosisCodes;
      totalAmount = resolved.totalAmount;
      // A superbill records who rendered the care. Default to the signed-in
      // user rather than asking again — the alternative was a required field
      // the dialog never collected.
      providerId = providerId || req.user?.claims?.sub || null;
    }

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
