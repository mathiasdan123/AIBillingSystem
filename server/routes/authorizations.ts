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

/**
 * POST /draft-request — AI-drafted PA request letter.
 * Body: { patientId, cptCode, diagnosisCode, requestedUnits, ... }
 * Pulls the patient, practice, latest SOAP note, and calls Claude to
 * produce a formatted request letter + summary. Does NOT save — biller
 * reviews + exports.
 */
router.post('/draft-request', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const {
      patientId,
      cptCode,
      diagnosisCode,
      requestedUnits,
      requestedStartDate,
      requestedEndDate,
      frequency,
    } = req.body || {};

    if (!patientId || !cptCode || !diagnosisCode || !requestedUnits) {
      return res.status(400).json({
        message: 'patientId, cptCode, diagnosisCode, and requestedUnits are required.',
      });
    }

    const { storage } = await import('../storage');
    const [patient, practice] = await Promise.all([
      storage.getPatient(patientId),
      storage.getPractice(practiceId),
    ]);
    if (!patient) return res.status(404).json({ message: 'Patient not found' });
    if (!practice) return res.status(404).json({ message: 'Practice not found' });
    if (patient.practiceId !== practiceId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Look up the CPT + ICD descriptions for the letter. Missing is OK —
    // the service writes defensibly without them.
    const [cptCodes, icdCodes] = await Promise.all([
      storage.getCptCodes().catch(() => [] as any[]),
      storage.getIcd10Codes().catch(() => [] as any[]),
    ]);
    const cpt = cptCodes.find((c: any) => c.code === cptCode);
    const icd = icdCodes.find((c: any) => c.code === diagnosisCode);

    // Most recent SOAP note for this patient — used for clinical necessity.
    // Pulls via session → soap-note-by-session path (no direct patient index
    // exists). If anything in the chain fails we draft without SOAP context;
    // Claude is explicitly instructed never to fabricate clinical findings.
    let latestSoap: any = null;
    try {
      const sessions: any[] = (await (storage as any).getTreatmentSessions?.(patientId)) ?? [];
      sessions.sort((a: any, b: any) => {
        const aT = new Date(a.sessionDate ?? a.createdAt ?? 0).getTime();
        const bT = new Date(b.sessionDate ?? b.createdAt ?? 0).getTime();
        return bT - aT;
      });
      for (const s of sessions.slice(0, 5)) {
        const note = await storage.getSoapNoteBySession?.(s.id);
        if (note) {
          latestSoap = note;
          break;
        }
      }
    } catch {
      // Non-fatal — draft without SOAP context.
    }

    // Active auth on file (if any) — referenced as "prior auth on file" so
    // reviewers know this is a renewal, not a net-new request.
    let previousAuthNumber: string | null = null;
    try {
      const { getAuthorizations } = await import('../services/authorizationService');
      const existing = await getAuthorizations(practiceId, {
        patientId,
        status: 'active',
      });
      if (Array.isArray(existing) && existing.length > 0) {
        previousAuthNumber = (existing[0] as any).authorizationNumber ?? null;
      }
    } catch {
      // Non-fatal.
    }

    const { draftPaLetter } = await import('../services/paLetterService');
    const result = await draftPaLetter({
      patient: {
        firstName: patient.firstName,
        lastName: patient.lastName,
        dateOfBirth: (patient as any).dateOfBirth ?? null,
        memberId: (patient as any).insuranceId ?? null,
        insuranceProvider: (patient as any).insuranceProvider ?? null,
      },
      practice: {
        name: practice.name,
        npi: (practice as any).npi ?? null,
        taxId: (practice as any).taxId ?? null,
        address: (practice as any).address ?? null,
        phone: (practice as any).phone ?? null,
        specialty: (practice as any).specialty ?? null,
        ownerName: (practice as any).ownerName ?? null,
        ownerTitle: (practice as any).ownerTitle ?? null,
      },
      request: {
        cptCode,
        cptDescription: cpt?.description ?? null,
        diagnosisCode,
        diagnosisDescription: icd?.description ?? null,
        requestedUnits: parseInt(String(requestedUnits), 10) || 1,
        requestedStartDate: requestedStartDate ?? null,
        requestedEndDate: requestedEndDate ?? null,
        frequency: frequency ?? null,
      },
      clinicalContext: {
        latestSoapSubjective: latestSoap?.subjective ?? null,
        latestSoapAssessment: latestSoap?.assessment ?? null,
        latestSoapPlan: latestSoap?.plan ?? null,
        previousAuthorizationNumber: previousAuthNumber,
      },
    });

    res.json(result);
  } catch (error: any) {
    const msg = error?.message ?? 'Failed to draft PA letter';
    const status = msg.includes('ANTHROPIC_API_KEY') ? 503 : 500;
    safeErrorResponse(res, status, msg, error);
  }
});

/**
 * POST /parse-document — Claude Vision parses a PA approval letter.
 * Body: { image: base64 string (data URL or raw base64) }
 * Returns structured fields for the biller to review before saving.
 */
router.post('/parse-document', isAuthenticated, async (req: any, res: Response) => {
  try {
    const { image } = req.body || {};
    if (!image || typeof image !== 'string' || image.length < 100) {
      return res.status(400).json({
        message: 'An image (base64 or data URL) is required.',
      });
    }
    const { parseAuthDocument } = await import('../services/paLetterService');
    const parsed = await parseAuthDocument(image);
    res.json(parsed);
  } catch (error: any) {
    const msg = error?.message ?? 'Failed to parse document';
    const status = msg.includes('ANTHROPIC_API_KEY') ? 503 : 500;
    safeErrorResponse(res, status, msg, error);
  }
});

export default router;
