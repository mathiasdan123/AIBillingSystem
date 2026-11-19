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
import { recordAppealOutcome } from '../services/appealOutcomeLearningService';
import {
  type AppealGrounding,
  type AppealGroundingInputs,
  assessAppealReadiness,
  buildAppealGrounding,
  computeAppealDeadline,
  defaultAppealGroundingLookups,
  describeDeadlineBasis,
  emptyAppealGrounding,
  filterUnsupportedKeyArguments,
  isValidDateOnly,
  normalizeGroundingInputs,
  stripUnsupportedAppealAssertions,
} from '../services/appealGroundingService';
import logger from '../services/logger';
import { recordClaimEvent, clip } from '../services/claimEventService';

const router = Router();

/**
 * Everything the letter generator and the readiness check need for one
 * claim: the practice letterhead, the patient identifiers, the line items,
 * and the grounding (what records exist + what the biller entered). Shared
 * by create and regenerate so the two can never drift (QA 2026-11-18).
 */
async function buildLetterContext(req: any, practiceId: number, claim: any, inputs: AppealGroundingInputs) {
  const patient = claim.patientId ? await storage.getPatient(claim.patientId) : null;
  const lineItems = await storage.getClaimLineItems(claim.id);
  const formattedLineItems = (lineItems || []).map((item: any) => ({
    cptCode: item.cptCodeId ? { code: String(item.cptCodeId), description: '' } : undefined,
    icd10Code: item.diagnosisCodeId ? { code: String(item.diagnosisCodeId), description: '' } : undefined,
    units: item.units || 1,
    amount: item.amount || '0',
  }));
  // Fetch the practice so the rendered letter uses the real practice name,
  // NPI, address, phone — appeals letters are sent to payers and must
  // identify the billing provider. Placeholders only if the row is missing,
  // and the readiness check then refuses to call the letter ready.
  const practiceRecord = await storage.getPractice(practiceId);
  // The signer is whoever is preparing the appeal; the biller can change the
  // name in the editable letter. Older storage stubs have no getUser.
  let providerName: string | null = null;
  const userId = req.user?.claims?.sub;
  if (userId && typeof (storage as any).getUser === 'function') {
    try {
      const user = await (storage as any).getUser(userId);
      const full = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
      providerName = full || null;
    } catch {
      providerName = null;
    }
  }
  const practice = {
    name: practiceRecord?.name ?? 'Practice',
    npi: practiceRecord?.npi ?? null,
    address: practiceRecord?.address ?? null,
    phone: practiceRecord?.phone ?? null,
    providerName,
  };
  const patientData = patient ? {
    firstName: patient.firstName,
    lastName: patient.lastName,
    dateOfBirth: patient.dateOfBirth,
    insuranceProvider: patient.insuranceProvider,
    insuranceId: patient.insuranceId,
  } : { firstName: 'Unknown', lastName: 'Patient', dateOfBirth: null, insuranceProvider: null, insuranceId: null };

  const grounding: AppealGrounding = await buildAppealGrounding(
    { practiceId, patientId: claim.patientId, claim, inputs },
    defaultAppealGroundingLookups(storage),
  );
  let planBenefits: any = null;
  if (claim.patientId && typeof (storage as any).getPatientPlanBenefits === 'function') {
    try {
      planBenefits = await (storage as any).getPatientPlanBenefits(claim.patientId);
    } catch {
      planBenefits = null;
    }
  }
  return { patient, practiceRecord, practice, patientData, formattedLineItems, grounding, planBenefits };
}

function readinessFor(ctx: Awaited<ReturnType<typeof buildLetterContext>>, claim: any, letter: string | null | undefined, denialDate: string | null | undefined) {
  return assessAppealReadiness({
    letter,
    practice: ctx.practice,
    patient: ctx.patient,
    claim,
    grounding: ctx.grounding,
    denialDate,
  });
}

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

/**
 * Load an appeal and verify it belongs to the caller's practice.
 * Returns the appeal, or null after sending a 404 response (caller should
 * `return` immediately when null). Uses 404 — not 403 — to avoid leaking
 * the existence of appeals owned by another practice.
 */
async function loadAppealForCaller(req: any, res: any, appealId: number) {
  const practiceId = getAuthorizedPracticeId(req);
  const appeal = await storage.getAppealById(appealId);
  if (!appeal || appeal.practiceId !== practiceId) {
    res.status(404).json({ message: 'Appeal not found' });
    return null;
  }
  return appeal;
}

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
    if (req.query.claimId) {
      const claimId = parseInt(String(req.query.claimId), 10);
      if (Number.isInteger(claimId) && claimId > 0) filters.claimId = claimId;
    }
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
        deadlineBasis: describeDeadlineBasis(appeal),
        readinessIssues: Array.isArray(appeal.readinessIssues) ? appeal.readinessIssues : [],
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
    const appeal = await loadAppealForCaller(req, res, appealId);
    if (!appeal) return;

    // Enrich with claim and patient info
    const claim = await storage.getClaim(appeal.claimId);
    const patient = claim?.patientId ? await storage.getPatient(claim.patientId) : null;

    res.json({
      ...appeal,
      // Where the filing deadline came from, for the drawer ("Denial date +
      // 180 days (payer plan appeal rights)" / "estimated — verify").
      deadlineBasis: describeDeadlineBasis(appeal as any),
      readinessIssues: Array.isArray((appeal as any).readinessIssues) ? (appeal as any).readinessIssues : [],
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
    if (deadlineDate != null && deadlineDate !== '' && !isValidDateOnly(deadlineDate)) {
      return res.status(400).json({ message: 'deadlineDate must be a valid YYYY-MM-DD date' });
    }
    if (req.body.denialDate != null && req.body.denialDate !== '' && !isValidDateOnly(req.body.denialDate)) {
      return res.status(400).json({ message: 'denialDate must be a valid YYYY-MM-DD date' });
    }

    // Get the claim. Tenant check (added 2026-11-18): claim ids are serial
    // and this route filed appeals, and read patient/denial data, for any
    // id it was given. 404, not 403, so cross-practice ids are not confirmed.
    const claim = await storage.getClaim(claimId);
    if (!claim || claim.practiceId !== practiceId) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    if (claim.status !== 'denied') {
      return res.status(400).json({ message: 'Can only create appeal for denied claims' });
    }

    // What the biller told us that no record can: urgent service, a
    // retro-auth request, extra grounds, the denial date from the EOB. The
    // letter may assert these ONLY because they are here.
    const groundingInputs = normalizeGroundingInputs(req.body);

    // Letterhead, identifiers, line items, and the grounding (what records
    // actually exist for this patient). One failure here must not produce a
    // letter that claims records exist: the context falls back to "nothing
    // on file", and the readiness check reports it.
    let ctx: Awaited<ReturnType<typeof buildLetterContext>> | null = null;
    let appealResult = null;
    try {
      ctx = await buildLetterContext(req, practiceId, claim, groundingInputs);
      appealResult = await appealGenerator.generateAppeal(
        { ...claim, denialReason: claim.denialReason || 'No reason provided' },
        ctx.formattedLineItems,
        ctx.patientData,
        ctx.practice,
        ctx.grounding,
      );
    } catch (aiError) {
      logger.error('Error generating AI appeal', { error: aiError instanceof Error ? aiError.message : String(aiError) });
    }
    const grounding = ctx?.grounding ?? emptyAppealGrounding(groundingInputs);

    // Belt and braces: whatever generated the letter, nothing unsupported
    // reaches the stored text or the structured arguments.
    const appealLetter = appealResult ? stripUnsupportedAppealAssertions(appealResult.appealLetter, grounding) : null;
    const keyArguments = appealResult ? filterUnsupportedKeyArguments(appealResult.keyArguments, grounding) : null;

    // Deadline: denial date + a window with a recorded source. A deadline the
    // biller typed in the form wins and is recorded as manual.
    const basis = computeAppealDeadline({
      denialDate: groundingInputs.denialDate,
      planBenefits: ctx?.planBenefits,
      practice: ctx?.practiceRecord as any,
    });
    const manualDeadline = deadlineDate ? String(deadlineDate).slice(0, 10) : null;

    // "Ready" is earned, not assumed: no placeholders, identifiers present,
    // clinical records on file, denial date known, no unsupported assertion.
    const readiness = ctx
      ? readinessFor(ctx, claim, appealLetter, groundingInputs.denialDate)
      : { ready: false, issues: ['Letter context could not be loaded'] };

    const appeal = await storage.createAppeal({
      claimId,
      practiceId,
      appealLevel: 'initial',
      status: appealLetter && readiness.ready ? 'ready' : 'draft',
      denialCategory: appealResult?.denialCategory || null,
      deadlineDate: manualDeadline ?? basis.deadlineDate,
      denialDate: groundingInputs.denialDate ?? null,
      deadlineSource: manualDeadline ? 'manual' : basis.source,
      deadlinePolicyDays: manualDeadline ? null : basis.policyDays,
      groundingInputs: groundingInputs as any,
      readinessIssues: readiness.issues as any,
      appealedAmount: claim.totalAmount,
      appealLetter,
      // Tier A #2 — persist the AI's structured arguments so future appeals
      // for the same payer + denial category can learn from outcomes.
      keyArguments: keyArguments as any,
      notes,
      supportingDocs: [],
    } as any);

    // Update claim status to appeal
    await storage.updateClaim(claimId, { status: 'appeal' });

    // Timeline (#469), with #470's deadline: the stored date and its basis
    // (payer policy, practice default, estimate or manual), and the status
    // actually stored — "ready" is earned, so a drafted letter may still be a draft.
    const storedDeadline = (appeal as any).deadlineDate ?? manualDeadline ?? basis.deadlineDate;
    await recordClaimEvent({
      claimId,
      practiceId,
      eventType: 'appeal_created',
      summary: `Appeal created (${appeal.appealLevel}) — ${appealLetter ? 'letter drafted' : 'no letter'}, status ${appeal.status}; filing deadline ${storedDeadline ?? 'not set'} (${describeDeadlineBasis(appeal as any)})`,
      metadata: {
        appealId: appeal.id,
        appealLevel: appeal.appealLevel,
        status: appeal.status,
        deadlineDate: storedDeadline,
        deadlineSource: (appeal as any).deadlineSource ?? null,
        readinessIssues: readiness.issues,
      },
      createdBy: req.user?.claims?.sub,
    });

    res.json({
      message: 'Appeal created successfully',
      appeal: {
        ...appeal,
        deadlineBasis: describeDeadlineBasis(appeal as any),
        readinessIssues: readiness.issues,
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

    const existingAppeal = await loadAppealForCaller(req, res, appealId);
    if (!existingAppeal) return;

    // Don't allow updates to resolved appeals
    if (['won', 'lost', 'partial'].includes(existingAppeal.status) &&
        !['notes', 'supportingDocs'].includes(Object.keys(updates)[0])) {
      return res.status(400).json({ message: 'Cannot modify resolved appeals' });
    }

    // Editable deadline: a date-only value, recorded as set manually so the
    // drawer stops showing a computed basis for it.
    if ('deadlineDate' in updates) {
      if (!isValidDateOnly(updates.deadlineDate)) {
        return res.status(400).json({ message: 'deadlineDate must be a valid YYYY-MM-DD date' });
      }
      updates.deadlineSource = 'manual';
      updates.deadlinePolicyDays = null;
    }
    if ('denialDate' in updates && updates.denialDate != null && updates.denialDate !== '' && !isValidDateOnly(updates.denialDate)) {
      return res.status(400).json({ message: 'denialDate must be a valid YYYY-MM-DD date' });
    }
    if ('denialDate' in updates && updates.denialDate === '') updates.denialDate = null;

    // Whenever the letter changes, or someone asks for "ready", re-run the
    // readiness check against the letter as it will be stored. A letter
    // cannot be marked ready while it still carries placeholders, missing
    // identifiers or an assertion nothing on record supports (QA 2026-11-18).
    const wantsReady = updates.status === 'ready';
    const letterChanged = 'appealLetter' in updates;
    if (wantsReady || letterChanged) {
      const claim = await storage.getClaim(existingAppeal.claimId);
      const letter = letterChanged ? updates.appealLetter : existingAppeal.appealLetter;
      const denialDate = 'denialDate' in updates ? updates.denialDate : (existingAppeal as any).denialDate;
      let readiness: { ready: boolean; issues: string[] };
      try {
        const ctx = await buildLetterContext(
          req,
          existingAppeal.practiceId,
          claim ?? { id: existingAppeal.claimId, patientId: null },
          ((existingAppeal as any).groundingInputs ?? {}) as AppealGroundingInputs,
        );
        readiness = readinessFor(ctx, claim, letter, denialDate);
        if (letterChanged && typeof letter === 'string') {
          // The biller's own edits are theirs; an unsupported assertion is
          // surfaced as a readiness issue, not silently rewritten.
          updates.appealLetter = letter;
        }
      } catch (error) {
        logger.error('Readiness check failed', { error: error instanceof Error ? error.message : String(error) });
        readiness = { ready: false, issues: ['Readiness could not be verified'] };
      }
      updates.readinessIssues = readiness.issues;
      if (wantsReady && !readiness.ready) {
        return res.status(400).json({
          message: 'This appeal is not ready to send yet',
          readinessIssues: readiness.issues,
        });
      }
    }

    const updatedAppeal = await storage.updateAppealRecord(appealId, updates);

    // Internal notes are the biller's working record on the appeal; surface
    // them on the claim timeline (excerpt only — the appeal row holds the text).
    if (typeof updates?.notes === 'string' && updates.notes.trim() && updates.notes !== existingAppeal.notes) {
      await recordClaimEvent({
        claimId: existingAppeal.claimId,
        practiceId: existingAppeal.practiceId,
        eventType: 'note_added',
        summary: `Internal note on appeal #${appealId}: ${clip(updates.notes, 160)}`,
        metadata: { appealId, excerpt: clip(updates.notes, 160) },
        createdBy: req.user?.claims?.sub,
      });
    }

    res.json({
      ...updatedAppeal,
      deadlineBasis: describeDeadlineBasis(updatedAppeal as any),
      readinessIssues: Array.isArray((updatedAppeal as any).readinessIssues) ? (updatedAppeal as any).readinessIssues : [],
    });
  } catch (error) {
    logger.error('Error updating appeal', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update appeal' });
  }
});

// Submit appeal to payer
router.post('/appeals/:id/submit', isAuthenticated, async (req: any, res) => {
  try {
    const appealId = parseInt(req.params.id);

    const appeal = await loadAppealForCaller(req, res, appealId);
    if (!appeal) return;

    if (!appeal.appealLetter) {
      return res.status(400).json({ message: 'Appeal letter is required before submission' });
    }

    const updatedAppeal = await storage.updateAppealRecord(appealId, {
      status: 'submitted',
      submittedDate: new Date(),
    });

    await recordClaimEvent({
      claimId: appeal.claimId,
      practiceId: appeal.practiceId,
      eventType: 'appeal_submitted',
      summary: `Appeal #${appealId} (${appeal.appealLevel}) submitted to payer`,
      metadata: { appealId, appealLevel: appeal.appealLevel },
      createdBy: req.user?.claims?.sub,
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

    const appeal = await loadAppealForCaller(req, res, appealId);
    if (!appeal) return;

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

    // Persist the immutable outcome row for ML / payer-success-rate analytics.
    // Idempotent — safe if the route fires twice. Non-blocking on its own
    // errors (logged inside the service).
    await recordAppealOutcome(appealId);

    await recordClaimEvent({
      claimId: appeal.claimId,
      practiceId: appeal.practiceId,
      eventType: 'appeal_resolved',
      summary: `Appeal #${appealId} resolved: ${outcome}${recoveredAmount ? ` — $${recoveredAmount} recovered` : ''}`,
      metadata: { appealId, outcome, recoveredAmount: recoveredAmount ?? null },
      createdBy: req.user?.claims?.sub,
    });

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

    const appeal = await loadAppealForCaller(req, res, appealId);
    if (!appeal) return;

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

    if (newDeadlineDate != null && newDeadlineDate !== '' && !isValidDateOnly(newDeadlineDate)) {
      return res.status(400).json({ message: 'newDeadlineDate must be a valid YYYY-MM-DD date' });
    }

    // The next level's window runs from the day this level was lost (today),
    // using the same source logic as creation; a date the biller supplies is
    // recorded as manual. The biller can edit it in the drawer either way.
    const practiceRecord = await storage.getPractice(appeal.practiceId);
    const basis = computeAppealDeadline({
      denialDate: new Date().toISOString().slice(0, 10),
      practice: practiceRecord as any,
    });

    // Create new appeal at next level
    const newAppeal = await storage.createAppeal({
      claimId: appeal.claimId,
      practiceId: appeal.practiceId,
      appealLevel: nextLevel,
      status: 'draft',
      denialCategory: appeal.denialCategory,
      deadlineDate: newDeadlineDate ? String(newDeadlineDate).slice(0, 10) : basis.deadlineDate,
      denialDate: (appeal as any).denialDate ?? null,
      deadlineSource: newDeadlineDate ? 'manual' : basis.source,
      deadlinePolicyDays: newDeadlineDate ? null : basis.policyDays,
      groundingInputs: (appeal as any).groundingInputs ?? null,
      readinessIssues: ['No appeal letter yet'],
      appealedAmount: appeal.appealedAmount,
      notes: notes || `Escalated from ${appeal.appealLevel}`,
      supportingDocs: appeal.supportingDocs as any,
    } as any);

    await recordClaimEvent({
      claimId: appeal.claimId,
      practiceId: appeal.practiceId,
      eventType: 'appeal_created',
      summary: `Appeal escalated to ${nextLevel} (new appeal #${newAppeal.id}; #${appealId} closed as lost)`,
      metadata: { appealId: newAppeal.id, appealLevel: nextLevel, escalatedFrom: appealId, status: 'draft' },
      createdBy: req.user?.claims?.sub,
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

    const appeal = await loadAppealForCaller(req, res, appealId);
    if (!appeal) return;

    const claim = await storage.getClaim(appeal.claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Associated claim not found' });
    }

    // Use appeal.practiceId since this route doesn't take practiceId from the
    // session — appeals are scoped by their owning practice column. The
    // grounding inputs saved at creation (urgent, retro-auth, extra grounds)
    // still apply; the body may refresh them.
    const storedInputs = ((appeal as any).groundingInputs ?? {}) as AppealGroundingInputs;
    const groundingInputs: AppealGroundingInputs = Object.keys(req.body ?? {}).some((k) =>
      ['urgentService', 'retroAuthRequested', 'retroAuthReference', 'additionalGrounds', 'denialDate'].includes(k))
      ? { ...storedInputs, ...normalizeGroundingInputs({ ...storedInputs, ...req.body }) }
      : storedInputs;
    if (additionalContext && typeof additionalContext === 'string' && additionalContext.trim()) {
      groundingInputs.additionalGrounds = [groundingInputs.additionalGrounds, additionalContext.trim()].filter(Boolean).join(' ');
    }
    const ctx = await buildLetterContext(req, appeal.practiceId, claim, groundingInputs);

    const appealResult = await appealGenerator.generateAppeal(
      { ...claim, denialReason: claim.denialReason || 'No reason provided' },
      ctx.formattedLineItems,
      ctx.patientData,
      ctx.practice,
      ctx.grounding,
    );
    const appealLetter = stripUnsupportedAppealAssertions(appealResult.appealLetter, ctx.grounding);
    const denialDate = groundingInputs.denialDate ?? (appeal as any).denialDate ?? null;
    const readiness = readinessFor(ctx, claim, appealLetter, denialDate);

    // Update appeal with new letter. Regeneration never promotes to ready on
    // its own; readiness decides, exactly as at creation.
    const updatedAppeal = await storage.updateAppealRecord(appealId, {
      appealLetter,
      denialCategory: appealResult.denialCategory,
      keyArguments: filterUnsupportedKeyArguments(appealResult.keyArguments, ctx.grounding) as any,
      groundingInputs: groundingInputs as any,
      denialDate,
      readinessIssues: readiness.issues as any,
      status: readiness.ready ? 'ready' : 'draft',
    } as any);

    res.json({
      message: 'Appeal letter regenerated',
      appeal: {
        ...updatedAppeal,
        deadlineBasis: describeDeadlineBasis(updatedAppeal as any),
        readinessIssues: readiness.issues,
      },
      successProbability: appealResult.successProbability,
      suggestedActions: appealResult.suggestedActions,
    });
  } catch (error) {
    logger.error('Error regenerating appeal letter', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to regenerate appeal letter' });
  }
});

export default router;
