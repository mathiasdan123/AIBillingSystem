/**
 * Telehealth Routes
 *
 * Handles:
 * - GET /api/telehealth/settings - Get telehealth settings
 * - POST /api/telehealth/settings - Save telehealth settings
 * - GET /api/telehealth/sessions - List telehealth sessions
 * - GET /api/telehealth/sessions/today - Get today's sessions
 * - GET /api/telehealth/sessions/:id - Get single session
 * - POST /api/telehealth/sessions - Create a session
 * - PATCH /api/telehealth/sessions/:id - Update a session
 * - POST /api/telehealth/sessions/:id/join - Join a session
 * - POST /api/telehealth/sessions/:id/end - End a session
 * - GET /api/public/telehealth/join/:code - Patient join by access code
 * - POST /api/public/telehealth/waiting/:code - Patient enters waiting room
 * - GET /api/public/telehealth/status/:code - Check session status (polling)
 *
 * Mounted at /api so all paths include their full prefix.
 */

import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

const router = Router();

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

// ==================== AUTHENTICATED TELEHEALTH ROUTES ====================

// Get telehealth settings
router.get('/telehealth/settings', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const settings = await storage.getTelehealthSettings(practiceId);
    res.json(settings || { isEnabled: true, practiceId });
  } catch (error) {
    logger.error('Error fetching telehealth settings', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch telehealth settings' });
  }
});

// Save telehealth settings
router.post('/telehealth/settings', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const data = { ...req.body, practiceId: getAuthorizedPracticeId(req) };
    const settings = await storage.upsertTelehealthSettings(data);
    res.json(settings);
  } catch (error) {
    logger.error('Error saving telehealth settings', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to save telehealth settings' });
  }
});

// Get telehealth sessions
router.get('/telehealth/sessions', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      status: req.query.status as string | undefined,
      therapistId: req.query.therapistId as string | undefined,
      patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    };
    const sessions = await storage.getTelehealthSessions(practiceId, filters);
    res.json(sessions);
  } catch (error) {
    logger.error('Error fetching telehealth sessions', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch telehealth sessions' });
  }
});

// Get today's telehealth sessions
router.get('/telehealth/sessions/today', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const therapistId = req.query.therapistId as string | undefined;
    const sessions = await storage.getTodaysTelehealthSessions(practiceId, therapistId);

    // Enrich with patient info (batch query, not N+1)
    const sessionPatientIds = Array.from(new Set(sessions.map(s => s.patientId).filter((id): id is number => id != null)));
    const sessionPatientsMap = await storage.getPatientsByIds(sessionPatientIds);
    const enrichedSessions = sessions.map((session) => {
      let patientName = 'Unknown Patient';
      if (session.patientId) {
        const patient = sessionPatientsMap.get(session.patientId);
        if (patient) {
          patientName = `${patient.firstName} ${patient.lastName}`;
        }
      }
      return { ...session, patientName };
    });

    res.json(enrichedSessions);
  } catch (error) {
    logger.error('Error fetching today\'s sessions', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch sessions' });
  }
});

// Get a single telehealth session
router.get('/telehealth/sessions/:id', isAuthenticated, async (req: any, res) => {
  try {
    const session = await storage.getTelehealthSession(parseInt(req.params.id));
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }
    res.json(session);
  } catch (error) {
    logger.error('Error fetching telehealth session', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch telehealth session' });
  }
});

// Create a telehealth session for an appointment
router.post('/telehealth/sessions', isAuthenticated, async (req: any, res) => {
  try {
    const { appointmentId } = req.body;

    // Check if session already exists for this appointment
    const existing = await storage.getTelehealthSessionByAppointment(appointmentId);
    if (existing) {
      return res.json(existing);
    }

    // Get the appointment
    const appointment = await storage.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Generate room name and access code
    const roomName = storage.generateTelehealthRoomName();
    const patientAccessCode = storage.generatePatientAccessCode();

    // Create the session
    if (!appointment.practiceId) {
      return res.status(400).json({ message: 'Appointment has no assigned practice' });
    }
    const session = await storage.createTelehealthSession({
      practiceId: appointment.practiceId,
      appointmentId,
      patientId: appointment.patientId || undefined,
      therapistId: appointment.therapistId || undefined,
      roomName,
      roomUrl: `/telehealth/room/${roomName}`,
      hostUrl: `/telehealth/room/${roomName}?host=true`,
      patientAccessCode,
      scheduledStart: appointment.startTime,
      scheduledEnd: appointment.endTime,
      status: 'scheduled',
      waitingRoomEnabled: true,
    });

    res.status(201).json(session);
  } catch (error) {
    logger.error('Error creating telehealth session', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create telehealth session' });
  }
});

// Update telehealth session
router.patch('/telehealth/sessions/:id', isAuthenticated, async (req: any, res) => {
  try {
    const session = await storage.updateTelehealthSession(parseInt(req.params.id), req.body);
    res.json(session);
  } catch (error) {
    logger.error('Error updating telehealth session', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update telehealth session' });
  }
});

// Join a telehealth session (updates status)
router.post('/telehealth/sessions/:id/join', isAuthenticated, async (req: any, res) => {
  try {
    const { isTherapist } = req.body;
    const session = await storage.startTelehealthSession(parseInt(req.params.id), isTherapist);
    res.json(session);
  } catch (error) {
    logger.error('Error joining telehealth session', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to join session' });
  }
});

// End a telehealth session
router.post('/telehealth/sessions/:id/end', isAuthenticated, async (req: any, res) => {
  try {
    const session = await storage.endTelehealthSession(parseInt(req.params.id));
    res.json(session);
  } catch (error) {
    logger.error('Error ending telehealth session', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to end session' });
  }
});

// ==================== PUBLIC TELEHEALTH ENDPOINTS (for patients) ====================

// Join by access code (patient)
router.get('/public/telehealth/join/:code', async (req: any, res) => {
  try {
    const session = await storage.getTelehealthSessionByAccessCode(req.params.code.toUpperCase());
    if (!session) {
      return res.status(404).json({ message: 'Session not found. Please check your access code.' });
    }

    // Check if session is still valid
    const now = new Date();
    const scheduledStart = new Date(session.scheduledStart);
    const scheduledEnd = new Date(session.scheduledEnd);

    // Allow joining 15 minutes before and up to session end
    const earliestJoin = new Date(scheduledStart.getTime() - 15 * 60 * 1000);
    if (now < earliestJoin) {
      return res.status(400).json({
        message: 'Session not yet available',
        availableAt: earliestJoin,
      });
    }

    if (now > scheduledEnd && session.status !== 'in_progress') {
      return res.status(400).json({ message: 'This session has ended' });
    }

    if (session.status === 'cancelled') {
      return res.status(400).json({ message: 'This session has been cancelled' });
    }

    if (session.status === 'completed') {
      return res.status(400).json({ message: 'This session has already completed' });
    }

    // Get patient and practice info
    let patientName = 'Patient';
    if (session.patientId) {
      const patient = await storage.getPatient(session.patientId);
      if (patient) {
        patientName = patient.firstName;
      }
    }

    const practice = await storage.getPractice(session.practiceId);

    res.json({
      sessionId: session.id,
      roomName: session.roomName,
      roomUrl: session.roomUrl,
      patientName,
      practiceName: practice?.name || 'Your Practice',
      scheduledStart: session.scheduledStart,
      scheduledEnd: session.scheduledEnd,
      status: session.status,
      waitingRoomEnabled: session.waitingRoomEnabled,
    });
  } catch (error) {
    logger.error('Error joining by access code', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to join session' });
  }
});

// Patient marks themselves as joined (waiting room)
router.post('/public/telehealth/waiting/:code', async (req: any, res) => {
  try {
    const session = await storage.getTelehealthSessionByAccessCode(req.params.code.toUpperCase());
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // Update patient joined time if not already set
    if (!session.patientJoinedAt) {
      await storage.updateTelehealthSession(session.id, {
        patientJoinedAt: new Date(),
        status: session.status === 'scheduled' ? 'waiting' : session.status,
      });
    }

    res.json({ message: 'Joined waiting room', status: 'waiting' });
  } catch (error) {
    logger.error('Error joining waiting room', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to join waiting room' });
  }
});

// Check session status (for polling)
router.get('/public/telehealth/status/:code', async (req: any, res) => {
  try {
    const session = await storage.getTelehealthSessionByAccessCode(req.params.code.toUpperCase());
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    res.json({
      status: session.status,
      therapistJoined: !!session.therapistJoinedAt,
    });
  } catch (error) {
    logger.error('Error checking session status', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to check status' });
  }
});

export default router;
