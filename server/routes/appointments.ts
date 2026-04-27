/**
 * Appointment Routes
 *
 * Handles:
 * - /api/appointments - Appointment CRUD operations
 * - /api/appointments/:id/cancel - Cancel appointment
 * - /api/appointments/:id/check-eligibility - Pre-appointment eligibility check
 * - /api/appointments/:id/eligibility-alerts - Eligibility alerts
 * - /api/appointments/recurring - Recurring appointment series
 * - /api/appointments/:id/series - Recurring series management
 */

import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { validate } from '../middleware/validate';
import { createAppointmentSchema } from '../validation/schemas';
import { parsePagination, paginatedResponse } from '../utils/pagination';
import logger from '../services/logger';
import { chargeCopay } from '../services/stripeService';

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

// Helper to generate mock eligibility for demo purposes
const generateMockEligibility = (patient: any, insurance: any) => {
  const isActive = Math.random() > 0.1;
  const copay = [20, 25, 30, 35, 40, 50][Math.floor(Math.random() * 6)];
  const deductible = [500, 1000, 1500, 2000, 2500][Math.floor(Math.random() * 5)];
  const deductibleMet = Math.floor(Math.random() * deductible);
  const oopMax = [3000, 5000, 6000, 7500, 10000][Math.floor(Math.random() * 5)];
  const oopMet = Math.floor(Math.random() * oopMax * 0.5);

  return {
    status: isActive ? 'active' : 'inactive',
    coverageType: 'Commercial',
    effectiveDate: '2024-01-01',
    terminationDate: null,
    copay,
    deductible,
    deductibleMet,
    outOfPocketMax: oopMax,
    outOfPocketMet: oopMet,
    coinsurance: 20,
    visitsAllowed: 30,
    visitsUsed: Math.floor(Math.random() * 15),
    authRequired: Math.random() > 0.7,
    planName: insurance?.name || patient?.insuranceProvider || 'Standard Plan',
  };
};

// ==================== APPOINTMENT CRUD ====================

/**
 * @openapi
 * /api/appointments:
 *   post:
 *     tags: [Appointments]
 *     summary: Create an appointment
 *     description: Creates a single appointment, or a recurring series if a recurrencePattern is provided (weekly, biweekly, or monthly).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InsertAppointment'
 *     responses:
 *       200:
 *         description: Created appointment (single)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Appointment'
 *       201:
 *         description: Created recurring series
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 seriesId:
 *                   type: string
 *                 count:
 *                   type: integer
 *                 appointments:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Appointment'
 *       400:
 *         description: Invalid recurrence configuration
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.post('/', isAuthenticated, async (req: any, res) => {
  try {
    const { recurrencePattern, recurrenceEndDate, numberOfOccurrences, ...appointmentData } = req.body;

    // Convert date strings to Date objects
    appointmentData.startTime = new Date(appointmentData.startTime);
    appointmentData.endTime = new Date(appointmentData.endTime);

    // If no recurrence, create a single appointment
    if (!recurrencePattern || recurrencePattern === 'none') {
      const appointment = await storage.createAppointment(appointmentData);
      return res.json(appointment);
    }

    // Build recurrence rule from simple pattern
    const {
      generateRRule,
      generateOccurrences,
      validateRecurrenceRule,
      describeRecurrence,
      getDayCode,
    } = await import('../services/recurrenceService');

    let interval = 1;
    let frequency: 'WEEKLY' | 'MONTHLY' = 'WEEKLY';
    if (recurrencePattern === 'weekly') {
      frequency = 'WEEKLY';
      interval = 1;
    } else if (recurrencePattern === 'biweekly') {
      frequency = 'WEEKLY';
      interval = 2;
    } else if (recurrencePattern === 'monthly') {
      frequency = 'MONTHLY';
      interval = 1;
    } else {
      return res.status(400).json({ message: `Invalid recurrence pattern: ${recurrencePattern}. Use "weekly", "biweekly", or "monthly".` });
    }

    const dayCode = getDayCode(appointmentData.startTime);
    const count = numberOfOccurrences ? Math.min(Math.max(numberOfOccurrences, 2), 52) : undefined;
    const until = recurrenceEndDate ? new Date(recurrenceEndDate) : undefined;

    if (!count && !until) {
      return res.status(400).json({ message: 'Either recurrenceEndDate or numberOfOccurrences is required for recurring appointments.' });
    }

    const rrule = generateRRule({
      frequency,
      interval,
      byDay: frequency === 'WEEKLY' ? [dayCode] : undefined,
      count,
      until,
    });

    const validationErrors = validateRecurrenceRule(rrule);
    if (validationErrors.length > 0) {
      return res.status(400).json({ message: 'Invalid recurrence configuration', errors: validationErrors });
    }

    const occurrences = generateOccurrences(appointmentData.startTime, rrule);
    if (occurrences.length === 0) {
      return res.status(400).json({ message: 'No occurrences generated from recurrence rule' });
    }

    const parsedEndDate = until || (occurrences.length > 0 ? occurrences[occurrences.length - 1] : null);

    const result = await storage.createRecurringAppointmentSeries(
      {
        ...appointmentData,
        recurrenceRule: rrule,
        isRecurring: true,
        recurrenceEndDate: parsedEndDate,
      },
      occurrences
    );

    res.status(201).json({
      ...result.parent,
      seriesInfo: {
        seriesId: result.parent.seriesId,
        totalCreated: result.instances.length + 1,
        recurrenceDescription: describeRecurrence(rrule),
        instances: result.instances,
      },
    });
  } catch (error) {
    logger.error('Error creating appointment', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create appointment' });
  }
});

// Get all appointments
/**
 * @openapi
 * /api/appointments:
 *   get:
 *     tags: [Appointments]
 *     summary: List appointments
 *     description: Returns a paginated list of appointments. Optionally filter by date range.
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
 *         name: start
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start of date range filter
 *       - in: query
 *         name: end
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End of date range filter
 *       - in: query
 *         name: practiceId
 *         schema:
 *           type: integer
 *         description: Practice ID (admin only)
 *     responses:
 *       200:
 *         description: Paginated appointment list
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
 *                         $ref: '#/components/schemas/Appointment'
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const start = req.query.start ? new Date(req.query.start as string) : undefined;
    const end = req.query.end ? new Date(req.query.end as string) : undefined;

    const { page, limit, offset } = parsePagination(req.query);
    const usePagination = !!(req.query.page || req.query.limit);
    const paginationOpts = usePagination ? { limit, offset } : undefined;

    const [appts, total] = (start && end)
      ? await Promise.all([
          storage.getAppointmentsByDateRange(practiceId, start, end, paginationOpts),
          usePagination ? storage.countAppointmentsByDateRange(practiceId, start, end) : Promise.resolve(0),
        ])
      : await Promise.all([
          storage.getAppointments(practiceId, paginationOpts),
          usePagination ? storage.countAppointments(practiceId) : Promise.resolve(0),
        ]);

    if (!usePagination) {
      res.json(appts);
    } else {
      res.json(paginatedResponse(appts, total, page, limit));
    }
  } catch (error) {
    logger.error('Error fetching appointments', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch appointments' });
  }
});

// Get single appointment
router.get('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const appt = await storage.getAppointment(parseInt(req.params.id));
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });
    res.json(appt);
  } catch (error) {
    logger.error('Error fetching appointment', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch appointment' });
  }
});

// Update appointment
router.patch('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const appt = await storage.updateAppointment(parseInt(req.params.id), req.body);
    res.json(appt);
  } catch (error) {
    logger.error('Error updating appointment', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update appointment' });
  }
});

// Cancel appointment
router.post('/:id/cancel', isAuthenticated, async (req: any, res) => {
  try {
    const { reason, notes, cancelledBy } = req.body;
    if (!reason) {
      return res.status(400).json({ message: 'Cancellation reason is required' });
    }

    // Determine who cancelled: use explicit value, or infer from authenticated user's role
    let whoCancelled = cancelledBy;
    if (!whoCancelled) {
      const userId = req.user?.claims?.sub;
      if (userId) {
        const user = await storage.getUser(userId);
        whoCancelled = user?.role || 'therapist';
      }
    }
    const appt = await storage.cancelAppointment(parseInt(req.params.id), reason, notes, whoCancelled);

    // Auto-fill: attempt to offer the cancelled slot to a waitlist patient
    let autoFillResult = null;
    try {
      if (appt.practiceId && appt.startTime) {
        const { autoFillSlot } = await import('./waitlist');
        const startDate = new Date(appt.startTime);
        const endDate = appt.endTime ? new Date(appt.endTime) : null;
        const dateStr = startDate.toISOString().split('T')[0];
        const startTimeStr = startDate.toTimeString().slice(0, 5);
        const endTimeStr = endDate ? endDate.toTimeString().slice(0, 5) : undefined;

        autoFillResult = await autoFillSlot(appt.practiceId, {
          appointmentId: appt.id,
          therapistId: appt.therapistId || undefined,
          date: dateStr,
          startTime: startTimeStr,
          endTime: endTimeStr,
          appointmentType: appt.title || undefined,
        });

        if (autoFillResult.matched) {
          logger.info('Auto-fill triggered on cancellation', {
            appointmentId: appt.id,
            waitlistEntryId: autoFillResult.offeredTo?.waitlistEntryId,
          });
        }
      }
    } catch (autoFillError) {
      logger.warn('Auto-fill after cancellation failed (non-blocking)', {
        error: autoFillError instanceof Error ? autoFillError.message : String(autoFillError),
      });
    }

    res.json({ ...appt, autoFillResult });
  } catch (error) {
    logger.error('Error cancelling appointment', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to cancel appointment' });
  }
});

// ==================== CHECK-IN / CHECK-OUT ====================

// Check in a patient for an appointment
router.post('/:id/check-in', isAuthenticated, async (req: any, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const appointment = await storage.getAppointment(appointmentId);

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    if (appointment.status === 'cancelled') {
      return res.status(400).json({ message: 'Cannot check in a cancelled appointment' });
    }

    if (appointment.checkedInAt) {
      return res.status(400).json({ message: 'Patient is already checked in' });
    }

    const userId = req.user?.claims?.sub || req.user?.id || 'unknown';

    const updated = await storage.updateAppointment(appointmentId, {
      checkedInAt: new Date(),
      checkedInBy: userId,
      status: 'checked_in',
    } as any);

    res.json(updated);
  } catch (error) {
    logger.error('Error checking in appointment', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to check in' });
  }
});

// Check out a patient from an appointment
router.post('/:id/check-out', isAuthenticated, async (req: any, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const appointment = await storage.getAppointment(appointmentId);

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    if (!appointment.checkedInAt) {
      return res.status(400).json({ message: 'Patient must be checked in before checking out' });
    }

    if (appointment.checkedOutAt) {
      return res.status(400).json({ message: 'Patient is already checked out' });
    }

    const updated = await storage.updateAppointment(appointmentId, {
      checkedOutAt: new Date(),
      status: 'completed',
    } as any);

    res.json(updated);
  } catch (error) {
    logger.error('Error checking out appointment', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to check out' });
  }
});

// Start a session for a checked-in patient
router.post('/:id/session-start', isAuthenticated, async (req: any, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const appointment = await storage.getAppointment(appointmentId);

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    try {
      const practiceId = getAuthorizedPracticeId(req);
      if (appointment.practiceId && appointment.practiceId !== practiceId) {
        return res.status(404).json({ error: 'Appointment not found' });
      }
    } catch (e) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (appointment.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot start a session on a cancelled appointment' });
    }

    if (!appointment.checkedInAt) {
      return res.status(400).json({ error: 'Patient must be checked in before starting the session' });
    }

    if (appointment.sessionStartedAt) {
      return res.status(400).json({ error: 'Session already started' });
    }

    const updated = await storage.updateAppointment(appointmentId, {
      sessionStartedAt: new Date(),
      status: 'in_progress',
    } as any);

    res.json(updated);
  } catch (error) {
    logger.error('Error starting session', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// End a session
router.post('/:id/session-end', isAuthenticated, async (req: any, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const appointment = await storage.getAppointment(appointmentId);

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    try {
      const practiceId = getAuthorizedPracticeId(req);
      if (appointment.practiceId && appointment.practiceId !== practiceId) {
        return res.status(404).json({ error: 'Appointment not found' });
      }
    } catch (e) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (!appointment.sessionStartedAt) {
      return res.status(400).json({ error: 'Session has not been started' });
    }

    if (appointment.sessionEndedAt) {
      return res.status(400).json({ error: 'Session already ended' });
    }

    const updated = await storage.updateAppointment(appointmentId, {
      sessionEndedAt: new Date(),
    } as any);

    res.json(updated);
  } catch (error) {
    logger.error('Error ending session', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// ==================== COPAY (Phase 3 — Slice A) ====================
//
// GET /api/appointments/:id/copay-info
//   Returns the expected copay for an appointment (from the patient's latest
//   eligibility check) plus payment methods on file. No side effects; safe
//   to call as many times as the UI needs.
//
// POST /api/appointments/:id/copay/skip
//   Records that the front desk chose not to collect the copay at check-in
//   (patient paid cash, they'll mail a check, etc). No charge is made.
//
// Charging is a separate endpoint that will land in Slice C.
router.get('/:id/copay-info', isAuthenticated, async (req: any, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    if (isNaN(appointmentId)) {
      return res.status(400).json({ error: 'Invalid appointment ID' });
    }

    const practiceId = getAuthorizedPracticeId(req);
    const appointment = await storage.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    if (appointment.practiceId !== practiceId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // If we've already resolved copay for this appointment, return that.
    const existingStatus = (appointment as any).copayStatus as string | null;
    const existingExpected = (appointment as any).copayExpected as string | null;
    const existingCollected = (appointment as any).copayCollected as string | null;

    // Telehealth appointments have no front-desk copay collection.
    // (Derived: telehealth appointments typically have locationId null or a
    // matching telehealthSessions row. For this slice we use locationId.)
    const isTelehealth = appointment.locationId == null;

    let expectedCents: number | null = null;
    let source: 'eligibility' | 'cache' | 'none' | 'recorded' = 'none';
    let stale = false;
    let lastCheckedAt: string | null = null;
    let eligibilityId: number | null = null;

    if (existingExpected) {
      expectedCents = Math.round(parseFloat(existingExpected) * 100);
      source = 'recorded';
    } else if (appointment.patientId && !isTelehealth) {
      const elig = await storage.getPatientEligibility(appointment.patientId).catch(() => null);
      if (elig && (elig as any).copay) {
        expectedCents = Math.round(parseFloat((elig as any).copay) * 100);
        source = 'eligibility';
        eligibilityId = (elig as any).id ?? null;
        lastCheckedAt = ((elig as any).checkedAt ?? (elig as any).createdAt)?.toISOString?.() ?? null;
        // Consider eligibility data stale if older than 30 days.
        if (lastCheckedAt) {
          const ageMs = Date.now() - new Date(lastCheckedAt).getTime();
          stale = ageMs > 30 * 24 * 60 * 60 * 1000;
        }
      }
    }

    // Payment methods on file (read-only).
    let paymentMethods: Array<{
      id: string;
      brand: string | null;
      last4: string | null;
      expMonth: number | null;
      expYear: number | null;
      isDefault: boolean;
    }> = [];
    if (appointment.patientId && !isTelehealth) {
      try {
        const rows = (await (storage as any).getPatientPaymentMethods?.(appointment.patientId)) ?? [];
        paymentMethods = rows.map((pm: any) => ({
          id: pm.stripePaymentMethodId,
          brand: pm.cardBrand ?? null,
          last4: pm.cardLast4 ?? null,
          expMonth: pm.cardExpMonth ?? null,
          expYear: pm.cardExpYear ?? null,
          isDefault: Boolean(pm.isDefault),
        }));
      } catch {
        // storage method may not exist yet on the patient side; fail open
        paymentMethods = [];
      }
    }

    // Pull practice-level copay settings so the UI knows whether the
    // charge buttons should be enabled.
    const practice = await (storage as any).getPractice?.(practiceId);
    const chargingEnabled = Boolean(practice?.copayChargingEnabled);
    const maxAmountCents = practice?.copayMaxAmount
      ? Math.round(parseFloat(practice.copayMaxAmount) * 100)
      : 50000; // $500 default

    res.json({
      appointmentId,
      isTelehealth,
      expectedCents,
      expectedFormatted: expectedCents != null ? `$${(expectedCents / 100).toFixed(2)}` : null,
      source,
      stale,
      lastCheckedAt,
      eligibilityId,
      status: existingStatus ?? null,
      collectedCents: existingCollected ? Math.round(parseFloat(existingCollected) * 100) : null,
      paymentMethods,
      chargingEnabled,
      maxAmountCents,
    });
  } catch (error) {
    logger.error('Error fetching copay info', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to fetch copay info' });
  }
});

router.post('/:id/copay/charge', isAuthenticated, async (req: any, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    if (isNaN(appointmentId)) {
      return res.status(400).json({ error: 'Invalid appointment ID' });
    }
    const practiceId = getAuthorizedPracticeId(req);
    const appointment = await storage.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    if (appointment.practiceId !== practiceId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!appointment.patientId) {
      return res.status(400).json({ error: 'Appointment has no patient attached' });
    }
    if ((appointment as any).copayStatus === 'collected') {
      return res.status(400).json({ error: 'Copay already collected for this appointment' });
    }

    // Practice-level feature flag. Must be true to charge.
    const practice = await (storage as any).getPractice?.(practiceId);
    if (!practice?.copayChargingEnabled) {
      return res.status(403).json({ error: 'Copay charging is not enabled for this practice' });
    }

    // Load patient + their Stripe customer.
    const patient = await storage.getPatient(appointment.patientId);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    if (!(patient as any).stripeCustomerId) {
      return res.status(400).json({
        error: 'Patient has no Stripe customer on file. Add a payment method first.',
      });
    }

    // Amount: body override OR appointment.copayExpected.
    const overrideCents = Number(req.body?.amountCents);
    const expectedDollars = (appointment as any).copayExpected
      ? parseFloat((appointment as any).copayExpected)
      : 0;
    const expectedCents = Math.round(expectedDollars * 100);
    const amountCents = Number.isFinite(overrideCents) && overrideCents > 0
      ? Math.floor(overrideCents)
      : expectedCents;

    if (!amountCents || amountCents <= 0) {
      return res.status(400).json({ error: 'Copay amount must be greater than $0' });
    }

    // Safety rail — practice-configurable max.
    const maxDollars = (practice as any).copayMaxAmount
      ? parseFloat((practice as any).copayMaxAmount)
      : 500;
    if (amountCents > Math.round(maxDollars * 100)) {
      return res.status(400).json({
        error: `Amount exceeds the practice copay cap of $${maxDollars.toFixed(2)}`,
      });
    }

    // Payment method: required. Must be a saved PM on this patient.
    const paymentMethodId = String(req.body?.paymentMethodId || '').trim();
    if (!paymentMethodId) {
      return res.status(400).json({ error: 'paymentMethodId is required' });
    }
    const pms = await (storage as any).getPatientPaymentMethods?.(patient.id) ?? [];
    const ownedPM = pms.find((pm: any) => pm.stripePaymentMethodId === paymentMethodId);
    if (!ownedPM) {
      return res.status(400).json({ error: 'Payment method does not belong to this patient' });
    }

    // Fire the charge. off_session + confirm means Stripe will either succeed
    // or throw — we catch both and record the outcome on the appointment.
    let paymentIntent;
    try {
      paymentIntent = await chargeCopay({
        customerId: (patient as any).stripeCustomerId,
        paymentMethodId,
        amount: amountCents,
        description: `Copay · Appointment #${appointmentId}`,
        practiceId,
        patientId: patient.id,
        appointmentId,
      });
    } catch (err: any) {
      // Record failed attempt so the pill shows "amber / failed" instead of
      // silent nothing. The note captures the Stripe decline reason.
      const declineMsg = err?.raw?.message || err?.message || 'Unknown Stripe error';
      await storage.updateAppointment(appointmentId, {
        copayStatus: 'failed',
        copayPaymentMethodId: paymentMethodId,
        copayNote: declineMsg.slice(0, 500),
        copayUpdatedAt: new Date(),
      } as any);
      logger.warn('Copay charge failed', {
        appointmentId,
        patientId: patient.id,
        error: declineMsg,
      });
      return res.status(402).json({ error: `Charge failed: ${declineMsg}` });
    }

    // If confirm returned `succeeded`, record it immediately. The webhook
    // will also fire and be idempotent via copayStripeChargeId match.
    const isSucceeded = paymentIntent.status === 'succeeded';
    const updated = await storage.updateAppointment(appointmentId, {
      copayStatus: isSucceeded ? 'collected' : 'pending',
      copayExpected: (appointment as any).copayExpected ?? (amountCents / 100).toFixed(2),
      copayCollected: isSucceeded ? (amountCents / 100).toFixed(2) : null,
      copayPaymentMethodId: paymentMethodId,
      copayStripeChargeId: paymentIntent.id,
      copayUpdatedAt: new Date(),
    } as any);

    logger.info('Copay charge initiated', {
      appointmentId,
      patientId: patient.id,
      amountCents,
      stripeIntent: paymentIntent.id,
      status: paymentIntent.status,
    });

    res.json({
      appointment: updated,
      paymentIntent: {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
      },
    });
  } catch (error) {
    logger.error('Error charging copay', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to charge copay' });
  }
});

router.post('/:id/copay/skip', isAuthenticated, async (req: any, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    if (isNaN(appointmentId)) {
      return res.status(400).json({ error: 'Invalid appointment ID' });
    }
    const practiceId = getAuthorizedPracticeId(req);
    const appointment = await storage.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    if (appointment.practiceId !== practiceId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // If already collected, don't let a skip overwrite the real record.
    const current = (appointment as any).copayStatus as string | null;
    if (current === 'collected') {
      return res.status(400).json({ error: 'Copay already collected for this appointment' });
    }

    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : null;

    const updated = await storage.updateAppointment(appointmentId, {
      copayStatus: 'skipped',
      copayNote: note,
      copayUpdatedAt: new Date(),
    } as any);

    res.json(updated);
  } catch (error) {
    logger.error('Error skipping copay', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to skip copay' });
  }
});

// ==================== ELIGIBILITY ====================

// Run pre-appointment eligibility check for a specific appointment
router.post('/:id/check-eligibility', isAuthenticated, async (req: any, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const appointment = await storage.getAppointment(appointmentId);

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    if (!appointment.patientId) {
      return res.status(400).json({ message: 'Appointment has no patient assigned' });
    }

    const patient = await storage.getPatient(appointment.patientId);
    if (!patient?.insuranceId && !patient?.insuranceProvider) {
      return res.status(400).json({ message: 'Patient has no insurance on file' });
    }

    // Find insurance by provider name if available
    const allInsurances = await storage.getInsurances();
    const insurance = patient.insuranceProvider
      ? allInsurances.find((i: any) => i.name.toLowerCase() === patient.insuranceProvider?.toLowerCase())
      : null;

    // Generate eligibility check
    const eligibilityResult = generateMockEligibility(patient, insurance);

    // Save eligibility check
    const savedCheck = await storage.createEligibilityCheck({
      patientId: patient.id,
      insuranceId: insurance?.id || null,
      status: eligibilityResult.status,
      coverageType: eligibilityResult.coverageType,
      effectiveDate: eligibilityResult.effectiveDate,
      terminationDate: eligibilityResult.terminationDate,
      copay: eligibilityResult.copay?.toString(),
      deductible: eligibilityResult.deductible?.toString(),
      deductibleMet: eligibilityResult.deductibleMet?.toString(),
      outOfPocketMax: eligibilityResult.outOfPocketMax?.toString(),
      outOfPocketMet: eligibilityResult.outOfPocketMet?.toString(),
      coinsurance: eligibilityResult.coinsurance,
      visitsAllowed: eligibilityResult.visitsAllowed,
      visitsUsed: eligibilityResult.visitsUsed,
      authRequired: eligibilityResult.authRequired,
      rawResponse: eligibilityResult,
    });

    // Check for issues and create alerts
    const alerts = [];
    if (eligibilityResult.status === 'inactive') {
      const alert = await storage.createEligibilityAlert({
        patientId: patient.id,
        practiceId: appointment.practiceId!,
        appointmentId: appointment.id ?? undefined,
        alertType: 'coverage_inactive',
        severity: 'critical',
        title: 'Coverage Inactive',
        message: `Insurance coverage is inactive for this patient.`,
        currentStatus: eligibilityResult,
      });
      alerts.push(alert);
    }

    if (eligibilityResult.authRequired) {
      const alert = await storage.createEligibilityAlert({
        patientId: patient.id,
        practiceId: appointment.practiceId!,
        appointmentId: appointment.id ?? undefined,
        alertType: 'auth_required',
        severity: 'warning',
        title: 'Authorization Required',
        message: `Prior authorization may be required for this visit.`,
        currentStatus: eligibilityResult,
      });
      alerts.push(alert);
    }

    res.json({
      eligibility: savedCheck,
      alerts,
      patient: {
        id: patient.id,
        name: `${patient.firstName} ${patient.lastName}`,
      },
      insurance: insurance ? {
        id: insurance.id,
        name: insurance.name,
      } : {
        id: null,
        name: patient.insuranceProvider || 'Unknown',
      },
    });
  } catch (error) {
    logger.error('Error checking appointment eligibility', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to check eligibility' });
  }
});

// Get alerts for a specific appointment
router.get('/:id/eligibility-alerts', isAuthenticated, async (req: any, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const alerts = await storage.getOpenAlertsForAppointment(appointmentId);
    res.json(alerts);
  } catch (error) {
    logger.error('Error fetching appointment eligibility alerts', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch eligibility alerts' });
  }
});

// ==================== SERIES ENDPOINTS (by seriesId) ====================

// Get all appointments in a series
router.get('/series/:seriesId', isAuthenticated, async (req: any, res) => {
  try {
    const { seriesId } = req.params;
    const series = await storage.getAppointmentsBySeriesId(seriesId);
    if (series.length === 0) {
      return res.status(404).json({ message: 'Series not found' });
    }
    const parent = series.find((a: any) => !a.isRecurringInstance);
    const { describeRecurrence } = await import('../services/recurrenceService');
    const recurrenceDescription = parent?.recurrenceRule
      ? describeRecurrence(parent.recurrenceRule)
      : 'Recurring appointment';
    res.json({
      seriesId,
      recurrenceDescription,
      appointments: series,
      totalCount: series.length,
    });
  } catch (error) {
    logger.error('Error fetching series', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch series' });
  }
});

// Update all future appointments in a series
router.put('/series/:seriesId', isAuthenticated, async (req: any, res) => {
  try {
    const { seriesId } = req.params;
    const { fromDate, ...updates } = req.body;
    const effectiveFromDate = fromDate ? new Date(fromDate) : undefined;
    const updatedAppointments = await storage.updateSeriesBySeriesId(
      seriesId,
      updates,
      effectiveFromDate
    );
    res.json({
      message: 'Series updated',
      updatedCount: updatedAppointments.length,
      updatedAppointments,
    });
  } catch (error) {
    logger.error('Error updating series', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update series' });
  }
});

// Delete all future appointments in a series
router.delete('/series/:seriesId', isAuthenticated, async (req: any, res) => {
  try {
    const { seriesId } = req.params;
    const includeCompleted = req.query.includeCompleted === 'true';
    const deletedCount = await storage.deleteSeriesBySeriesId(seriesId, includeCompleted);
    res.json({ message: 'Series deleted', deletedCount });
  } catch (error) {
    logger.error('Error deleting series', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete series' });
  }
});

// Cancel all future appointments in a series
router.post('/series/:seriesId/cancel', isAuthenticated, async (req: any, res) => {
  try {
    const { seriesId } = req.params;
    const { reason, notes, cancelledBy } = req.body;
    if (!reason) {
      return res.status(400).json({ message: 'Cancellation reason is required' });
    }
    let whoCancelled = cancelledBy;
    if (!whoCancelled) {
      const userId = req.user?.claims?.sub;
      if (userId) {
        const user = await storage.getUser(userId);
        whoCancelled = user?.role || 'therapist';
      }
    }
    const cancelledAppointments = await storage.cancelSeriesBySeriesId(
      seriesId,
      reason,
      notes,
      whoCancelled
    );
    res.json({
      message: 'Series cancelled',
      cancelledCount: cancelledAppointments.length,
      cancelledAppointments,
    });
  } catch (error) {
    logger.error('Error cancelling series', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to cancel series' });
  }
});

// ==================== RECURRING APPOINTMENTS ====================

// Create a recurring appointment series
router.post('/recurring', isAuthenticated, async (req: any, res) => {
  try {
    const {
      parseRRule,
      generateOccurrences,
      validateRecurrenceRule,
      describeRecurrence,
    } = await import('../services/recurrenceService');

    const { recurrenceRule, ...appointmentData } = req.body;

    // Validate required fields
    if (!recurrenceRule) {
      return res.status(400).json({ message: 'Recurrence rule is required' });
    }
    if (!appointmentData.startTime || !appointmentData.endTime) {
      return res.status(400).json({ message: 'Start time and end time are required' });
    }

    // Validate the recurrence rule
    const validationErrors = validateRecurrenceRule(recurrenceRule);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        message: 'Invalid recurrence rule',
        errors: validationErrors
      });
    }

    // Parse dates
    const startTime = new Date(appointmentData.startTime);
    const endTime = new Date(appointmentData.endTime);

    // Generate occurrence dates
    const occurrences = generateOccurrences(startTime, recurrenceRule);

    if (occurrences.length === 0) {
      return res.status(400).json({ message: 'No occurrences generated from recurrence rule' });
    }

    // Create the appointment series
    const result = await storage.createRecurringAppointmentSeries(
      {
        ...appointmentData,
        startTime,
        endTime,
        recurrenceRule,
      },
      occurrences
    );

    res.status(201).json({
      parent: result.parent,
      instances: result.instances,
      totalCreated: result.instances.length + 1,
      recurrenceDescription: describeRecurrence(recurrenceRule),
    });
  } catch (error) {
    logger.error('Error creating recurring appointment series', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create recurring appointment series' });
  }
});

// Get recurring series for an appointment
router.get('/:id/series', isAuthenticated, async (req: any, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const appointment = await storage.getAppointment(appointmentId);

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Determine the parent ID
    const parentId = appointment.recurrenceParentId || appointment.id;

    // Check if this is actually a recurring appointment
    const parent = await storage.getAppointment(parentId);
    if (!parent?.recurrenceRule && !appointment.isRecurringInstance) {
      return res.status(400).json({ message: 'This appointment is not part of a recurring series' });
    }

    const series = await storage.getRecurringSeries(parentId);

    const { describeRecurrence } = await import('../services/recurrenceService');
    const recurrenceDescription = parent?.recurrenceRule
      ? describeRecurrence(parent.recurrenceRule)
      : 'Recurring appointment';

    res.json({
      parentId,
      recurrenceRule: parent?.recurrenceRule,
      recurrenceDescription,
      appointments: series,
      totalCount: series.length,
    });
  } catch (error) {
    logger.error('Error fetching recurring series', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch recurring series' });
  }
});

// Delete entire recurring series
router.delete('/:id/series', isAuthenticated, async (req: any, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const includeCompleted = req.query.includeCompleted === 'true';

    const appointment = await storage.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Determine the parent ID
    const parentId = appointment.recurrenceParentId || appointment.id;

    // Check if this is actually a recurring appointment
    const parent = await storage.getAppointment(parentId);
    if (!parent?.recurrenceRule && !appointment.isRecurringInstance) {
      return res.status(400).json({ message: 'This appointment is not part of a recurring series' });
    }

    const deletedCount = await storage.deleteRecurringSeries(parentId, includeCompleted);

    res.json({
      message: 'Recurring series deleted',
      deletedCount,
    });
  } catch (error) {
    logger.error('Error deleting recurring series', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete recurring series' });
  }
});

// Update entire recurring series (future appointments only)
router.patch('/:id/series', isAuthenticated, async (req: any, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const { fromDate, ...updates } = req.body;

    const appointment = await storage.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Determine the parent ID
    const parentId = appointment.recurrenceParentId || appointment.id;

    // Check if this is actually a recurring appointment
    const parent = await storage.getAppointment(parentId);
    if (!parent?.recurrenceRule && !appointment.isRecurringInstance) {
      return res.status(400).json({ message: 'This appointment is not part of a recurring series' });
    }

    // Parse fromDate if provided
    const effectiveFromDate = fromDate ? new Date(fromDate) : undefined;

    const updatedAppointments = await storage.updateRecurringSeries(
      parentId,
      updates,
      effectiveFromDate
    );

    res.json({
      message: 'Recurring series updated',
      updatedCount: updatedAppointments.length,
      updatedAppointments,
    });
  } catch (error) {
    logger.error('Error updating recurring series', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update recurring series' });
  }
});

// Cancel entire recurring series (future appointments only)
router.post('/:id/series/cancel', isAuthenticated, async (req: any, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const { reason, notes, cancelledBy } = req.body;

    if (!reason) {
      return res.status(400).json({ message: 'Cancellation reason is required' });
    }

    const appointment = await storage.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Determine the parent ID
    const parentId = appointment.recurrenceParentId || appointment.id;

    // Check if this is actually a recurring appointment
    const parent = await storage.getAppointment(parentId);
    if (!parent?.recurrenceRule && !appointment.isRecurringInstance) {
      return res.status(400).json({ message: 'This appointment is not part of a recurring series' });
    }

    // Determine who cancelled
    let whoCancelled = cancelledBy;
    if (!whoCancelled) {
      const userId = req.user?.claims?.sub;
      if (userId) {
        const user = await storage.getUser(userId);
        whoCancelled = user?.role || 'therapist';
      }
    }

    const cancelledAppointments = await storage.cancelRecurringSeries(
      parentId,
      reason,
      notes,
      whoCancelled
    );

    res.json({
      message: 'Recurring series cancelled',
      cancelledCount: cancelledAppointments.length,
      cancelledAppointments,
    });
  } catch (error) {
    logger.error('Error cancelling recurring series', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to cancel recurring series' });
  }
});

/**
 * GET /auth-coverage — upcoming appointments where the patient lacks
 * an active authorization with units remaining covering the scheduled
 * date. Used by the dashboard widget + manual checks.
 *
 * Query: ?daysAhead=7 (default).
 */
router.get('/auth-coverage', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = req.userPracticeId ?? 1;
    const daysAhead = parseInt((req.query.daysAhead as string) || '7', 10);
    const { getAppointmentsNeedingAuthCoverage } = await import('../services/preSessionAuthCheckService');
    const results = await getAppointmentsNeedingAuthCoverage(practiceId, daysAhead);
    res.json(results);
  } catch (error) {
    logger.error('Error fetching auth-coverage report', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to fetch auth coverage' });
  }
});

export default router;
