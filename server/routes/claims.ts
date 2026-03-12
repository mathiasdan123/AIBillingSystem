/**
 * Claims Routes
 *
 * Handles:
 * - /api/claims - Claims CRUD operations
 * - /api/claims/:id/line-items - Claim line items management
 * - /api/claims/:id/submit - Claim submission
 * - /api/claims/:id/check-status - Status verification
 * - /api/claims/:id/paid - Mark claim as paid
 * - /api/claims/:id/deny - Deny claim (with AI appeal generation)
 * - /api/claims/:id/appeals - Appeal management
 * - /api/claims/:id/regenerate-appeal - Regenerate AI appeal
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

// Get all claims for practice
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    // TODO: Move pagination to DB layer (pass limit/offset to storage) to avoid loading all rows into memory
    const allClaims = await storage.getClaims(practiceId);
    const total = allClaims.length;
    const { page, limit, offset } = parsePagination(req.query);
    const claims = allClaims.slice(offset, offset + limit);
    res.json(paginatedResponse(claims, total, page, limit));
  } catch (error) {
    logger.error('Error fetching claims', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch claims' });
  }
});

// Get single claim with line items
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

    res.json({
      ...claim,
      lineItems: enrichedLineItems,
    });
  } catch (error) {
    logger.error('Error fetching claim', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch claim' });
  }
});

// Create new claim with AI optimization
router.post('/', isAuthenticated, validate(createClaimSchema), async (req: any, res) => {
  try {
    const { patientId, insuranceId, totalAmount, submittedAmount, sessionId } = req.body;
    const practiceId = getAuthorizedPracticeId(req);

    const claimNumber = generateSecureClaimNumber("CLM");

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

    res.json({
      message: 'Claim marked as paid',
      claim: updatedClaim
    });
  } catch (error) {
    logger.error('Error marking claim paid', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to mark claim as paid' });
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
        appealResult = await appealGenerator.generateAppeal(
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

export default router;
