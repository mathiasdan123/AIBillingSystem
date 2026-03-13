/**
 * Sessions & Superbills Routes
 *
 * Handles:
 * - /api/cpt-codes - CPT codes lookup
 * - /api/exercise-bank/* - Exercise bank CRUD
 * - /api/sessions - Treatment sessions
 * - /api/sessions/unbilled - Unbilled sessions
 * - /api/superbills - Superbill creation
 * - /api/sessions/:id/generate-claim - Generate claim from session
 * - /api/users/:id/supervisees - Supervision management
 * - /api/users/:id/supervision - Update supervision settings
 */

import { Router, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import { cache, CacheKeys, CacheTTL } from '../services/cacheService';

const router = Router();

const isAdminOrBilling = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) return res.status(401).json({ message: "Unauthorized" });
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

const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
  if (userRole === 'admin') return requestedPracticeId || userPracticeId || 1;
  if (!userPracticeId) throw new Error('User not assigned to a practice.');
  if (requestedPracticeId && requestedPracticeId !== userPracticeId) return userPracticeId;
  return requestedPracticeId || userPracticeId;
};

const generateSecureClaimNumber = (prefix: string = 'CLM'): string => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${dateStr}-${randomPart}`;
};

const safeErrorResponse = (res: Response, statusCode: number, publicMessage: string, error?: any) => {
  if (error) {
    logger.error(publicMessage, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
  return res.status(statusCode).json({ message: publicMessage });
};

// ==================== CPT CODES ====================

router.get('/cpt-codes', async (req, res) => {
  try {
    const cptCodes = await cache.wrap(
      CacheKeys.cptCodes(),
      CacheTTL.CODE_LOOKUPS,
      () => storage.getAllCptCodes()
    );
    res.json(cptCodes);
  } catch (error) {
    logger.error('Error fetching CPT codes', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to fetch CPT codes' });
  }
});

// ==================== EXERCISE BANK ====================

router.get('/exercise-bank', isAuthenticated, async (req: any, res) => {
  try {
    const user = await storage.getUser(req.user.claims.sub);
    if (!user?.practiceId) return res.status(400).json({ error: 'User not associated with a practice' });
    const category = req.query.category as string | undefined;
    const exercises = await storage.getExerciseBank(user.practiceId, category);
    res.json(exercises);
  } catch (error) {
    logger.error('Error fetching exercise bank', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to fetch exercise bank' });
  }
});

router.post('/exercise-bank', isAuthenticated, async (req: any, res) => {
  try {
    const user = await storage.getUser(req.user.claims.sub);
    if (!user?.practiceId) return res.status(400).json({ error: 'User not associated with a practice' });

    const { exerciseName, category } = req.body;
    if (!exerciseName || typeof exerciseName !== 'string' || exerciseName.trim().length === 0) {
      return res.status(400).json({ error: 'Exercise name is required' });
    }
    if (!category || typeof category !== 'string' || category.trim().length === 0) {
      return res.status(400).json({ error: 'Category is required' });
    }

    const existingExercises = await storage.getExerciseBank(user.practiceId, category);
    const exists = existingExercises.some(
      e => e.exerciseName.toLowerCase() === exerciseName.trim().toLowerCase()
    );
    if (exists) return res.status(409).json({ error: 'Exercise already exists in bank for this category' });

    const exercise = await storage.createExerciseBankEntry({
      practiceId: user.practiceId,
      exerciseName: exerciseName.trim(),
      category: category.trim(),
      createdBy: user.id,
    });
    res.status(201).json(exercise);
  } catch (error) {
    logger.error('Error creating exercise bank entry', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to create exercise bank entry' });
  }
});

router.delete('/exercise-bank/:id', isAuthenticated, async (req: any, res) => {
  try {
    const user = await storage.getUser(req.user.claims.sub);
    if (!user?.practiceId) return res.status(400).json({ error: 'User not associated with a practice' });

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid exercise ID' });

    const exercises = await storage.getExerciseBank(user.practiceId);
    const exercise = exercises.find(e => e.id === id);
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

    await storage.deleteExerciseBankEntry(id);
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting exercise bank entry', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to delete exercise bank entry' });
  }
});

// ==================== SESSIONS ====================

router.get('/sessions', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const sessions = await storage.getAllSessions();
    const practiceSessions = sessions.filter((s: any) => s.practiceId === practiceId);
    res.json(practiceSessions);
  } catch (error) {
    logger.error('Error fetching sessions', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch sessions' });
  }
});

router.post('/sessions', isAuthenticated, async (req: any, res) => {
  try {
    if (req.body.therapistId) {
      const existingUser = await storage.getUser(req.body.therapistId);
      if (!existingUser) {
        await storage.upsertUser({
          id: req.body.therapistId,
          email: `${req.body.therapistId}@placeholder.local`,
          firstName: 'Therapist', lastName: 'User',
        });
      }
    }
    const session = await storage.createSession(req.body);
    res.json(session);
  } catch (error) {
    logger.error('Error creating session', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to create session' });
  }
});

router.get('/sessions/unbilled', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const sessions = await storage.getAllSessions();
    const claims = await storage.getClaims(practiceId);

    const billedSessionIds = claims.filter((c: any) => c.sessionId).map((c: any) => c.sessionId);
    const unbilledSessions = sessions.filter((s: any) =>
      s.practiceId === practiceId && s.status === 'completed' && !billedSessionIds.includes(s.id)
    );

    const patients = await storage.getPatients(practiceId);
    const cptCodes = await storage.getCptCodes();
    const icd10Codes = await storage.getIcd10Codes();

    const enrichedSessions = unbilledSessions.map((session: any) => ({
      ...session,
      patient: patients.find((p: any) => p.id === session.patientId),
      cptCode: cptCodes.find((c: any) => c.id === session.cptCodeId),
      icd10Code: icd10Codes.find((i: any) => i.id === session.icd10CodeId),
    }));

    res.json(enrichedSessions);
  } catch (error) {
    logger.error('Error fetching unbilled sessions', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch unbilled sessions' });
  }
});

// ==================== SUPERBILLS ====================

router.post('/superbills', isAuthenticated, async (req: any, res) => {
  try {
    const { patientId, insuranceId, dateOfService, lineItems, sessionId } = req.body;
    const practiceId = getAuthorizedPracticeId(req);

    if (!patientId || !lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      return res.status(400).json({ message: 'Patient ID and at least one line item are required' });
    }

    const cptCodes = await storage.getCptCodes();
    const icd10Codes = await storage.getIcd10Codes();

    let totalAmount = 0;
    const processedLineItems = lineItems.map((item: any) => {
      const cptCode = cptCodes.find((c: any) => c.id === item.cptCodeId);
      if (!cptCode) throw new Error(`Invalid CPT code ID: ${item.cptCodeId}`);
      const rate = parseFloat(cptCode.baseRate || '289.00');
      const units = item.units || 1;
      const amount = rate * units;
      totalAmount += amount;
      return {
        cptCodeId: item.cptCodeId, icd10CodeId: item.icd10CodeId || null,
        units, rate: rate.toFixed(2), amount: amount.toFixed(2),
        dateOfService: dateOfService || new Date().toISOString().split('T')[0],
        modifier: item.modifier || null, notes: item.notes || null,
      };
    });

    const claimNumber = generateSecureClaimNumber("SB");
    const claim = await storage.createClaim({
      practiceId, patientId, sessionId: sessionId || null,
      insuranceId: insuranceId || null, claimNumber,
      totalAmount: totalAmount.toFixed(2), status: 'draft',
    });

    const createdLineItems = [];
    for (const item of processedLineItems) {
      const lineItem = await storage.createClaimLineItem({ claimId: claim.id, ...item });
      const cptCode = cptCodes.find((c: any) => c.id === item.cptCodeId);
      const icd10Code = icd10Codes.find((i: any) => i.id === item.icd10CodeId);
      createdLineItems.push({
        ...lineItem,
        cptCode: cptCode ? { code: cptCode.code, description: cptCode.description } : null,
        icd10Code: icd10Code ? { code: icd10Code.code, description: icd10Code.description } : null,
      });
    }

    res.json({ message: 'Superbill created successfully', claim, lineItems: createdLineItems, totalAmount: totalAmount.toFixed(2) });
  } catch (error: any) {
    logger.error('Error creating superbill', { error: error instanceof Error ? error.message : String(error) });
    safeErrorResponse(res, 500, 'Failed to create superbill', error);
  }
});

router.post('/sessions/:id/generate-claim', isAuthenticated, async (req: any, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const { insuranceId } = req.body;
    const practiceId = getAuthorizedPracticeId(req);

    const sessions = await storage.getAllSessions();
    const session = sessions.find((s: any) => s.id === sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const existingClaims = await storage.getClaims(practiceId);
    const existingClaim = existingClaims.find((c: any) => c.sessionId === sessionId);
    if (existingClaim) return res.status(400).json({ message: 'Session already has a claim', claim: existingClaim });

    const cptCodes = await storage.getCptCodes();
    const cptCode = cptCodes.find((c: any) => c.id === session.cptCodeId);
    if (!cptCode) return res.status(400).json({ message: 'Session has no valid CPT code' });

    const rate = parseFloat(cptCode.baseRate || '289.00');
    const units = session.units || 1;
    const totalAmount = (rate * units).toFixed(2);
    const claimNumber = generateSecureClaimNumber("CLM");

    const claim = await storage.createClaim({
      practiceId, patientId: session.patientId, sessionId,
      insuranceId: insuranceId || null, claimNumber, totalAmount, status: 'draft',
    });

    const lineItem = await storage.createClaimLineItem({
      claimId: claim.id, cptCodeId: session.cptCodeId,
      icd10CodeId: session.icd10CodeId || null,
      units, rate: rate.toFixed(2), amount: totalAmount,
      dateOfService: session.sessionDate,
    });

    res.json({
      message: 'Superbill generated successfully', claim,
      lineItems: [{ ...lineItem, cptCode: { code: cptCode.code, description: cptCode.description } }],
      superbillDetails: {
        dateOfService: session.sessionDate, cptCode: cptCode.code,
        cptDescription: cptCode.description, units, rate, totalAmount,
        icd10CodeId: session.icd10CodeId,
      }
    });
  } catch (error: any) {
    logger.error('Error generating superbill', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to generate superbill' });
  }
});

// ==================== SUPERVISION MANAGEMENT ====================

router.get('/users/:id/supervisees', isAuthenticated, async (req: any, res) => {
  try {
    const supervisorId = req.params.id;
    const currentUserId = req.user?.claims?.sub;
    const currentUser = await storage.getUser(currentUserId);
    if (currentUserId !== supervisorId && currentUser?.role !== 'admin') {
      return res.status(403).json({ message: "Not authorized to view these supervisees" });
    }
    const supervisees = await storage.getSupervisees(supervisorId);
    res.json(supervisees);
  } catch (error) {
    logger.error("Error fetching supervisees", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch supervisees" });
  }
});

router.patch('/users/:id/supervision', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const userId = req.params.id;
    const { supervisorId, requiresCosign } = req.body;

    if (supervisorId) {
      const supervisor = await storage.getUser(supervisorId);
      if (!supervisor) return res.status(400).json({ message: "Supervisor not found" });
    }

    const updatedUser = await storage.updateUserSupervision(userId, supervisorId || null, requiresCosign ?? false);
    if (!updatedUser) return res.status(404).json({ message: "User not found" });

    res.json({ message: "Supervision settings updated", user: updatedUser });
  } catch (error) {
    logger.error("Error updating supervision settings", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to update supervision settings" });
  }
});

export default router;
