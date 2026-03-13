/**
 * Appeals Routes
 *
 * Handles:
 * - GET /api/appeals/dashboard - Appeals dashboard stats
 * - GET /api/appeals/deadlines - Upcoming appeal deadlines
 * - GET /api/appeals/denied-claims - Denied claims available for appeal
 * - GET /api/appeals - List all appeals with filters
 * - GET /api/appeals/:id - Get single appeal
 * - POST /api/appeals - Create new appeal from denied claim
 * - PATCH /api/appeals/:id - Update appeal
 * - POST /api/appeals/:id/submit - Submit appeal to payer
 * - POST /api/appeals/:id/resolve - Resolve appeal (won/lost/partial)
 * - POST /api/appeals/:id/escalate - Escalate appeal to next level
 * - POST /api/appeals/:id/regenerate-letter - Regenerate AI appeal letter
 *
 * Mounted at /api so all paths include their full prefix.
 */

import { Router } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { appealGenerator } from '../aiAppealGenerator';
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

// Get appeals dashboard
router.get('/appeals/dashboard', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const dashboard = await storage.getAppealsDashboard(practiceId);
    res.json(dashboard);
  } catch (error) {
    logger.error('Error fetching appeals dashboard', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch appeals dashboard' });
  }
});

// Get upcoming deadlines
router.get('/appeals/deadlines', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const days = parseInt(req.query.days as string) || 30;
    const deadlines = await storage.getUpcomingDeadlines(practiceId, days);
    res.json(deadlines);
  } catch (error) {
    logger.error('Error fetching appeal deadlines', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch appeal deadlines' });
  }
});

// Get denied claims available for appeal
router.get('/appeals/denied-claims', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const deniedClaims = await storage.getDeniedClaimsForAppeals(practiceId);

    // Enrich with patient info (batch query, not N+1)
    const claimPatientIds = Array.from(new Set(deniedClaims.map((c: any) => c.patientId).filter((id: any): id is number => id != null)));
    const claimPatientsMap = await storage.getPatientsByIds(claimPatientIds);
    const enrichedClaims = deniedClaims.map((claim: any) => {
      const patient = claim.patientId ? claimPatientsMap.get(claim.patientId) : undefined;
      return {
        ...claim,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown',
      };
    });

    res.json(enrichedClaims);
  } catch (error) {
    logger.error('Error fetching denied claims', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch denied claims' });
  }
});

// Get all appeals with filters
router.get('/appeals', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters: any = {};

    if (req.query.status) filters.status = req.query.status;
    if (req.query.appealLevel) filters.appealLevel = req.query.appealLevel;
    if (req.query.deadlineWithinDays) filters.deadlineWithinDays = parseInt(req.query.deadlineWithinDays);

    const appeals = await storage.getAppeals(practiceId, filters);

    // Enrich with claim and patient info (batch queries, not N+1)
    const appealClaimIds = Array.from(new Set(appeals.map((a: any) => a.claimId).filter((id: any): id is number => id != null)));
    const appealsClaimsMap = await storage.getClaimsByIds(appealClaimIds);
    const appealPatientIds = Array.from(new Set(
      Array.from(appealsClaimsMap.values()).map(c => c.patientId).filter((id): id is number => id != null)
    ));
    const appealPatientsMap = await storage.getPatientsByIds(appealPatientIds);
    const enrichedAppeals = appeals.map((appeal: any) => {
      const claim = appealsClaimsMap.get(appeal.claimId);
      const patient = claim?.patientId ? appealPatientsMap.get(claim.patientId) : undefined;
      return {
        ...appeal,
        claim: claim ? {
          id: claim.id,
          claimNumber: claim.claimNumber,
          totalAmount: claim.totalAmount,
          denialReason: claim.denialReason,
        } : null,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown',
      };
    });

    res.json(enrichedAppeals);
  } catch (error) {
    logger.error('Error fetching appeals', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch appeals' });
  }
});

// Get single appeal by ID
router.get('/appeals/:id', isAuthenticated, async (req: any, res) => {
  try {
    const appealId = parseInt(req.params.id);
    const appeal = await storage.getAppealById(appealId);

    if (!appeal) {
      return res.status(404).json({ message: 'Appeal not found' });
    }

    // Enrich with claim and patient info
    const claim = await storage.getClaim(appeal.claimId);
    const patient = claim?.patientId ? await storage.getPatient(claim.patientId) : null;

    res.json({
      ...appeal,
      claim: claim ? {
        id: claim.id,
        claimNumber: claim.claimNumber,
        totalAmount: claim.totalAmount,
        denialReason: claim.denialReason,
        submittedAt: claim.submittedAt,
        paidAmount: claim.paidAmount,
      } : null,
      patient: patient ? {
        id: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        insuranceProvider: patient.insuranceProvider,
      } : null,
    });
  } catch (error) {
    logger.error('Error fetching appeal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch appeal' });
  }
});

// Create new appeal from denied claim
router.post('/appeals', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { claimId, deadlineDate, notes } = req.body;

    if (!claimId) {
      return res.status(400).json({ message: 'claimId is required' });
    }

    // Get the claim
    const claim = await storage.getClaim(claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    if (claim.status !== 'denied') {
      return res.status(400).json({ message: 'Can only create appeal for denied claims' });
    }

    // Get patient info for AI appeal generation
    const patient = claim.patientId ? await storage.getPatient(claim.patientId) : null;

    // Generate AI appeal letter
    let appealResult = null;
    try {
      // Get line items for the claim
      const lineItems = await storage.getClaimLineItems(claimId);
      const formattedLineItems = lineItems.map((item: any) => ({
        cptCode: item.cptCodeId ? { code: String(item.cptCodeId), description: '' } : undefined,
        icd10Code: item.diagnosisCodeId ? { code: String(item.diagnosisCodeId), description: '' } : undefined,
        units: item.units || 1,
        amount: item.amount || '0',
      }));
      const practice = { name: 'Practice', npi: null, address: null, phone: null };
      const patientData = patient ? {
        firstName: patient.firstName,
        lastName: patient.lastName,
        dateOfBirth: patient.dateOfBirth,
        insuranceProvider: patient.insuranceProvider,
        insuranceId: patient.insuranceId,
      } : { firstName: 'Unknown', lastName: 'Patient', dateOfBirth: null, insuranceProvider: null, insuranceId: null };

      appealResult = await appealGenerator.generateAppeal(
        { ...claim, denialReason: claim.denialReason || 'No reason provided' },
        formattedLineItems,
        patientData,
        practice
      );
    } catch (aiError) {
      logger.error('Error generating AI appeal', { error: aiError instanceof Error ? aiError.message : String(aiError) });
    }

    // Calculate deadline (default: 60 days from now if not specified)
    const calculatedDeadline = deadlineDate ||
      new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const appeal = await storage.createAppeal({
      claimId,
      practiceId,
      appealLevel: 'initial',
      status: appealResult ? 'ready' : 'draft',
      denialCategory: appealResult?.denialCategory || null,
      deadlineDate: calculatedDeadline,
      appealedAmount: claim.totalAmount,
      appealLetter: appealResult?.appealLetter || null,
      notes,
      supportingDocs: [],
    });

    // Update claim status to appeal
    await storage.updateClaim(claimId, { status: 'appeal' });

    res.json({
      message: 'Appeal created successfully',
      appeal: {
        ...appeal,
        aiGenerated: !!appealResult,
        successProbability: appealResult?.successProbability,
        suggestedActions: appealResult?.suggestedActions,
      },
    });
  } catch (error) {
    logger.error('Error creating appeal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create appeal' });
  }
});

// Update appeal
router.patch('/appeals/:id', isAuthenticated, async (req: any, res) => {
  try {
    const appealId = parseInt(req.params.id);
    const updates = req.body;

    const existingAppeal = await storage.getAppealById(appealId);
    if (!existingAppeal) {
      return res.status(404).json({ message: 'Appeal not found' });
    }

    // Don't allow updates to resolved appeals
    if (['won', 'lost', 'partial'].includes(existingAppeal.status) &&
        !['notes', 'supportingDocs'].includes(Object.keys(updates)[0])) {
      return res.status(400).json({ message: 'Cannot modify resolved appeals' });
    }

    const updatedAppeal = await storage.updateAppealRecord(appealId, updates);
    res.json(updatedAppeal);
  } catch (error) {
    logger.error('Error updating appeal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update appeal' });
  }
});

// Submit appeal to payer
router.post('/appeals/:id/submit', isAuthenticated, async (req: any, res) => {
  try {
    const appealId = parseInt(req.params.id);

    const appeal = await storage.getAppealById(appealId);
    if (!appeal) {
      return res.status(404).json({ message: 'Appeal not found' });
    }

    if (!appeal.appealLetter) {
      return res.status(400).json({ message: 'Appeal letter is required before submission' });
    }

    const updatedAppeal = await storage.updateAppealRecord(appealId, {
      status: 'submitted',
      submittedDate: new Date(),
    });

    res.json({
      message: 'Appeal marked as submitted',
      appeal: updatedAppeal,
    });
  } catch (error) {
    logger.error('Error submitting appeal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to submit appeal' });
  }
});

// Resolve appeal (won/lost/partial)
router.post('/appeals/:id/resolve', isAuthenticated, async (req: any, res) => {
  try {
    const appealId = parseInt(req.params.id);
    const { outcome, recoveredAmount, insurerResponse } = req.body;

    if (!['won', 'lost', 'partial'].includes(outcome)) {
      return res.status(400).json({ message: 'Invalid outcome. Must be won, lost, or partial' });
    }

    const appeal = await storage.getAppealById(appealId);
    if (!appeal) {
      return res.status(404).json({ message: 'Appeal not found' });
    }

    const updatedAppeal = await storage.updateAppealRecord(appealId, {
      status: outcome,
      resolvedDate: new Date(),
      recoveredAmount: recoveredAmount || (outcome === 'won' ? appeal.appealedAmount : '0'),
      insurerResponse,
    });

    // Update claim status based on outcome
    if (outcome === 'won') {
      await storage.updateClaim(appeal.claimId, {
        status: 'paid',
        paidAmount: recoveredAmount || appeal.appealedAmount,
        paidAt: new Date(),
      });
    } else if (outcome === 'partial') {
      await storage.updateClaim(appeal.claimId, {
        status: 'paid',
        paidAmount: recoveredAmount,
        paidAt: new Date(),
      });
    }

    res.json({
      message: `Appeal resolved as ${outcome}`,
      appeal: updatedAppeal,
    });
  } catch (error) {
    logger.error('Error resolving appeal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to resolve appeal' });
  }
});

// Escalate appeal to next level
router.post('/appeals/:id/escalate', isAuthenticated, async (req: any, res) => {
  try {
    const appealId = parseInt(req.params.id);
    const { newDeadlineDate, notes } = req.body;

    const appeal = await storage.getAppealById(appealId);
    if (!appeal) {
      return res.status(404).json({ message: 'Appeal not found' });
    }

    // Determine next level
    const levelProgression: Record<string, string> = {
      'initial': 'first_appeal',
      'first_appeal': 'second_appeal',
      'second_appeal': 'external_review',
    };

    const nextLevel = levelProgression[appeal.appealLevel];
    if (!nextLevel) {
      return res.status(400).json({ message: 'Cannot escalate further. Already at external review level.' });
    }

    // Mark current appeal as lost (since we're escalating)
    await storage.updateAppealRecord(appealId, {
      status: 'lost',
      resolvedDate: new Date(),
      notes: (appeal.notes || '') + '\n\nEscalated to ' + nextLevel,
    });

    // Get claim for new appeal
    const claim = await storage.getClaim(appeal.claimId);

    // Create new appeal at next level
    const newAppeal = await storage.createAppeal({
      claimId: appeal.claimId,
      practiceId: appeal.practiceId,
      appealLevel: nextLevel,
      status: 'draft',
      denialCategory: appeal.denialCategory,
      deadlineDate: newDeadlineDate ||
        new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      appealedAmount: appeal.appealedAmount,
      notes: notes || `Escalated from ${appeal.appealLevel}`,
      supportingDocs: appeal.supportingDocs as any,
    });

    res.json({
      message: `Appeal escalated to ${nextLevel}`,
      previousAppeal: { id: appealId, status: 'lost' },
      newAppeal,
    });
  } catch (error) {
    logger.error('Error escalating appeal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to escalate appeal' });
  }
});

// Regenerate AI appeal letter for existing appeal
router.post('/appeals/:id/regenerate-letter', isAuthenticated, async (req: any, res) => {
  try {
    const appealId = parseInt(req.params.id);
    const { additionalContext } = req.body;

    const appeal = await storage.getAppealById(appealId);
    if (!appeal) {
      return res.status(404).json({ message: 'Appeal not found' });
    }

    const claim = await storage.getClaim(appeal.claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Associated claim not found' });
    }

    const patient = claim.patientId ? await storage.getPatient(claim.patientId) : null;

    // Generate new AI appeal letter
    const lineItems = await storage.getClaimLineItems(appeal.claimId);
    const formattedLineItems = lineItems.map((item: any) => ({
      cptCode: item.cptCodeId ? { code: String(item.cptCodeId), description: '' } : undefined,
      icd10Code: item.diagnosisCodeId ? { code: String(item.diagnosisCodeId), description: '' } : undefined,
      units: item.units || 1,
      amount: item.amount || '0',
    }));
    const practice = { name: 'Practice', npi: null, address: null, phone: null };
    const patientData = patient ? {
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      insuranceProvider: patient.insuranceProvider,
      insuranceId: patient.insuranceId,
    } : { firstName: 'Unknown', lastName: 'Patient', dateOfBirth: null, insuranceProvider: null, insuranceId: null };

    const appealResult = await appealGenerator.generateAppeal(
      { ...claim, denialReason: claim.denialReason || 'No reason provided' },
      formattedLineItems,
      patientData,
      practice
    );

    // Update appeal with new letter
    const updatedAppeal = await storage.updateAppealRecord(appealId, {
      appealLetter: appealResult.appealLetter,
      denialCategory: appealResult.denialCategory,
      status: 'ready',
    });

    res.json({
      message: 'Appeal letter regenerated',
      appeal: updatedAppeal,
      successProbability: appealResult.successProbability,
      suggestedActions: appealResult.suggestedActions,
    });
  } catch (error) {
    logger.error('Error regenerating appeal letter', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to regenerate appeal letter' });
  }
});

export default router;
