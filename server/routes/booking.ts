/**
 * Booking & Appointment Request Routes
 *
 * Handles:
 * - /api/booking/appointment-types/* - Appointment type CRUD
 * - /api/booking/availability/* - Therapist availability
 * - /api/booking/time-off/* - Therapist time off
 * - /api/booking/settings - Booking settings
 * - /api/booking/bookings/* - Online bookings management
 * - /api/appointment-requests/* - Admin appointment request management
 */

import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

const router = Router();

// Middleware to check admin or billing role
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

// Helper to get authorized practiceId
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

// ==================== APPOINTMENT TYPES ====================

router.get('/booking/appointment-types', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const activeOnly = req.query.activeOnly === 'true';
    const types = await storage.getAppointmentTypes(practiceId, activeOnly);
    res.json(types);
  } catch (error) {
    logger.error('Error fetching appointment types', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch appointment types' });
  }
});

router.post('/booking/appointment-types', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const data = { ...req.body, practiceId: getAuthorizedPracticeId(req) };
    const type = await storage.createAppointmentType(data);
    res.status(201).json(type);
  } catch (error) {
    logger.error('Error creating appointment type', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create appointment type' });
  }
});

router.patch('/booking/appointment-types/:id', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const type = await storage.updateAppointmentType(parseInt(req.params.id), req.body);
    res.json(type);
  } catch (error) {
    logger.error('Error updating appointment type', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update appointment type' });
  }
});

router.delete('/booking/appointment-types/:id', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    await storage.deleteAppointmentType(parseInt(req.params.id));
    res.json({ message: 'Appointment type deleted' });
  } catch (error) {
    logger.error('Error deleting appointment type', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete appointment type' });
  }
});

// ==================== THERAPIST AVAILABILITY ====================

router.get('/booking/availability', isAuthenticated, async (req: any, res) => {
  try {
    const therapistId = req.query.therapistId as string;
    if (therapistId) {
      const availability = await storage.getTherapistAvailability(therapistId);
      res.json(availability);
    } else {
      const practiceId = getAuthorizedPracticeId(req);
      const availability = await storage.getPracticeAvailability(practiceId);
      res.json(availability);
    }
  } catch (error) {
    logger.error('Error fetching availability', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch availability' });
  }
});

router.post('/booking/availability', isAuthenticated, async (req: any, res) => {
  try {
    const data = { ...req.body, practiceId: getAuthorizedPracticeId(req) };
    const availability = await storage.setTherapistAvailability(data);
    res.json(availability);
  } catch (error) {
    logger.error('Error setting availability', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to set availability' });
  }
});

router.delete('/booking/availability/:id', isAuthenticated, async (req: any, res) => {
  try {
    await storage.deleteTherapistAvailability(parseInt(req.params.id));
    res.json({ message: 'Availability deleted' });
  } catch (error) {
    logger.error('Error deleting availability', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete availability' });
  }
});

// ==================== THERAPIST TIME OFF ====================

router.get('/booking/time-off', isAuthenticated, async (req: any, res) => {
  try {
    const therapistId = req.query.therapistId as string;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const timeOff = await storage.getTherapistTimeOff(therapistId, startDate, endDate);
    res.json(timeOff);
  } catch (error) {
    logger.error('Error fetching time off', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch time off' });
  }
});

router.post('/booking/time-off', isAuthenticated, async (req: any, res) => {
  try {
    const data = { ...req.body, practiceId: getAuthorizedPracticeId(req) };
    const timeOff = await storage.addTherapistTimeOff(data);
    res.json(timeOff);
  } catch (error) {
    logger.error('Error adding time off', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to add time off' });
  }
});

router.delete('/booking/time-off/:id', isAuthenticated, async (req: any, res) => {
  try {
    await storage.deleteTherapistTimeOff(parseInt(req.params.id));
    res.json({ message: 'Time off deleted' });
  } catch (error) {
    logger.error('Error deleting time off', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete time off' });
  }
});

// ==================== BOOKING SETTINGS ====================

router.get('/booking/settings', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const settings = await storage.getBookingSettings(practiceId);
    res.json(settings || {});
  } catch (error) {
    logger.error('Error fetching booking settings', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch booking settings' });
  }
});

router.post('/booking/settings', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const data = { ...req.body, practiceId: getAuthorizedPracticeId(req) };
    const settings = await storage.upsertBookingSettings(data);
    res.json(settings);
  } catch (error) {
    logger.error('Error saving booking settings', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to save booking settings' });
  }
});

// ==================== ONLINE BOOKINGS (Admin) ====================

router.get('/booking/bookings', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      status: req.query.status as string | undefined,
      therapistId: req.query.therapistId as string | undefined,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    };
    const bookings = await storage.getOnlineBookings(practiceId, filters);
    res.json(bookings);
  } catch (error) {
    logger.error('Error fetching bookings', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch bookings' });
  }
});

router.post('/booking/bookings/:id/confirm', isAuthenticated, async (req: any, res) => {
  try {
    const bookingId = parseInt(req.params.id);
    const booking = await storage.getOnlineBooking(bookingId);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    const appointmentType = booking.appointmentTypeId
      ? await storage.getAppointmentType(booking.appointmentTypeId)
      : null;

    const startTime = new Date(`${booking.requestedDate}T${booking.requestedTime}`);
    const endTime = new Date(startTime.getTime() + (appointmentType?.duration || 60) * 60000);

    const appointment = await storage.createAppointment({
      practiceId: booking.practiceId,
      patientId: booking.patientId || undefined,
      therapistId: booking.therapistId || undefined,
      title: appointmentType?.name || 'Online Booking',
      startTime, endTime,
      status: 'scheduled',
      notes: booking.notes || undefined,
    });

    const confirmedBooking = await storage.confirmOnlineBooking(bookingId, appointment.id);
    res.json({ booking: confirmedBooking, appointment });
  } catch (error) {
    logger.error('Error confirming booking', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to confirm booking' });
  }
});

router.post('/booking/bookings/:id/cancel', isAuthenticated, async (req: any, res) => {
  try {
    const { reason } = req.body;
    const booking = await storage.cancelOnlineBooking(parseInt(req.params.id), reason);
    res.json(booking);
  } catch (error) {
    logger.error('Error cancelling booking', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to cancel booking' });
  }
});

// ==================== APPOINTMENT REQUESTS (Admin) ====================

router.get('/appointment-requests', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const status = req.query.status as string || undefined;
    const requests = await storage.getPracticeAppointmentRequests(practiceId, status);

    const reqPatientIds = Array.from(new Set(requests.map(r => r.patientId).filter((id): id is number => id != null)));
    const reqPatientsMap = await storage.getPatientsByIds(reqPatientIds);
    const enrichedRequests = await Promise.all(requests.map(async (request) => {
      const patient = reqPatientsMap.get(request.patientId);
      const appointmentType = request.appointmentTypeId
        ? await storage.getAppointmentType(request.appointmentTypeId)
        : null;
      let therapistName = null;
      if (request.therapistId) {
        const therapist = await storage.getUser(request.therapistId);
        if (therapist) therapistName = `${therapist.firstName} ${therapist.lastName}`;
      }

      return {
        ...request,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown',
        patientEmail: patient?.email,
        patientPhone: patient?.phone,
        appointmentTypeName: appointmentType?.name || 'Unknown',
        appointmentTypeDuration: appointmentType?.duration || 60,
        therapistName,
      };
    }));

    res.json(enrichedRequests);
  } catch (error) {
    logger.error('Error fetching appointment requests', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch appointment requests' });
  }
});

router.post('/appointment-requests/:id/approve', isAuthenticated, async (req: any, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const { therapistId, startTime, endTime, notes } = req.body;

    const request = await storage.getAppointmentRequest(requestId);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending_approval') {
      return res.status(400).json({ message: 'Request has already been processed' });
    }

    const appointmentType = request.appointmentTypeId
      ? await storage.getAppointmentType(request.appointmentTypeId)
      : null;

    const appointmentStart = startTime
      ? new Date(startTime)
      : new Date(`${request.requestedDate}T${request.requestedTime}`);
    const duration = appointmentType?.duration || 60;
    const appointmentEnd = endTime
      ? new Date(endTime)
      : new Date(appointmentStart.getTime() + duration * 60 * 1000);

    const appointment = await storage.createAppointment({
      practiceId: request.practiceId,
      patientId: request.patientId,
      therapistId: therapistId || request.therapistId,
      title: appointmentType?.name || 'Appointment',
      startTime: appointmentStart,
      endTime: appointmentEnd,
      status: 'scheduled',
      notes: notes || request.notes,
    });

    await storage.updateAppointmentRequest(requestId, {
      status: 'approved',
      appointmentId: appointment.id,
      processedAt: new Date(),
      processedById: req.user?.claims?.sub,
    });

    const patient = await storage.getPatient(request.patientId);
    if (patient?.email) {
      try {
        const { isEmailConfigured } = await import('../email');
        if (isEmailConfigured()) {
          const nodemailer = await import('nodemailer');
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' },
          });

          await transporter.sendMail({
            from: `"Appointment Confirmation" <${process.env.EMAIL_FROM || 'noreply@therapybill.ai'}>`,
            to: patient.email,
            subject: 'Your Appointment Has Been Confirmed',
            html: `
              <h2>Appointment Confirmed</h2>
              <p>Hi ${patient.firstName},</p>
              <p>Your appointment request has been approved!</p>
              <p><strong>Date:</strong> ${appointmentStart.toLocaleDateString()}</p>
              <p><strong>Time:</strong> ${appointmentStart.toLocaleTimeString()}</p>
              <p><strong>Type:</strong> ${appointmentType?.name || 'Appointment'}</p>
              <p>We look forward to seeing you!</p>
            `,
          });
        }
      } catch (emailError) {
        logger.error('Error sending confirmation email', { error: emailError instanceof Error ? emailError.message : String(emailError) });
      }
    }

    res.json({ message: 'Appointment request approved', appointment });
  } catch (error) {
    logger.error('Error approving request', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to approve request' });
  }
});

router.post('/appointment-requests/:id/reject', isAuthenticated, async (req: any, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const { rejectionReason } = req.body;

    const request = await storage.getAppointmentRequest(requestId);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending_approval') {
      return res.status(400).json({ message: 'Request has already been processed' });
    }

    await storage.updateAppointmentRequest(requestId, {
      status: 'rejected',
      rejectionReason: rejectionReason || null,
      processedAt: new Date(),
      processedById: req.user?.claims?.sub,
    });

    const patient = await storage.getPatient(request.patientId);
    if (patient?.email) {
      try {
        const { isEmailConfigured } = await import('../email');
        if (isEmailConfigured()) {
          const nodemailer = await import('nodemailer');
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' },
          });

          await transporter.sendMail({
            from: `"Appointment Update" <${process.env.EMAIL_FROM || 'noreply@therapybill.ai'}>`,
            to: patient.email,
            subject: 'Appointment Request Update',
            html: `
              <h2>Appointment Request Update</h2>
              <p>Hi ${patient.firstName},</p>
              <p>We were unable to accommodate your appointment request for ${request.requestedDate} at ${request.requestedTime}.</p>
              ${rejectionReason ? `<p><strong>Reason:</strong> ${rejectionReason}</p>` : ''}
              <p>Please log in to your patient portal to request a different time slot.</p>
            `,
          });
        }
      } catch (emailError) {
        logger.error('Error sending rejection email', { error: emailError instanceof Error ? emailError.message : String(emailError) });
      }
    }

    res.json({ message: 'Appointment request rejected' });
  } catch (error) {
    logger.error('Error rejecting request', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to reject request' });
  }
});

export default router;
