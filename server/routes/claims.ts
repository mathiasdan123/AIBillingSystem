/**
 * Claims Routes
 *
 * Handles:
 * - /api/claims - Claims CRUD operations
 * - /api/claims/:id/line-items - Claim line items management
 * - /api/claims/batch-submit - Batch claim submission
 * - /api/claims/:id/submit - Claim submission
 * - /api/claims/:id/check-status - Status verification
 * - /api/claims/:id/paid - Mark claim as paid
 * - /api/claims/:id/deny - Deny claim (with AI appeal generation)
 * - /api/claims/:id/appeals - Appeal management
 * - /api/claims/:id/regenerate-appeal - Regenerate AI appeal
 * - /api/claims/:id/submit-secondary - Submit claim to secondary insurance
 * - /api/claims/analytics/* - Claims analytics
 */

import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { validate } from '../middleware/validate';
import { createClaimSchema } from '../validation/schemas';
import { AiClaimOptimizer } from '../aiClaimOptimizer';
import { appealGenerator } from '../aiAppealGenerator';
import { parsePagination, paginatedResponse } from '../utils/pagination';
import logger from '../services/logger';
import type { ClaimSubmission } from '../services/stediService';
import { checkClaimUnderpayment } from './payerContracts';
import { predictDenial } from '../services/aiDenialPredictor';
import { recordClaimOutcome } from '../services/aiLearningService';
import {
  bulkSubmitClaims,
  bulkUpdateClaimStatus,
  bulkExportClaims,
} from '../services/bulkOperationsService';

const router = Router();
const claimOptimizer = new AiClaimOptimizer();

// Helper to validate positive integers
const validatePositiveInt = (value: string | undefined, defaultValue: number = 0): number | null => {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) return null;
  return parsed;
};

// Security: Safe error response helper
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
    logger.warn(`Practice access restricted: User requested practice ${requestedPracticeId} but assigned to ${userPracticeId}`);
    return userPracticeId;
  }

  return requestedPracticeId || userPracticeId;
};

// Middleware to check if user has admin or billing role
const isAdminOrBilling = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await storage.getUser(req.user.claims.sub);
    if (!user || (user.role !== 'admin' && user.role !== 'billing')) {
      return res.status(403).json({ message: "Access denied. Admin or billing role required." });
    }

    next();
  } catch (error) {
    logger.error("Error checking user role", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to verify permissions" });
  }
};

// Generate secure claim number
const generateSecureClaimNumber = (prefix: string): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`.toUpperCase();
};

// ==================== CLAIMS CRUD ====================

/**
 * @openapi
 * /api/claims:
 *   get:
 *     tags: [Claims]
 *     summary: List all claims
 *     description: Returns a paginated list of claims for the authenticated user's practice.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: practiceId
 *         schema:
 *           type: integer
 *         description: Practice ID (admin only)
 *     responses:
 *       200:
 *         description: Paginated claims list
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Claim'
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    // TODO: Move pagination to DB layer (pass limit/offset to storage) to avoid loading all rows into memory
    const allClaims = await storage.getClaims(practiceId);
    const total = allClaims.length;
    const { page, limit, offset } = parsePagination(req.query);
    const claims = allClaims.slice(offset, offset + limit);
    if (!req.query.page && !req.query.limit) {
      res.json(claims);
    } else {
      res.json(paginatedResponse(claims, total, page, limit));
    }
  } catch (error) {
    logger.error('Error fetching claims', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch claims' });
  }
});

/**
 * @openapi
 * /api/claims/{id}:
 *   get:
 *     tags: [Claims]
 *     summary: Get a claim by ID
 *     description: Returns a single claim with its line items enriched with CPT and ICD-10 details.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Claim with line items
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Claim'
 *       400:
 *         description: Invalid claim ID
 *       403:
 *         description: Access denied
 *       404:
 *         description: Claim not found
 *       500:
 *         description: Server error
 */
router.get('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const claimId = validatePositiveInt(req.params.id);
    if (claimId === null) {
      return res.status(400).json({ message: 'Invalid claim ID' });
    }

    const claim = await storage.getClaim(claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    // Security: Verify user has access to this claim's practice
    const userPracticeId = req.userPracticeId;
    const userRole = req.userRole;
    if (userRole !== 'admin' && claim.practiceId !== userPracticeId) {
      logger.warn('Unauthorized claim access attempt', {
        userId: req.user?.claims?.sub,
        userPracticeId,
        claimPracticeId: claim.practiceId,
        claimId,
      });
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get line items for this claim
    const lineItems = await storage.getClaimLineItems(claim.id);

    // Enrich line items with CPT and ICD-10 details
    const cptCodes = await storage.getCptCodes();
    const icd10Codes = await storage.getIcd10Codes();

    const enrichedLineItems = lineItems.map((item: any) => {
      const cptCode = cptCodes.find((c: any) => c.id === item.cptCodeId);
      const icd10Code = icd10Codes.find((i: any) => i.id === item.icd10CodeId);
      return {
        ...item,
        cptCode: cptCode ? { code: cptCode.code, description: cptCode.description } : null,
        icd10Code: icd10Code ? { code: icd10Code.code, description: icd10Code.description } : null,
      };
    });

    // If this is a secondary claim, include primary claim info
    let primaryClaimInfo = null;
    if (claim.billingOrder === 'secondary' && claim.primaryClaimId) {
      const primaryClaim = await storage.getClaim(claim.primaryClaimId);
      if (primaryClaim) {
        primaryClaimInfo = {
          id: primaryClaim.id,
          claimNumber: primaryClaim.claimNumber,
          paidAmount: primaryClaim.paidAmount,
          status: primaryClaim.status,
        };
      }
    }

    // Check if this primary claim has secondary claims
    let secondaryClaimInfo = null;
    if (claim.billingOrder === 'primary' || !claim.billingOrder) {
      const allClaims = await storage.getClaims(claim.practiceId);
      const secondaryClaims = allClaims.filter(
        (c: any) => c.primaryClaimId === claim.id && c.billingOrder === 'secondary'
      );
      if (secondaryClaims.length > 0) {
        secondaryClaimInfo = secondaryClaims.map((sc: any) => ({
          id: sc.id,
          claimNumber: sc.claimNumber,
          status: sc.status,
          totalAmount: sc.totalAmount,
          paidAmount: sc.paidAmount,
        }));
      }
    }

    res.json({
      ...claim,
      lineItems: enrichedLineItems,
      primaryClaimInfo,
      secondaryClaimInfo,
    });
  } catch (error) {
    logger.error('Error fetching claim', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch claim' });
  }
});

/**
 * @openapi
 * /api/claims:
 *   post:
 *     tags: [Claims]
 *     summary: Create a new claim
 *     description: Creates a claim with optional AI optimization of billing codes. If a sessionId is provided, the system runs AI review on the associated SOAP note.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InsertClaim'
 *     responses:
 *       200:
 *         description: Created claim
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Claim'
 *       401:
 *         description: Not authenticated
 *       422:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post('/', isAuthenticated, validate(createClaimSchema), async (req: any, res) => {
  try {
    const { patientId, insuranceId, totalAmount, submittedAmount, sessionId, billingOrder, primaryClaimId } = req.body;
    const practiceId = getAuthorizedPracticeId(req);

    const prefix = billingOrder === 'secondary' ? 'SEC' : 'CLM';
    const claimNumber = generateSecureClaimNumber(prefix);

    let aiReviewScore = null;
    let aiReviewNotes = null;

    // If there's a session, try to run AI optimization on the SOAP note
    if (sessionId) {
      try {
        const soapNotes = await storage.getSoapNotes(practiceId);
        const sessionSoapNote = soapNotes.find((note: any) => note.sessionId === sessionId);
        const patients = await storage.getPatients(practiceId);
        const patient = patients.find((p: any) => p.id === patientId);

        if (sessionSoapNote && patient) {
          const optimization = await claimOptimizer.optimizeClaim(
            sessionSoapNote,
            patient,
            undefined
          );
          aiReviewScore = optimization.aiReviewScore.toString();
          aiReviewNotes = optimization.aiReviewNotes;
        }
      } catch (aiError) {
        logger.error('AI optimization failed, continuing without', { error: aiError instanceof Error ? aiError.message : String(aiError) });
      }
    }

    const claim = await storage.createClaim({
      practiceId,
      patientId,
      insuranceId: insuranceId || null,
      sessionId: sessionId || null,
      claimNumber,
      totalAmount: totalAmount.toString(),
      submittedAmount: submittedAmount?.toString() || null,
      status: 'draft',
      aiReviewScore,
      aiReviewNotes,
      billingOrder: billingOrder || 'primary',
      primaryClaimId: primaryClaimId || null,
    });

    res.json({
      message: 'Claim created successfully',
      claim
    });
  } catch (error: any) {
    logger.error('Error creating claim', { error: error instanceof Error ? error.message : String(error) });
    safeErrorResponse(res, 500, 'Failed to create claim', error);
  }
});

// Update claim
router.patch('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const existingClaim = await storage.getClaim(claimId);

    if (!existingClaim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    // Only allow updates to draft claims (or admin override)
    if (existingClaim.status !== 'draft') {
      const user = await storage.getUser(req.user?.claims?.sub);
      if (user?.role !== 'admin') {
        return res.status(400).json({ message: 'Can only edit draft claims' });
      }
    }

    const updatedClaim = await storage.updateClaim(claimId, req.body);
    res.json(updatedClaim);
  } catch (error) {
    logger.error('Error updating claim', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update claim' });
  }
});

// ==================== LINE ITEMS ====================

// Get line items for a claim
router.get('/:id/line-items', isAuthenticated, async (req: any, res) => {
  try {
    const claimId = validatePositiveInt(req.params.id);
    if (claimId === null) {
      return res.status(400).json({ message: 'Invalid claim ID' });
    }

    // Security: Verify user has access to this claim
    const claim = await storage.getClaim(claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }
    const userPracticeId = req.userPracticeId;
    const userRole = req.userRole;
    if (userRole !== 'admin' && claim.practiceId !== userPracticeId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const lineItems = await storage.getClaimLineItems(claimId);

    // Enrich with CPT and ICD-10 details
    const cptCodes = await storage.getCptCodes();
    const icd10Codes = await storage.getIcd10Codes();

    const enrichedLineItems = lineItems.map((item: any) => {
      const cptCode = cptCodes.find((c: any) => c.id === item.cptCodeId);
      const icd10Code = icd10Codes.find((i: any) => i.id === item.icd10CodeId);
      return {
        ...item,
        cptCode: cptCode ? { code: cptCode.code, description: cptCode.description } : null,
        icd10Code: icd10Code ? { code: icd10Code.code, description: icd10Code.description } : null,
      };
    });

    res.json(enrichedLineItems);
  } catch (error) {
    logger.error('Error fetching claim line items', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch line items' });
  }
});

// Add line item to claim
router.post('/:id/line-items', isAuthenticated, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const { cptCodeId, icd10CodeId, units, dateOfService, modifier, notes } = req.body;

    // Get CPT code for rate
    const cptCodes = await storage.getCptCodes();
    const cptCode = cptCodes.find((c: any) => c.id === cptCodeId);
    if (!cptCode) {
      return res.status(400).json({ message: 'Invalid CPT code' });
    }

    const rate = parseFloat(cptCode.baseRate || '289.00');
    const lineUnits = units || 1;
    const amount = (rate * lineUnits).toFixed(2);

    const lineItem = await storage.createClaimLineItem({
      claimId,
      cptCodeId,
      icd10CodeId: icd10CodeId || null,
      units: lineUnits,
      rate: rate.toFixed(2),
      amount,
      dateOfService: dateOfService || new Date().toISOString().split('T')[0],
      modifier: modifier || null,
      notes: notes || null,
    });

    // Update claim total
    const existingLineItems = await storage.getClaimLineItems(claimId);
    const newTotal = existingLineItems.reduce((sum: number, item: any) =>
      sum + parseFloat(item.amount), 0);
    await storage.updateClaim(claimId, { totalAmount: newTotal.toFixed(2) });

    res.json({
      ...lineItem,
      cptCode: { code: cptCode.code, description: cptCode.description },
    });
  } catch (error) {
    logger.error('Error adding line item', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to add line item' });
  }
});

// ==================== CLAIM SUBMISSION ====================

// Batch submit claims
/**
 * @openapi
 * /api/claims/batch-submit:
 *   post:
 *     tags: [Claims]
 *     summary: Batch-submit claims
 *     description: Submits multiple claims at once. Maximum 50 claims per batch.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [claimIds]
 *             properties:
 *               claimIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 minItems: 1
 *                 maxItems: 50
 *                 description: Array of claim IDs to submit
 *     responses:
 *       200:
 *         description: Batch submission results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 submitted:
 *                   type: integer
 *                   description: Number of successfully submitted claims
 *                 failed:
 *                   type: integer
 *                   description: Number of failed submissions
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       claimId:
 *                         type: integer
 *                       success:
 *                         type: boolean
 *                       error:
 *                         type: string
 *       400:
 *         description: Invalid request (empty array, too many claims)
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.post('/batch-submit', isAuthenticated, async (req: any, res) => {
  try {
    const { claimIds } = req.body;

    if (!Array.isArray(claimIds) || claimIds.length === 0) {
      return res.status(400).json({ message: 'claimIds must be a non-empty array' });
    }

    if (claimIds.length > 50) {
      return res.status(400).json({ message: 'Maximum 50 claims per batch submission' });
    }

    // Validate all IDs are positive integers
    const parsedIds: number[] = [];
    for (const id of claimIds) {
      const parsed = parseInt(id, 10);
      if (isNaN(parsed) || parsed <= 0) {
        return res.status(400).json({ message: `Invalid claim ID: ${id}` });
      }
      parsedIds.push(parsed);
    }

    // Deduplicate
    const uniqueIds = Array.from(new Set(parsedIds));

    const practiceId = getAuthorizedPracticeId(req);

    // Validate all claims exist and are submittable
    const validationErrors: Array<{ claimId: number; error: string }> = [];
    const validClaims: Array<{ claim: any; patient: any; practice: any; insurance: any; lineItems: any[] }> = [];

    for (const claimId of uniqueIds) {
      const claim = await storage.getClaim(claimId);
      if (!claim) {
        validationErrors.push({ claimId, error: 'Claim not found' });
        continue;
      }

      // Security: Verify user has access to this claim's practice
      const userPracticeId = (req as any).userPracticeId;
      const userRole = (req as any).userRole;
      if (userRole !== 'admin' && claim.practiceId !== userPracticeId) {
        validationErrors.push({ claimId, error: 'Access denied' });
        continue;
      }

      if (claim.status !== 'draft') {
        validationErrors.push({ claimId, error: `Claim is in '${claim.status}' status, only draft claims can be submitted` });
        continue;
      }

      // Check co-sign requirements
      if (claim.sessionId) {
        const soapNote = await storage.getSoapNoteBySession(claim.sessionId);
        if (soapNote && soapNote.cosignStatus === 'pending') {
          validationErrors.push({ claimId, error: 'SOAP note requires supervisor co-signature' });
          continue;
        }
        if (soapNote && soapNote.cosignStatus === 'rejected') {
          validationErrors.push({ claimId, error: 'SOAP note was rejected by supervisor' });
          continue;
        }
      }

      const patient = await storage.getPatient(claim.patientId);
      if (!patient) {
        validationErrors.push({ claimId, error: 'Patient not found' });
        continue;
      }

      const practice = await storage.getPractice(claim.practiceId);
      if (!practice) {
        validationErrors.push({ claimId, error: 'Practice not found' });
        continue;
      }

      const lineItems = await storage.getClaimLineItems(claimId);
      if (!lineItems || lineItems.length === 0) {
        validationErrors.push({ claimId, error: 'Claim has no line items' });
        continue;
      }

      let insurance = null;
      if (claim.insuranceId) {
        const insurances = await storage.getInsurances();
        insurance = insurances.find((i: any) => i.id === claim.insuranceId);
      }

      validClaims.push({ claim, patient, practice, insurance, lineItems });
    }

    // If all claims failed validation, return error
    if (validClaims.length === 0) {
      return res.status(400).json({
        message: 'No claims passed validation',
        results: [],
        errors: validationErrors,
        summary: { total: uniqueIds.length, succeeded: 0, failed: validationErrors.length },
      });
    }

    // Submit valid claims sequentially with a small delay for rate limiting
    const stediApiKey = process.env.STEDI_API_KEY;
    const results: Array<{
      claimId: number;
      claimNumber: string;
      success: boolean;
      submissionMethod: string;
      stediClaimId?: string;
      error?: string;
    }> = [];

    let stediService: typeof import('../services/stediService') | null = null;
    let cptCodes: any[] | null = null;
    let icd10Codes: any[] | null = null;

    if (stediApiKey) {
      stediService = await import('../services/stediService');
      cptCodes = await storage.getCptCodes();
      icd10Codes = await storage.getIcd10Codes();
    }

    for (let i = 0; i < validClaims.length; i++) {
      const { claim, patient, practice, insurance, lineItems } = validClaims[i];
      let clearinghouseResult: any = null;
      let submissionMethod = 'manual';

      if (stediService && stediApiKey && insurance && cptCodes && icd10Codes) {
        try {
          // Rate limiting: add a small delay between submissions (except the first)
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }

          // Build service lines from claim line items
          const serviceLines = lineItems.map((item: any) => {
            const cpt = cptCodes!.find((c: any) => c.id === item.cptCodeId);
            const icd = item.icd10CodeId ? icd10Codes!.find((c: any) => c.id === item.icd10CodeId) : null;
            return {
              procedureCode: cpt?.code || '',
              modifiers: item.modifier ? [item.modifier] : [],
              diagnosisCodes: icd ? [icd.code] : [],
              amount: parseFloat(item.amount) || 0,
              units: item.units || 1,
              dateOfService: item.dateOfService || new Date().toISOString().split('T')[0],
              description: cpt?.description || '',
            };
          });

          const diagnosisCodeSet = new Set(
            lineItems
              .filter((item: any) => item.icd10CodeId)
              .map((item: any) => {
                const icd = icd10Codes!.find((c: any) => c.id === item.icd10CodeId);
                return icd?.code;
              })
              .filter(Boolean) as string[]
          );
          const diagnosisCodes = Array.from(diagnosisCodeSet);

          const parseAddress = (addr: string | null) => {
            const parts = (addr || '').split(',').map(p => p.trim());
            return {
              line1: parts[0] || '',
              city: parts[1] || '',
              state: parts[2]?.split(' ')[0] || '',
              zip: parts[2]?.split(' ')[1] || parts[3] || '',
            };
          };
          const patientAddr = parseAddress(patient.address);
          const practiceAddr = parseAddress(practice.address);

          const claimSubmission: ClaimSubmission = {
            claimId: claim.claimNumber || `CLM${claim.id}`,
            totalAmount: parseFloat(claim.totalAmount as any) || 0,
            placeOfService: '11',
            dateOfService: lineItems[0]?.dateOfService || new Date().toISOString().split('T')[0],
            patient: {
              firstName: patient.firstName,
              lastName: patient.lastName,
              dateOfBirth: patient.dateOfBirth || '',
              gender: 'U',
              address: patientAddr,
              memberId: patient.insuranceId || '',
            },
            provider: {
              npi: practice.npi || '',
              taxId: practice.taxId || '',
              organizationName: practice.name,
              address: practiceAddr,
              taxonomy: '101YM0800X',
            },
            payer: {
              id: stediService.PAYER_IDS[insurance.name?.toLowerCase()] || insurance.payerCode || '00000',
              name: insurance.name || 'Unknown',
            },
            serviceLines,
            diagnosisCodes: diagnosisCodes.length > 0 ? diagnosisCodes : ['F41.1'],
          };

          clearinghouseResult = await stediService.submitClaim(claimSubmission);
          submissionMethod = 'stedi';

          logger.info('Batch claim submitted via Stedi', {
            claimId: claim.id,
            stediClaimId: clearinghouseResult.stediClaimId,
            status: clearinghouseResult.status,
          });
        } catch (stediError: any) {
          logger.error('Batch Stedi claim submission failed', { claimId: claim.id, error: stediError.message });
          clearinghouseResult = {
            success: false,
            status: 'pending',
            errors: [stediError.message],
          };
        }
      }

      // Update claim with submission info
      try {
        await storage.updateClaim(claim.id, {
          status: 'submitted',
          submittedAt: new Date(),
          submittedAmount: claim.totalAmount,
          clearinghouseClaimId: clearinghouseResult?.stediClaimId || null,
          clearinghouseStatus: clearinghouseResult?.status || 'pending',
          clearinghouseResponse: clearinghouseResult || null,
          clearinghouseSubmittedAt: new Date(),
        });

        results.push({
          claimId: claim.id,
          claimNumber: claim.claimNumber,
          success: true,
          submissionMethod,
          stediClaimId: clearinghouseResult?.stediClaimId,
        });
      } catch (updateError: any) {
        logger.error('Failed to update claim after submission', { claimId: claim.id, error: updateError.message });
        results.push({
          claimId: claim.id,
          claimNumber: claim.claimNumber,
          success: false,
          submissionMethod,
          error: 'Failed to update claim status',
        });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length + validationErrors.length;

    res.json({
      message: `Batch submission complete: ${succeeded} succeeded, ${failed} failed`,
      results,
      errors: validationErrors,
      summary: {
        total: uniqueIds.length,
        succeeded,
        failed,
      },
    });
  } catch (error: any) {
    logger.error('Error in batch claim submission', { error: error instanceof Error ? error.message : String(error) });
    safeErrorResponse(res, 500, 'Failed to process batch claim submission', error);
  }
});

// Submit claim
router.post('/:id/submit', isAuthenticated, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const claim = await storage.getClaim(claimId);

    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    if (claim.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft claims can be submitted' });
    }

    // Check if the associated SOAP note requires co-signing and is approved
    if (claim.sessionId) {
      const soapNote = await storage.getSoapNoteBySession(claim.sessionId);
      if (soapNote && soapNote.cosignStatus === 'pending') {
        return res.status(400).json({
          message: 'Cannot submit claim: SOAP note requires supervisor co-signature',
          code: 'COSIGN_REQUIRED'
        });
      }
      if (soapNote && soapNote.cosignStatus === 'rejected') {
        return res.status(400).json({
          message: 'Cannot submit claim: SOAP note was rejected by supervisor',
          code: 'COSIGN_REJECTED',
          rejectionReason: soapNote.cosignRejectionReason
        });
      }
    }

    // Get related data for claim submission
    const patient = await storage.getPatient(claim.patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const practice = await storage.getPractice(claim.practiceId);
    if (!practice) {
      return res.status(404).json({ message: 'Practice not found' });
    }

    // Get claim line items
    const lineItems = await storage.getClaimLineItems(claimId);
    if (!lineItems || lineItems.length === 0) {
      return res.status(400).json({ message: 'Claim has no line items' });
    }

    // Get insurance info
    let insurance = null;
    if (claim.insuranceId) {
      const insurances = await storage.getInsurances();
      insurance = insurances.find((i: any) => i.id === claim.insuranceId);
    }

    const stediApiKey = process.env.STEDI_API_KEY;
    let clearinghouseResult: any = null;
    let submissionMethod = 'manual';

    if (stediApiKey && insurance) {
      // Submit via Stedi
      try {
        const stediService = await import('../services/stediService');

        // Get CPT and ICD codes for line items
        const cptCodes = await storage.getCptCodes();
        const icd10Codes = await storage.getIcd10Codes();

        // Build service lines from claim line items
        const serviceLines = lineItems.map((item: any) => {
          const cpt = cptCodes.find((c: any) => c.id === item.cptCodeId);
          const icd = item.icd10CodeId ? icd10Codes.find((c: any) => c.id === item.icd10CodeId) : null;

          return {
            procedureCode: cpt?.code || '',
            modifiers: item.modifier ? [item.modifier] : [],
            diagnosisCodes: icd ? [icd.code] : [],
            amount: parseFloat(item.amount) || 0,
            units: item.units || 1,
            dateOfService: item.dateOfService || new Date().toISOString().split('T')[0],
            description: cpt?.description || '',
          };
        });

        // Get all diagnosis codes from line items
        const diagnosisCodeSet = new Set(
          lineItems
            .filter((item: any) => item.icd10CodeId)
            .map((item: any) => {
              const icd = icd10Codes.find((c: any) => c.id === item.icd10CodeId);
              return icd?.code;
            })
            .filter(Boolean) as string[]
        );
        const diagnosisCodes = Array.from(diagnosisCodeSet);

        // Simple address parser
        const parseAddress = (addr: string | null) => {
          const parts = (addr || '').split(',').map(p => p.trim());
          return {
            line1: parts[0] || '',
            city: parts[1] || '',
            state: parts[2]?.split(' ')[0] || '',
            zip: parts[2]?.split(' ')[1] || parts[3] || '',
          };
        };
        const patientAddr = parseAddress(patient.address);
        const practiceAddr = parseAddress(practice.address);

        const claimSubmission: ClaimSubmission = {
          claimId: claim.claimNumber || `CLM${claim.id}`,
          totalAmount: parseFloat(claim.totalAmount as any) || 0,
          placeOfService: '11',
          dateOfService: lineItems[0]?.dateOfService || new Date().toISOString().split('T')[0],
          patient: {
            firstName: patient.firstName,
            lastName: patient.lastName,
            dateOfBirth: patient.dateOfBirth || '',
            gender: 'U',
            address: patientAddr,
            memberId: patient.insuranceId || '',
          },
          provider: {
            npi: practice.npi || '',
            taxId: practice.taxId || '',
            organizationName: practice.name,
            address: practiceAddr,
            taxonomy: '101YM0800X',
          },
          payer: {
            id: stediService.PAYER_IDS[insurance.name?.toLowerCase()] || insurance.payerCode || '00000',
            name: insurance.name || 'Unknown',
          },
          serviceLines,
          diagnosisCodes: diagnosisCodes.length > 0 ? diagnosisCodes : ['F41.1'],
        };

        clearinghouseResult = await stediService.submitClaim(claimSubmission);
        submissionMethod = 'stedi';

        logger.info('Claim submitted via Stedi', {
          claimId,
          stediClaimId: clearinghouseResult.stediClaimId,
          status: clearinghouseResult.status,
        });
      } catch (stediError: any) {
        logger.error('Stedi claim submission failed', { error: stediError.message });
        clearinghouseResult = {
          success: false,
          status: 'pending',
          errors: [stediError.message],
        };
      }
    }

    // Update claim with submission info
    const updatedClaim = await storage.updateClaim(claimId, {
      status: 'submitted',
      submittedAt: new Date(),
      submittedAmount: claim.totalAmount,
      clearinghouseClaimId: clearinghouseResult?.stediClaimId || null,
      clearinghouseStatus: clearinghouseResult?.status || 'pending',
      clearinghouseResponse: clearinghouseResult || null,
      clearinghouseSubmittedAt: new Date(),
    });

    res.json({
      success: true,
      message: submissionMethod === 'stedi'
        ? 'Claim submitted to clearinghouse successfully'
        : 'Claim marked as submitted (manual submission)',
      claim: updatedClaim,
      clearinghouse: clearinghouseResult,
      submissionMethod,
    });
  } catch (error: any) {
    logger.error('Error submitting claim', { error: error instanceof Error ? error.message : String(error) });
    safeErrorResponse(res, 500, 'Failed to submit claim', error);
  }
});

// Check claim status via clearinghouse
router.post('/:id/check-status', isAuthenticated, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const claim = await storage.getClaim(claimId);

    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    if (claim.status === 'draft') {
      return res.status(400).json({ message: 'Claim has not been submitted yet' });
    }

    const patient = await storage.getPatient(claim.patientId);
    const practice = await storage.getPractice(claim.practiceId);

    let insurance = null;
    if (claim.insuranceId) {
      const insurances = await storage.getInsurances();
      insurance = insurances.find((i: any) => i.id === claim.insuranceId);
    }

    const stediApiKey = process.env.STEDI_API_KEY;

    if (!stediApiKey) {
      return res.json({
        success: true,
        message: 'Clearinghouse not configured - status check unavailable',
        claim,
        statusSource: 'local',
      });
    }

    if (!insurance || !patient) {
      return res.status(400).json({ message: 'Missing patient or insurance information' });
    }

    try {
      const stediService = await import('../services/stediService');

      const lineItems = await storage.getClaimLineItems(claimId);
      const dateOfService = lineItems[0]?.dateOfService || new Date().toISOString().split('T')[0];

      const statusResult = await stediService.checkClaimStatus({
        claimId: claim.claimNumber || `CLM${claim.id}`,
        payer: {
          id: stediService.PAYER_IDS[insurance.name?.toLowerCase()] || insurance.payerCode || '00000',
        },
        provider: {
          npi: practice?.npi || '',
          taxId: practice?.taxId || '',
        },
        subscriber: {
          memberId: patient.insuranceId || '',
          firstName: patient.firstName,
          lastName: patient.lastName,
          dateOfBirth: patient.dateOfBirth || '',
        },
        dateOfService,
        claimAmount: parseFloat(claim.totalAmount as any),
      });

      let updateData: any = {
        clearinghouseStatus: statusResult.status,
        clearinghouseResponse: statusResult.raw,
      };

      if (statusResult.status === 'paid' && statusResult.paidAmount) {
        updateData.status = 'paid';
        updateData.paidAmount = statusResult.paidAmount;
        updateData.paidAt = statusResult.paidDate ? new Date(statusResult.paidDate) : new Date();
      } else if (statusResult.status === 'denied') {
        updateData.status = 'denied';
        updateData.denialReason = statusResult.denialReason || 'Claim denied by payer';
      }

      const updatedClaim = await storage.updateClaim(claimId, updateData);

      res.json({
        success: true,
        message: 'Claim status retrieved from clearinghouse',
        claim: updatedClaim,
        statusResult,
        statusSource: 'stedi',
      });
    } catch (stediError: any) {
      logger.error('Stedi status check failed', { error: stediError.message });
      res.json({
        success: false,
        message: 'Failed to check status with clearinghouse',
        claim,
        error: stediError.message,
        statusSource: 'error',
      });
    }
  } catch (error: any) {
    logger.error('Error checking claim status', { error: error instanceof Error ? error.message : String(error) });
    safeErrorResponse(res, 500, 'Failed to check claim status', error);
  }
});

// ==================== CLAIM STATUS UPDATES ====================

// Mark claim as paid
router.post('/:id/paid', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const { paidAmount } = req.body;

    const claim = await storage.getClaim(claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    if (claim.status !== 'submitted') {
      return res.status(400).json({ message: 'Only submitted claims can be marked as paid' });
    }

    const updatedClaim = await storage.updateClaim(claimId, {
      status: 'paid',
      paidAt: new Date(),
      paidAmount: paidAmount?.toString() || claim.submittedAmount || claim.totalAmount,
    });

    // Check for underpayment against contracted rates
    let underpaymentInfo = null;
    try {
      underpaymentInfo = await checkClaimUnderpayment(claimId);
    } catch (underpaymentError) {
      logger.warn('Underpayment check failed (non-blocking)', {
        claimId,
        error: underpaymentError instanceof Error ? underpaymentError.message : String(underpaymentError),
      });
    }

    // Record outcome for AI learning (non-blocking)
    try {
      const practiceId = getAuthorizedPracticeId(req);
      await recordClaimOutcome({
        claimId,
        practiceId,
        status: 'paid',
        paidAmount: paidAmount?.toString() || claim.submittedAmount || claim.totalAmount,
      });
    } catch (learningError) {
      logger.warn('AI learning record failed (non-blocking)', {
        claimId,
        error: learningError instanceof Error ? learningError.message : String(learningError),
      });
    }

    res.json({
      message: 'Claim marked as paid',
      claim: updatedClaim,
      underpayment: underpaymentInfo,
    });
  } catch (error) {
    logger.error('Error marking claim paid', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to mark claim as paid' });
  }
});

// Submit to secondary insurance
router.post('/:id/submit-secondary', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const primaryClaimId = parseInt(req.params.id);
    const practiceId = getAuthorizedPracticeId(req);

    const primaryClaim = await storage.getClaim(primaryClaimId);
    if (!primaryClaim) {
      return res.status(404).json({ message: 'Primary claim not found' });
    }

    // Verify primary claim is paid/adjudicated
    if (primaryClaim.status !== 'paid') {
      return res.status(400).json({
        message: 'Primary claim must be paid/adjudicated before submitting to secondary insurance',
      });
    }

    // Get the patient to check for secondary insurance
    const patient = await storage.getPatient(primaryClaim.patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    if (!patient.secondaryInsuranceProvider) {
      return res.status(400).json({
        message: 'Patient does not have secondary insurance on file',
      });
    }

    // Calculate remaining balance after primary payment
    const totalAmount = parseFloat(primaryClaim.totalAmount || '0');
    const primaryPaidAmount = parseFloat(primaryClaim.paidAmount || '0');
    const primaryAdjustment = totalAmount - primaryPaidAmount;
    const secondaryBilledAmount = totalAmount - primaryPaidAmount;

    if (secondaryBilledAmount <= 0) {
      return res.status(400).json({
        message: 'Primary insurance already covered the full amount. No balance for secondary.',
      });
    }

    // Copy line items from primary claim
    const primaryLineItems = await storage.getClaimLineItems(primaryClaimId);

    // Build COB (Coordination of Benefits) data
    const cobData = {
      primaryInsuranceProvider: patient.insuranceProvider,
      primaryClaimNumber: primaryClaim.claimNumber,
      primaryPaidAmount: primaryPaidAmount,
      primaryAdjustmentAmount: primaryAdjustment,
      primaryPaidAt: primaryClaim.paidAt,
      totalBilledAmount: totalAmount,
      remainingBalance: secondaryBilledAmount,
    };

    // Create the secondary claim
    const claimNumber = generateSecureClaimNumber("SEC");
    const secondaryClaim = await storage.createClaim({
      practiceId,
      patientId: primaryClaim.patientId,
      sessionId: primaryClaim.sessionId,
      claimNumber,
      insuranceId: primaryClaim.insuranceId,
      totalAmount: secondaryBilledAmount.toFixed(2),
      submittedAmount: secondaryBilledAmount.toFixed(2),
      status: 'draft',
      billingOrder: 'secondary',
      primaryClaimId: primaryClaimId,
      primaryPaidAmount: primaryPaidAmount.toFixed(2),
      primaryAdjustmentAmount: primaryAdjustment.toFixed(2),
      cobData,
    });

    // Copy line items to the secondary claim, adjusting amounts proportionally
    for (const item of primaryLineItems) {
      const itemAmount = parseFloat(item.amount || '0');
      const ratio = secondaryBilledAmount / totalAmount;
      const adjustedAmount = (itemAmount * ratio).toFixed(2);

      await storage.createClaimLineItem({
        claimId: secondaryClaim.id,
        cptCodeId: item.cptCodeId,
        icd10CodeId: item.icd10CodeId,
        units: item.units,
        rate: item.rate,
        amount: adjustedAmount,
        dateOfService: item.dateOfService,
        modifier: item.modifier,
        notes: item.notes ? `${item.notes} (Secondary to ${primaryClaim.claimNumber})` : `Secondary to ${primaryClaim.claimNumber}`,
      });
    }

    logger.info('Secondary claim created', {
      primaryClaimId,
      secondaryClaimId: secondaryClaim.id,
      secondaryBilledAmount,
      patientId: patient.id,
    });

    res.json({
      message: 'Secondary claim created successfully',
      claim: secondaryClaim,
      cobData,
    });
  } catch (error) {
    logger.error('Error creating secondary claim', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create secondary claim' });
  }
});

// Deny claim
router.post('/:id/deny', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const { denialReason } = req.body;
    const practiceId = getAuthorizedPracticeId(req);

    const claim = await storage.getClaim(claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    const updatedClaim = await storage.updateClaim(claimId, {
      status: 'denied',
      denialReason: denialReason || 'No reason provided',
    });

    // Record outcome for AI learning (non-blocking)
    try {
      await recordClaimOutcome({
        claimId,
        practiceId,
        status: 'denied',
        denialReason: denialReason || 'No reason provided',
      });
    } catch (learningError) {
      logger.warn('AI learning record failed (non-blocking)', {
        claimId,
        error: learningError instanceof Error ? learningError.message : String(learningError),
      });
    }

    // Auto-generate AI appeal
    let appealResult = null;
    try {
      const lineItems = await storage.getClaimLineItems(claimId);
      const patient = await storage.getPatient(claim.patientId);
      const practice = await storage.getPractice(practiceId);

      const cptCodes = await storage.getCptCodes();
      const icd10Codes = await storage.getIcd10Codes();

      const enrichedLineItems = lineItems.map((item: any) => ({
        ...item,
        cptCode: cptCodes.find((c: any) => c.id === item.cptCodeId),
        icd10Code: icd10Codes.find((c: any) => c.id === item.icd10CodeId),
      }));

      if (patient && practice) {
        appealResult = await appealGenerator.generateAppealWithClaude(
          { ...updatedClaim, denialReason: denialReason || 'No reason provided' },
          enrichedLineItems,
          patient,
          practice
        );

        await storage.createReimbursementOptimization({
          practiceId,
          claimId,
          originalAmount: claim.totalAmount,
          optimizedAmount: claim.totalAmount,
          improvementAmount: "0",
          ourShareAmount: "0",
          optimizationType: 'appeal',
          optimizationNotes: JSON.stringify({
            appealLetter: appealResult.appealLetter,
            denialCategory: appealResult.denialCategory,
            successProbability: appealResult.successProbability,
            suggestedActions: appealResult.suggestedActions,
            keyArguments: appealResult.keyArguments,
            generatedAt: appealResult.generatedAt,
          }),
          status: 'pending',
        });

        await storage.updateClaim(claimId, {
          aiReviewNotes: `AI Appeal Generated (${appealResult.successProbability}% success probability). Category: ${appealResult.denialCategory}`,
        });
      }
    } catch (aiError) {
      logger.error('Error generating AI appeal', { error: aiError instanceof Error ? aiError.message : String(aiError) });
    }

    res.json({
      message: 'Claim marked as denied',
      claim: updatedClaim,
      appealGenerated: !!appealResult,
      appeal: appealResult ? {
        denialCategory: appealResult.denialCategory,
        successProbability: appealResult.successProbability,
        suggestedActions: appealResult.suggestedActions,
      } : null,
    });
  } catch (error) {
    logger.error('Error denying claim', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to deny claim' });
  }
});

// ==================== APPEALS ====================

// Get appeals for a claim
router.get('/:id/appeals', isAuthenticated, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const appeals = await storage.getClaimAppeals(claimId);

    const parsedAppeals = appeals.map((appeal: any) => {
      let notes = {};
      try {
        notes = JSON.parse(appeal.optimizationNotes || '{}');
      } catch (e) {
        notes = { raw: appeal.optimizationNotes };
      }
      return {
        ...appeal,
        parsedNotes: notes,
      };
    });

    res.json(parsedAppeals);
  } catch (error) {
    logger.error('Error fetching appeals', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch appeals' });
  }
});

// Mark appeal as sent
router.post('/:id/appeals/:appealId/sent', isAuthenticated, async (req: any, res) => {
  try {
    const appealId = parseInt(req.params.appealId);
    const updated = await storage.updateAppealStatus(appealId, 'sent', new Date());

    if (!updated) {
      return res.status(404).json({ message: 'Appeal not found' });
    }

    res.json({
      message: 'Appeal marked as sent',
      appeal: updated,
    });
  } catch (error) {
    logger.error('Error updating appeal status', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update appeal status' });
  }
});

// Mark appeal as completed (won/paid)
router.post('/:id/appeals/:appealId/completed', isAuthenticated, async (req: any, res) => {
  try {
    const appealId = parseInt(req.params.appealId);
    const updated = await storage.updateAppealStatus(appealId, 'completed', new Date());

    if (!updated) {
      return res.status(404).json({ message: 'Appeal not found' });
    }

    res.json({
      message: 'Appeal marked as completed',
      appeal: updated,
    });
  } catch (error) {
    logger.error('Error updating appeal status', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update appeal status' });
  }
});

// Mark appeal as failed
router.post('/:id/appeals/:appealId/failed', isAuthenticated, async (req: any, res) => {
  try {
    const appealId = parseInt(req.params.appealId);
    const updated = await storage.updateAppealStatus(appealId, 'failed', new Date());

    if (!updated) {
      return res.status(404).json({ message: 'Appeal not found' });
    }

    res.json({
      message: 'Appeal marked as failed',
      appeal: updated,
    });
  } catch (error) {
    logger.error('Error updating appeal status', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update appeal status' });
  }
});

// Regenerate appeal for a denied claim
router.post('/:id/regenerate-appeal', isAuthenticated, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const practiceId = getAuthorizedPracticeId(req);

    const claim = await storage.getClaim(claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    if (claim.status !== 'denied') {
      return res.status(400).json({ message: 'Can only regenerate appeals for denied claims' });
    }

    const lineItems = await storage.getClaimLineItems(claimId);
    const patient = await storage.getPatient(claim.patientId);
    const practice = await storage.getPractice(practiceId);

    if (!patient || !practice) {
      return res.status(400).json({ message: 'Missing patient or practice data' });
    }

    const cptCodes = await storage.getCptCodes();
    const icd10Codes = await storage.getIcd10Codes();

    const enrichedLineItems = lineItems.map((item: any) => ({
      ...item,
      cptCode: cptCodes.find((c: any) => c.id === item.cptCodeId),
      icd10Code: icd10Codes.find((c: any) => c.id === item.icd10CodeId),
    }));

    const appealResult = await appealGenerator.generateAppeal(
      claim,
      enrichedLineItems,
      patient,
      practice
    );

    const newAppeal = await storage.createReimbursementOptimization({
      practiceId,
      claimId,
      originalAmount: claim.totalAmount,
      optimizedAmount: claim.totalAmount,
      improvementAmount: "0",
      ourShareAmount: "0",
      optimizationType: 'appeal',
      optimizationNotes: JSON.stringify({
        appealLetter: appealResult.appealLetter,
        denialCategory: appealResult.denialCategory,
        successProbability: appealResult.successProbability,
        suggestedActions: appealResult.suggestedActions,
        keyArguments: appealResult.keyArguments,
        generatedAt: appealResult.generatedAt,
      }),
      status: 'pending',
    });

    res.json({
      message: 'Appeal regenerated successfully',
      appeal: {
        id: newAppeal.id,
        ...appealResult,
      },
    });
  } catch (error) {
    logger.error('Error regenerating appeal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to regenerate appeal' });
  }
});

// ==================== ANALYTICS ====================

// Claims by status
router.get('/analytics/by-status', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const statusData = await storage.getClaimsByStatus(practiceId);
    res.json(statusData);
  } catch (error) {
    logger.error('Error fetching claims by status', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch claims analytics' });
  }
});

// Denial reasons
router.get('/analytics/denial-reasons', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const denialData = await storage.getTopDenialReasons(practiceId);
    res.json(denialData);
  } catch (error) {
    logger.error('Error fetching denial reasons', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch denial reasons' });
  }
});

// ==================== AI DENIAL PREDICTION ====================

/**
 * @openapi
 * /api/claims/{id}/predict-denial:
 *   post:
 *     tags: [Claims]
 *     summary: Predict denial risk for a draft claim
 *     description: Uses AI to analyze a draft claim and predict the likelihood of denial, with actionable suggestions.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Denial prediction result
 *       400:
 *         description: Invalid claim ID or claim not in draft status
 *       404:
 *         description: Claim not found
 *       500:
 *         description: Server error
 */
router.post('/:id/predict-denial', isAuthenticated, async (req: any, res) => {
  try {
    const claimId = validatePositiveInt(req.params.id);
    if (claimId === null) {
      return res.status(400).json({ message: 'Invalid claim ID' });
    }

    const claim = await storage.getClaim(claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    // Security: Verify user has access to this claim's practice
    const userPracticeId = req.userPracticeId;
    const userRole = req.userRole;
    if (userRole !== 'admin' && claim.practiceId !== userPracticeId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get line items with enriched CPT/ICD-10 data
    const lineItems = await storage.getClaimLineItems(claimId);
    const cptCodesAll = await storage.getCptCodes();
    const icd10CodesAll = await storage.getIcd10Codes();

    const enrichedLineItems = lineItems.map((item: any) => {
      const cptCode = cptCodesAll.find((c: any) => c.id === item.cptCodeId);
      const icd10Code = icd10CodesAll.find((i: any) => i.id === item.icd10CodeId);
      return {
        ...item,
        cptCode: cptCode ? { code: cptCode.code, description: cptCode.description } : null,
        icd10Code: icd10Code ? { code: icd10Code.code, description: icd10Code.description } : null,
      };
    });

    // Get SOAP note if session exists
    let soapNote = null;
    if (claim.sessionId) {
      soapNote = await storage.getSoapNoteBySession(claim.sessionId);
    }

    // Get patient
    const patient = await storage.getPatient(claim.patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Run prediction
    const prediction = await predictDenial(
      {
        id: claim.id,
        claimNumber: claim.claimNumber,
        totalAmount: claim.totalAmount,
        status: claim.status,
        insuranceId: claim.insuranceId,
        sessionId: claim.sessionId,
      },
      enrichedLineItems,
      soapNote ?? null,
      {
        firstName: patient.firstName,
        lastName: patient.lastName,
        dateOfBirth: patient.dateOfBirth,
        insuranceProvider: patient.insuranceProvider,
        insuranceId: patient.insuranceId,
      }
    );

    // Store prediction on the claim
    await storage.updateClaim(claimId, {
      denialPrediction: prediction as any,
    });

    res.json(prediction);
  } catch (error) {
    logger.error('Error predicting denial', {
      error: error instanceof Error ? error.message : String(error),
    });
    safeErrorResponse(res, 500, 'Failed to predict denial risk', error);
  }
});

// ==================== BULK OPERATIONS ====================

/**
 * POST /api/claims/bulk-submit
 * Submit multiple claims in bulk. Each claim is validated independently.
 */
router.post('/bulk-submit', isAuthenticated, async (req: any, res) => {
  try {
    const { claimIds } = req.body;

    if (!Array.isArray(claimIds) || claimIds.length === 0) {
      return res.status(400).json({ message: 'claimIds must be a non-empty array' });
    }

    if (claimIds.length > 100) {
      return res.status(400).json({ message: 'Maximum 100 claims per bulk submission' });
    }

    // Validate and deduplicate IDs
    const parsedIds: number[] = [];
    for (const id of claimIds) {
      const parsed = parseInt(id, 10);
      if (isNaN(parsed) || parsed <= 0) {
        return res.status(400).json({ message: `Invalid claim ID: ${id}` });
      }
      parsedIds.push(parsed);
    }
    const uniqueIds = Array.from(new Set(parsedIds));

    const practiceId = getAuthorizedPracticeId(req);
    const results = await bulkSubmitClaims(uniqueIds, practiceId);

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      message: `Bulk submission complete: ${succeeded} succeeded, ${failed} failed`,
      results,
      summary: { total: uniqueIds.length, succeeded, failed },
    });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to process bulk claim submission', error);
  }
});

/**
 * PATCH /api/claims/bulk-status
 * Update status of multiple claims in bulk.
 */
router.patch('/bulk-status', isAuthenticated, async (req: any, res) => {
  try {
    const { claimIds, status } = req.body;

    if (!Array.isArray(claimIds) || claimIds.length === 0) {
      return res.status(400).json({ message: 'claimIds must be a non-empty array' });
    }

    if (!status || typeof status !== 'string') {
      return res.status(400).json({ message: 'status is required and must be a string' });
    }

    if (claimIds.length > 100) {
      return res.status(400).json({ message: 'Maximum 100 claims per bulk status update' });
    }

    const parsedIds: number[] = [];
    for (const id of claimIds) {
      const parsed = parseInt(id, 10);
      if (isNaN(parsed) || parsed <= 0) {
        return res.status(400).json({ message: `Invalid claim ID: ${id}` });
      }
      parsedIds.push(parsed);
    }
    const uniqueIds = Array.from(new Set(parsedIds));

    const practiceId = getAuthorizedPracticeId(req);
    const results = await bulkUpdateClaimStatus(uniqueIds, status, practiceId);

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      message: `Bulk status update complete: ${succeeded} succeeded, ${failed} failed`,
      results,
      summary: { total: uniqueIds.length, succeeded, failed },
    });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to process bulk status update', error);
  }
});

/**
 * GET /api/claims/bulk-export
 * Export claims as CSV with optional filters.
 */
router.get('/bulk-export', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);

    const filters = {
      status: req.query.status as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
      payerName: req.query.payerName as string | undefined,
    };

    const csv = await bulkExportClaims(practiceId, filters);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="claims-export.csv"');
    res.send(csv);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to export claims', error);
  }
});

export default router;
