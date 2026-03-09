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

// Create appointment
router.post('/', isAuthenticated, validate(createAppointmentSchema), async (req: any, res) => {
  try {
    const data = { ...req.body };
    // Convert validated ISO strings to Date objects for storage
    data.startTime = new Date(data.startTime);
    data.endTime = new Date(data.endTime);
    const appointment = await storage.createAppointment(data);
    res.json(appointment);
  } catch (error) {
    logger.error('Error creating appointment', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create appointment' });
  }
});

// Get all appointments
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const start = req.query.start ? new Date(req.query.start as string) : undefined;
    const end = req.query.end ? new Date(req.query.end as string) : undefined;

    if (start && end) {
      const appts = await storage.getAppointmentsByDateRange(practiceId, start, end);
      res.json(appts);
    } else {
      const appts = await storage.getAppointments(practiceId);
      res.json(appts);
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
    res.json(appt);
  } catch (error) {
    logger.error('Error cancelling appointment', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to cancel appointment' });
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

export default router;
