/**
 * Sessions & Superbills Routes
 *
 * Handles:
 * - /api/cpt-codes - CPT codes lookup
 * - /api/icd10-codes - ICD-10 diagnosis lookup
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
  if (userRole === 'admin' && req.isPlatformAdmin) return requestedPracticeId || userPracticeId || 1;
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

/**
 * GET /api/cpt-codes — the catalog as THIS practice sees it.
 *
 * `baseRate` is the practice's own charge, or null when they have not set
 * one (that code is not billable yet). `suggestedRate` carries the platform
 * reference figure for display only.
 *
 * Now authenticated: the response is practice-specific, and an unscoped
 * catalog is exactly how one practice's fee schedule became everyone's.
 * Not cached globally for the same reason.
 */
router.get('/cpt-codes', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const cptCodes = await storage.getPracticeCptCodes(practiceId);
    res.json(cptCodes);
  } catch (error) {
    logger.error('Error fetching CPT codes', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to fetch CPT codes' });
  }
});

/**
 * GET /api/icd10-codes — the diagnosis catalog.
 *
 * This route did not exist. The New Claim dialog has always queried
 * /api/icd10-codes to populate its ICD-10 picker, and always got a 404, so the
 * dropdown rendered with no options. That was survivable while a diagnosis was
 * optional; it became a hard block the moment one was required, because there
 * was no way to satisfy the requirement.
 *
 * Authenticated for consistency with /cpt-codes. Unlike CPT there is no
 * per-practice pricing here — ICD-10 is a shared code set — so it is not
 * practice-scoped.
 */
router.get('/icd10-codes', isAuthenticated, async (_req: any, res) => {
  try {
    const codes = await storage.getIcd10Codes();
    res.json(codes);
  } catch (error) {
    logger.error('Error fetching ICD-10 codes', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to fetch ICD-10 codes' });
  }
});

/**
 * Parse a user-supplied dollar amount into a fixed-2 decimal string.
 *
 * Returns undefined when the field was omitted (leave unchanged) and null
 * when explicitly cleared. Throws on anything that isn't a sane charge —
 * this value ends up on an 837P, so "0" and "" must not quietly become the
 * same thing, and a fat-fingered 55000 should not sail through.
 */
export function parseRateInput(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).replace(/[$,]/g, ''));
  if (!Number.isFinite(num)) throw new Error(`${field} must be a number`);
  if (num < 0) throw new Error(`${field} cannot be negative`);
  if (num > 100000) throw new Error(`${field} looks wrong — over $100,000`);
  return num.toFixed(2);
}

/**
 * POST /api/cpt-codes/accept-defaults — adopt the platform-suggested charges.
 *
 * Changes no dollar amounts. It records that a human looked at the charges
 * the cutover copied in and confirmed they are this practice's own, which
 * clears the "platform default — review" flag.
 *
 * Kept separate from a bulk rate edit on purpose: "those numbers are right"
 * and "set these new numbers" are different acts, and only the first is safe
 * to do in one click. Charges stay individually editable afterwards.
 */
router.post('/cpt-codes/accept-defaults', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const accepted = await storage.acceptPlatformDefaultRates(practiceId, userId);

    logger.info('Platform default CPT charges accepted', { practiceId, accepted, userId });

    res.json({
      accepted,
      message:
        accepted > 0
          ? `${accepted} charge${accepted === 1 ? '' : 's'} confirmed as your fee schedule.`
          : 'No unreviewed platform defaults remained.',
    });
  } catch (error) {
    logger.error('Error accepting default CPT rates', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to accept default charges' });
  }
});

/**
 * PATCH /api/cpt-codes/:id — set THIS practice's charge for a code.
 *
 * Writes to practice_cpt_rates, never to the shared catalog row. The catalog
 * is global, so a charge written there would be every practice's charge.
 *
 * Sending baseRate: null clears the practice's charge, returning the code to
 * "not set" — which means not billable, not "falls back to the platform
 * figure". Blank has to mean blank.
 *
 * Admin/billing only: this sets the dollar amount that goes out on an 837P.
 */
router.patch('/cpt-codes/:id', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid CPT code ID' });
    }

    let baseRate: string | null | undefined;
    let cashRate: string | null | undefined;
    try {
      baseRate = parseRateInput(req.body?.baseRate, 'Billed charge');
      cashRate = parseRateInput(req.body?.cashRate, 'Cash rate');
    } catch (err) {
      return res.status(400).json({ message: err instanceof Error ? err.message : 'Invalid rate' });
    }

    if (baseRate === undefined && cashRate === undefined) {
      return res.status(400).json({ message: 'Nothing to update — provide baseRate or cashRate' });
    }

    const practiceId = getAuthorizedPracticeId(req);
    const existing = (await storage.getCptCodes()).find((c: any) => c.id === id);
    if (!existing) {
      return res.status(404).json({ message: 'CPT code not found' });
    }

    const previous = await storage.resolvePracticeCptRate(practiceId, id);

    // baseRate: null is an explicit "clear my charge for this code".
    if (baseRate === null) {
      await storage.deletePracticeCptRate(practiceId, id);
      logger.info('Practice CPT charge cleared', {
        practiceId, cptCodeId: id, code: (existing as any).code,
        previousBaseRate: previous, userId: req.user?.claims?.sub,
      });
      return res.json({
        ...existing,
        baseRate: null,
        cashRate: null,
        suggestedRate: (existing as any).baseRate ?? null,
        isPracticeRate: false,
        isPlatformDefault: false,
      });
    }

    if (baseRate === undefined) {
      return res.status(400).json({
        message: 'Set a billed charge before setting a cash rate for this code.',
      });
    }

    const saved = await storage.upsertPracticeCptRate(practiceId, id, {
      baseRate,
      cashRate: cashRate ?? null,
      updatedBy: req.user?.claims?.sub,
    });

    logger.info('Practice CPT charge updated', {
      practiceId,
      cptCodeId: id,
      code: (existing as any).code,
      previousBaseRate: previous,
      newBaseRate: saved.baseRate,
      userId: req.user?.claims?.sub,
    });

    res.json({
      ...existing,
      baseRate: saved.baseRate,
      cashRate: saved.cashRate,
      suggestedRate: (existing as any).baseRate ?? null,
      isPracticeRate: true,
      // A human just set this, so it is no longer an unreviewed default.
      isPlatformDefault: false,
    });
  } catch (error) {
    logger.error('Error updating CPT rate', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update CPT rate' });
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
    // Tenant safety: bind the session to the caller's own practice rather
    // than trusting a client-supplied practiceId (soap-notes.tsx still posts
    // a hardcoded 1). Sessions feed billing, so a misfiled one corrupts
    // another practice's revenue data.
    const session = await storage.createSession({
      ...req.body,
      practiceId: getAuthorizedPracticeId(req),
    });
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

    // Price every line from this practice's fee schedule up front, so a code
    // with no charge set fails the whole superbill with a clear message
    // rather than being billed at a shared platform figure.
    const practiceRates = new Map<number, string | null>();
    for (const item of lineItems) {
      if (!practiceRates.has(item.cptCodeId)) {
        practiceRates.set(
          item.cptCodeId,
          await storage.resolvePracticeCptRate(practiceId, item.cptCodeId),
        );
      }
    }
    const unpriced = lineItems
      .filter((item: any) => practiceRates.get(item.cptCodeId) === null)
      .map((item: any) => cptCodes.find((c: any) => c.id === item.cptCodeId)?.code)
      .filter(Boolean);
    if (unpriced.length > 0) {
      return res.status(400).json({
        message: `No charge is set for CPT ${unpriced.join(', ')}. Set your charges under Insurance Rates → Your Charges before billing.`,
        code: 'RATE_NOT_SET',
      });
    }

    let totalAmount = 0;
    const processedLineItems = lineItems.map((item: any) => {
      const cptCode = cptCodes.find((c: any) => c.id === item.cptCodeId);
      if (!cptCode) throw new Error(`Invalid CPT code ID: ${item.cptCodeId}`);
      const rate = parseFloat(practiceRates.get(item.cptCodeId) as string);
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

    const sessionRate = await storage.resolvePracticeCptRate(practiceId, session.cptCodeId);
    if (sessionRate === null) {
      return res.status(400).json({
        message: `No charge is set for CPT ${(cptCode as any).code}. Set your charge under Insurance Rates → Your Charges before billing this session.`,
        code: 'RATE_NOT_SET',
      });
    }

    const rate = parseFloat(sessionRate);
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
