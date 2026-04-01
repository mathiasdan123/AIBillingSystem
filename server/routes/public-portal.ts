/**
 * Public Portal Routes
 *
 * Handles:
 * - GET /api/public/book/:slug - Get booking page by slug
 * - GET /api/public/book/:slug/slots - Get available slots
 * - POST /api/public/book/:slug - Create booking
 * - GET /api/public/booking/:code - Check booking status
 * - GET /api/public/portal/login/:token - Login via magic link
 * - GET /api/public/portal/:token/dashboard - Portal dashboard
 * - GET /api/public/portal/:token/profile - Patient profile
 * - PATCH /api/public/portal/:token/profile - Update profile
 * - GET /api/public/portal/:token/appointments - Patient appointments
 * - GET /api/public/portal/:token/statements - Patient statements
 * - GET /api/public/portal/:token/statements/:id - View statement
 * - GET /api/public/portal/:token/documents - Patient documents
 * - GET /api/public/portal/:token/documents/:id - View document
 * - POST /api/public/portal/:token/documents/:id/sign - Sign document
 * - POST /api/patient-portal/request-login - Request login link
 * - GET /api/patient-portal/login/:token - Exchange magic link for portal token
 * - GET /api/patient-portal/demo-login - Demo login
 * - GET /api/patient-portal/dashboard - Patient dashboard
 * - GET /api/patient-portal/profile - Get profile
 * - PUT /api/patient-portal/profile - Update profile
 * - GET /api/patient-portal/appointments - Get appointments
 * - GET /api/patient-portal/appointment-requests - Get appointment requests
 * - GET /api/patient-portal/appointment-types - Get appointment types
 * - GET /api/patient-portal/therapists - Get therapists
 * - POST /api/patient-portal/appointments/request - Request appointment
 * - POST /api/patient-portal/appointment-requests/:id/cancel - Cancel request
 * - GET /api/patient-portal/progress-notes - Get shared progress notes
 *
 * Mounted at /api so all paths include their full prefix.
 */

import { Router } from 'express';
import crypto from 'crypto';
import { storage } from '../storage';
import logger from '../services/logger';
import { sendEmail } from '../services/emailService';

const router = Router();

// Helper to get patient from Bearer token
const getPatientFromPortalToken = async (req: any): Promise<{ patient: any; access: any } | null> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  const access = await storage.getPatientPortalByToken(token);
  if (!access) {
    return null;
  }
  const patient = await storage.getPatient(access.patientId);
  if (!patient) {
    return null;
  }
  return { patient, access };
};

// ==================== PUBLIC BOOKING ENDPOINTS ====================

// Get booking page by slug
router.get('/public/book/:slug', async (req: any, res) => {
  try {
    const settings = await storage.getBookingSettingsBySlug(req.params.slug);
    if (!settings || !settings.isOnlineBookingEnabled) {
      return res.status(404).json({ message: 'Booking page not found' });
    }

    const practice = await storage.getPractice(settings.practiceId);
    const appointmentTypes = await storage.getAppointmentTypes(settings.practiceId, true);
    const activeTypes = appointmentTypes.filter(t => t.allowOnlineBooking);

    // Get therapists for this practice
    const therapists = await storage.getTherapistsByPractice(settings.practiceId);

    res.json({
      practice: {
        id: practice?.id,
        name: practice?.name,
        address: practice?.address,
        phone: practice?.phone,
      },
      settings: {
        welcomeMessage: settings.welcomeMessage,
        allowNewPatients: settings.allowNewPatients,
        newPatientMessage: settings.newPatientMessage,
        cancellationPolicy: settings.cancellationPolicy,
        requirePhoneNumber: settings.requirePhoneNumber,
        requireInsuranceInfo: settings.requireInsuranceInfo,
      },
      appointmentTypes: activeTypes,
      therapists: therapists.map(t => ({
        id: t.id,
        name: `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.email,
      })),
    });
  } catch (error) {
    logger.error('Error fetching booking page', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load booking page' });
  }
});

// Get available slots (public)
router.get('/public/book/:slug/slots', async (req: any, res) => {
  try {
    const settings = await storage.getBookingSettingsBySlug(req.params.slug);
    if (!settings || !settings.isOnlineBookingEnabled) {
      return res.status(404).json({ message: 'Booking page not found' });
    }

    const { appointmentTypeId, therapistId, date } = req.query;
    if (!appointmentTypeId || !date) {
      return res.status(400).json({ message: 'appointmentTypeId and date are required' });
    }

    const slots = await storage.getAvailableSlots(
      settings.practiceId,
      therapistId as string || null,
      parseInt(appointmentTypeId as string),
      new Date(date as string)
    );

    res.json(slots);
  } catch (error) {
    logger.error('Error fetching available slots', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch available slots' });
  }
});

// Create booking (public)
router.post('/public/book/:slug', async (req: any, res) => {
  try {
    const settings = await storage.getBookingSettingsBySlug(req.params.slug);
    if (!settings || !settings.isOnlineBookingEnabled) {
      return res.status(404).json({ message: 'Booking page not found' });
    }

    const {
      appointmentTypeId,
      therapistId,
      date,
      time,
      firstName,
      lastName,
      email,
      phone,
      notes,
      isNewPatient,
    } = req.body;

    // Validate required fields
    if (!appointmentTypeId || !date || !time || !firstName || !lastName || !email) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Check if slot is still available
    const slots = await storage.getAvailableSlots(
      settings.practiceId,
      therapistId || null,
      parseInt(appointmentTypeId),
      new Date(date)
    );

    if (!slots.includes(time)) {
      return res.status(400).json({ message: 'Selected time slot is no longer available' });
    }

    // Check if this is an existing patient by email
    let patientId: number | undefined;
    const patients = await storage.getPatients(settings.practiceId);
    const existingPatient = patients.find(p => p.email?.toLowerCase() === email.toLowerCase());
    if (existingPatient) {
      patientId = existingPatient.id;
    }

    // Create the booking
    const booking = await storage.createOnlineBooking({
      practiceId: settings.practiceId,
      appointmentTypeId: parseInt(appointmentTypeId),
      therapistId: therapistId || undefined,
      patientId,
      guestFirstName: !patientId ? firstName : undefined,
      guestLastName: !patientId ? lastName : undefined,
      guestEmail: !patientId ? email : undefined,
      guestPhone: !patientId ? phone : undefined,
      requestedDate: date,
      requestedTime: time,
      isNewPatient: isNewPatient || !patientId,
      notes,
      status: settings.requireInsuranceInfo ? 'pending' : 'pending',
    });

    // Send confirmation email
    const practice = await storage.getPractice(settings.practiceId);
    const appointmentType = await storage.getAppointmentType(parseInt(appointmentTypeId));

    // Send booking confirmation email (non-blocking)
    const patientEmail = existingPatient?.email || email;
    const patientName = existingPatient
      ? `${existingPatient.firstName} ${existingPatient.lastName}`
      : `${firstName} ${lastName}`;
    if (patientEmail) {
      sendEmail({
        to: patientEmail,
        subject: `Booking Confirmation - ${practice?.name || 'Your Practice'}`,
        fromName: practice?.name,
        html: `
          <h2>Your appointment request has been received</h2>
          <p>Hi ${patientName},</p>
          <p>We've received your booking request. Here are the details:</p>
          <ul>
            <li><strong>Date:</strong> ${new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</li>
            <li><strong>Time:</strong> ${time}</li>
            <li><strong>Type:</strong> ${appointmentType?.name || 'Appointment'}</li>
            <li><strong>Confirmation Code:</strong> ${booking.confirmationCode}</li>
          </ul>
          <p>Your appointment is pending confirmation. We'll reach out if any additional information is needed.</p>
          <p>Thank you,<br/>${practice?.name || 'Your Practice'}</p>
        `,
        text: `Booking Confirmation\n\nHi ${patientName},\n\nYour appointment request has been received.\nDate: ${date}\nTime: ${time}\nType: ${appointmentType?.name || 'Appointment'}\nConfirmation Code: ${booking.confirmationCode}\n\nYour appointment is pending confirmation.\n\nThank you,\n${practice?.name || 'Your Practice'}`,
      }).catch(err => logger.error('Failed to send booking confirmation email', { error: err instanceof Error ? err.message : String(err) }));
    }

    res.status(201).json({
      success: true,
      confirmationCode: booking.confirmationCode,
      message: 'Booking request submitted successfully',
      booking: {
        id: booking.id,
        date: booking.requestedDate,
        time: booking.requestedTime,
        appointmentType: appointmentType?.name,
        status: booking.status,
      },
    });
  } catch (error) {
    logger.error('Error creating booking', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create booking' });
  }
});

// Check booking status (public)
router.get('/public/booking/:code', async (req: any, res) => {
  try {
    const booking = await storage.getOnlineBookingByCode(req.params.code);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const appointmentType = booking.appointmentTypeId
      ? await storage.getAppointmentType(booking.appointmentTypeId)
      : null;

    res.json({
      confirmationCode: booking.confirmationCode,
      status: booking.status,
      date: booking.requestedDate,
      time: booking.requestedTime,
      appointmentType: appointmentType?.name,
      confirmedAt: booking.confirmedAt,
      cancelledAt: booking.cancelledAt,
    });
  } catch (error) {
    logger.error('Error checking booking status', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to check booking status' });
  }
});

// ==================== PUBLIC PATIENT PORTAL ENDPOINTS ====================

// Login via magic link
router.get('/public/portal/login/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const access = await storage.useMagicLink(token);

    if (!access) {
      return res.status(401).json({ message: 'Invalid or expired login link' });
    }

    // Return the portal token for subsequent requests
    res.json({
      portalToken: access.portalToken,
      expiresAt: access.portalTokenExpiresAt,
    });
  } catch (error) {
    logger.error('Error logging in', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Login failed' });
  }
});

// Get portal dashboard
router.get('/public/portal/:token/dashboard', async (req, res) => {
  try {
    const { token } = req.params;
    const access = await storage.getPatientPortalByToken(token);

    if (!access) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    await storage.updatePortalAccess(access.patientId);
    const dashboard = await storage.getPatientPortalDashboard(access.patientId);

    res.json({
      ...dashboard,
      permissions: {
        canViewAppointments: access.canViewAppointments,
        canViewStatements: access.canViewStatements,
        canViewDocuments: access.canViewDocuments,
        canSendMessages: access.canSendMessages,
        canUpdateProfile: access.canUpdateProfile,
        canCompleteIntake: access.canCompleteIntake,
      },
    });
  } catch (error) {
    logger.error('Error fetching dashboard', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch dashboard' });
  }
});

// Get patient profile
router.get('/public/portal/:token/profile', async (req, res) => {
  try {
    const { token } = req.params;
    const access = await storage.getPatientPortalByToken(token);

    if (!access) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const patient = await storage.getPatient(access.patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Return safe patient info (exclude sensitive fields)
    res.json({
      id: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      email: patient.email,
      phone: patient.phone,
      dateOfBirth: patient.dateOfBirth,
      address: patient.address,
    });
  } catch (error) {
    logger.error('Error fetching profile', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch profile' });
  }
});

// Update patient profile
router.patch('/public/portal/:token/profile', async (req, res) => {
  try {
    const { token } = req.params;
    const access = await storage.getPatientPortalByToken(token);

    if (!access) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    if (!access.canUpdateProfile) {
      return res.status(403).json({ message: 'Profile updates not allowed' });
    }

    const { phone, email, address } = req.body;
    const updates: Record<string, unknown> = {};
    if (phone !== undefined) updates.phone = phone;
    if (email !== undefined) updates.email = email;
    if (address !== undefined) updates.address = address;

    const patient = await storage.updatePatient(access.patientId, updates);
    res.json(patient);
  } catch (error) {
    logger.error('Error updating profile', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// Get appointments
router.get('/public/portal/:token/appointments', async (req, res) => {
  try {
    const { token } = req.params;
    const access = await storage.getPatientPortalByToken(token);

    if (!access) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    if (!access.canViewAppointments) {
      return res.status(403).json({ message: 'Appointment viewing not allowed' });
    }

    const patient = await storage.getPatient(access.patientId);
    if (!patient || !patient.practiceId) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const allAppointments = await storage.getAppointments(patient.practiceId);
    const patientAppointments = allAppointments.filter((apt: any) => apt.patientId === access.patientId);

    res.json(patientAppointments);
  } catch (error) {
    logger.error('Error fetching appointments', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch appointments' });
  }
});

// Get statements
router.get('/public/portal/:token/statements', async (req, res) => {
  try {
    const { token } = req.params;
    const access = await storage.getPatientPortalByToken(token);

    if (!access) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    if (!access.canViewStatements) {
      return res.status(403).json({ message: 'Statement viewing not allowed' });
    }

    const statements = await storage.getPatientStatements(access.patientId);
    res.json(statements);
  } catch (error) {
    logger.error('Error fetching statements', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch statements' });
  }
});

// View statement (marks as viewed)
router.get('/public/portal/:token/statements/:id', async (req, res) => {
  try {
    const { token, id } = req.params;
    const access = await storage.getPatientPortalByToken(token);

    if (!access) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const statement = await storage.getPatientStatement(parseInt(id));
    if (!statement || statement.patientId !== access.patientId) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    // Mark as sent (viewed via portal) if still in draft
    if (statement.status === 'draft') {
      await storage.markStatementSent(statement.id, 'portal');
    }

    res.json(statement);
  } catch (error) {
    logger.error('Error fetching statement', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch statement' });
  }
});

// Get documents
router.get('/public/portal/:token/documents', async (req, res) => {
  try {
    const { token } = req.params;
    const access = await storage.getPatientPortalByToken(token);

    if (!access) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    if (!access.canViewDocuments) {
      return res.status(403).json({ message: 'Document viewing not allowed' });
    }

    const documents = await storage.getPatientDocuments(access.patientId, true);
    res.json(documents);
  } catch (error) {
    logger.error('Error fetching documents', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch documents' });
  }
});

// View document (marks as viewed)
router.get('/public/portal/:token/documents/:id', async (req, res) => {
  try {
    const { token, id } = req.params;
    const access = await storage.getPatientPortalByToken(token);

    if (!access) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const document = await storage.getPatientDocument(parseInt(id));
    if (!document || document.patientId !== access.patientId || !document.visibleToPatient) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Mark as viewed
    await storage.markDocumentViewed(document.id);

    res.json(document);
  } catch (error) {
    logger.error('Error fetching document', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch document' });
  }
});

// Sign document
router.post('/public/portal/:token/documents/:id/sign', async (req, res) => {
  try {
    const { token, id } = req.params;
    const { signatureData } = req.body;

    const access = await storage.getPatientPortalByToken(token);
    if (!access) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const document = await storage.getPatientDocument(parseInt(id));
    if (!document || document.patientId !== access.patientId) {
      return res.status(404).json({ message: 'Document not found' });
    }

    if (!document.requiresSignature) {
      return res.status(400).json({ message: 'Document does not require signature' });
    }

    if (document.signedAt) {
      return res.status(400).json({ message: 'Document already signed' });
    }

    const signed = await storage.signDocument(document.id, signatureData);
    res.json(signed);
  } catch (error) {
    logger.error('Error signing document', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to sign document' });
  }
});

// ==================== NEW PATIENT PORTAL ====================

// Request login link via email
router.post('/patient-portal/request-login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Find patient by email across all practices
    const patient = await storage.getPatientByEmail(email);

    if (!patient) {
      // For security, don't reveal whether the email exists
      return res.json({ message: 'If an account exists with this email, a login link will be sent.' });
    }

    // Generate or refresh portal access with magic link
    let access = await storage.getPatientPortalAccess(patient.id);

    // Generate new magic link token
    const magicLinkToken = crypto.randomBytes(32).toString('hex');
    const magicLinkExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    if (access) {
      // Update with new magic link
      await storage.updatePatientPortalMagicLink(access.id, magicLinkToken, magicLinkExpires);
    } else {
      // Create new portal access
      const portalToken = crypto.randomBytes(32).toString('hex');
      const portalTokenExpires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

      await storage.createPatientPortalAccess({
        patientId: patient.id,
        practiceId: patient.practiceId,
        portalToken,
        portalTokenExpiresAt: portalTokenExpires,
        magicLinkToken,
        magicLinkExpiresAt: magicLinkExpires,
      });
    }

    // Send email with magic link
    const loginUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/patient-portal/login/${magicLinkToken}`;

    try {
      const { isEmailConfigured } = await import('../email');
      if (isEmailConfigured()) {
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER || '',
            pass: process.env.SMTP_PASS || '',
          },
        });

        await transporter.sendMail({
          from: `"Patient Portal" <${process.env.EMAIL_FROM || 'noreply@therapybill.ai'}>`,
          to: patient.email!,
          subject: 'Your Patient Portal Login Link',
          html: `
            <h2>Patient Portal Access</h2>
            <p>Hi ${patient.firstName},</p>
            <p>Click the link below to access your patient portal:</p>
            <p><a href="${loginUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Log In to Patient Portal</a></p>
            <p>This link will expire in 15 minutes for your security.</p>
            <p>If you didn't request this link, you can safely ignore this email.</p>
          `,
        });
      }
    } catch (emailError) {
      logger.error('Error sending login email', { error: emailError instanceof Error ? emailError.message : String(emailError) });
    }

    res.json({ message: 'If an account exists with this email, a login link will be sent.' });
  } catch (error) {
    logger.error('Error requesting login', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to process request' });
  }
});

// Exchange magic link token for portal token
router.get('/patient-portal/login/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const access = await storage.useMagicLink(token);

    if (!access) {
      return res.status(401).json({ message: 'Invalid or expired login link' });
    }

    res.json({
      portalToken: access.portalToken,
      expiresAt: access.portalTokenExpiresAt,
    });
  } catch (error) {
    logger.error('Error logging in', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Login failed' });
  }
});

// Demo login for patient portal (development/demo only)
router.get('/patient-portal/demo-login', async (req, res) => {
  try {
    // Find first patient with portal access from first available practice
    const practiceIds = await storage.getAllPracticeIds();
    if (!practiceIds.length) {
      return res.status(404).json({ message: 'No practices found for demo', step: 'getAllPracticeIds' });
    }
    const patients = await storage.getPatients(practiceIds[0]);
    if (!patients.length) {
      return res.status(404).json({ message: 'No patients found for demo', step: 'getPatients', practiceId: practiceIds[0] });
    }

    const patient = patients[0];

    // Check if patient has portal access, if not create it
    let access = await storage.getPatientPortalAccess(patient.id);

    // Generate unique tokens with timestamp to avoid collisions
    const uniqueToken = () => crypto.randomBytes(32).toString('hex') + Date.now().toString(36);

    if (!access) {
      // Create portal access for demo patient
      access = await storage.createPatientPortalAccess({
        patientId: patient.id,
        practiceId: patient.practiceId,
        magicLinkToken: uniqueToken(),
        magicLinkExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        portalToken: uniqueToken(),
        portalTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      });
    } else {
      // Return existing access if it's still valid
      if (access.portalToken && access.portalTokenExpiresAt && new Date(access.portalTokenExpiresAt) > new Date()) {
        // Token still valid, return it
      } else {
        // Try to refresh, but if it fails due to duplicate, just update the existing record directly
        try {
          access = await storage.refreshPortalToken(patient.id);
        } catch (refreshError) {
          // If refresh fails (duplicate key), update directly with a new unique token
          const { getDb } = await import('../db');
          const { sql } = await import('drizzle-orm');
          const db = await getDb();
          const newToken = uniqueToken();
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          await db.execute(sql`
            UPDATE patient_portal_access
            SET portal_token = ${newToken}, portal_token_expires_at = ${expiresAt}, updated_at = NOW()
            WHERE patient_id = ${patient.id}
          `);
          access = await storage.getPatientPortalAccess(patient.id);
        }
      }
    }

    res.json({
      portalToken: access!.portalToken,
      expiresAt: access!.portalTokenExpiresAt,
      patient: {
        firstName: patient.firstName,
        lastName: patient.lastName,
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Error with demo login', { error: errorMessage });
    res.status(500).json({ message: 'Demo login failed', error: errorMessage });
  }
});

// Get patient dashboard
router.get('/patient-portal/dashboard', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient, access } = auth;

    try {
      await storage.updatePortalAccess(patient.id);
    } catch (e) {
      logger.warn('Failed to update portal access', { error: e instanceof Error ? e.message : String(e) });
      // Continue - non-critical
    }

    // Get upcoming appointments
    const now = new Date();
    let allAppointments: any[] = [];
    try {
      allAppointments = await storage.getAppointments(patient.practiceId);
    } catch (e) {
      logger.warn('Failed to get appointments', { error: e instanceof Error ? e.message : String(e) });
      // Continue with empty
    }
    const upcomingAppointments = allAppointments
      .filter(apt => apt.patientId === patient.id && new Date(apt.startTime) >= now && apt.status !== 'cancelled')
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 5)
      .map(apt => ({
        id: apt.id,
        startTime: apt.startTime,
        endTime: apt.endTime,
        title: apt.title,
        status: apt.status,
      }));

    // Get pending appointment requests
    let pendingRequests: any[] = [];
    try {
      pendingRequests = await storage.getPatientAppointmentRequests(patient.id, 'pending_approval');
    } catch (e) {
      logger.warn('Failed to get appointment requests', { error: e instanceof Error ? e.message : String(e) });
      // Continue with empty
    }

    // Get recent (past) appointments
    const recentAppointments = allAppointments
      .filter(apt => apt.patientId === patient.id && (new Date(apt.startTime) < now || apt.status === 'completed'))
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .slice(0, 5)
      .map(apt => ({
        id: apt.id,
        startTime: apt.startTime,
        status: apt.status,
        title: apt.title,
      }));

    // Calculate profile completion
    const requiredFields = ['firstName', 'lastName', 'email', 'phone', 'dateOfBirth', 'address', 'insuranceProvider'];
    const missingFields: string[] = [];
    requiredFields.forEach(field => {
      if (!patient[field as keyof typeof patient]) {
        missingFields.push(field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()));
      }
    });
    const completedFields = requiredFields.length - missingFields.length;
    const percentage = Math.round((completedFields / requiredFields.length) * 100);

    // Check intake completion (all required fields + insurance ID)
    const intakeRequiredFields = ['firstName', 'lastName', 'email', 'phone', 'dateOfBirth', 'address', 'insuranceProvider', 'insuranceId'];
    const intakeCompleted = intakeRequiredFields.every(field => !!patient[field as keyof typeof patient]);

    // Check if patient has a payment method on file
    const hasPaymentMethod = access.hasPaymentMethod || false;

    res.json({
      patient: {
        id: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        email: patient.email,
        phone: patient.phone,
        dateOfBirth: patient.dateOfBirth,
        insuranceProvider: patient.insuranceProvider,
      },
      upcomingAppointments,
      pendingRequests,
      recentAppointments,
      profileCompletion: {
        percentage,
        missingFields,
      },
      intakeCompleted,
      hasPaymentMethod,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Error fetching dashboard', { error: errorMessage });
    res.status(500).json({ message: 'Failed to fetch dashboard', error: errorMessage });
  }
});

// Get patient profile
router.get('/patient-portal/profile', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient } = auth;

    res.json({
      id: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      email: patient.email,
      phone: patient.phone,
      phoneType: patient.phoneType,
      dateOfBirth: patient.dateOfBirth,
      address: patient.address,
      preferredContactMethod: patient.preferredContactMethod,
      smsConsentGiven: patient.smsConsentGiven,
      insuranceProvider: patient.insuranceProvider,
      insuranceId: patient.insuranceId,
      policyNumber: patient.policyNumber,
      groupNumber: patient.groupNumber,
    });
  } catch (error) {
    logger.error('Error fetching profile', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch profile' });
  }
});

// Update patient profile
router.put('/patient-portal/profile', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient, access } = auth;
    if (!access.canUpdateProfile) {
      return res.status(403).json({ message: 'Profile updates not allowed' });
    }

    // Only allow specific fields to be updated
    const allowedFields = [
      'firstName', 'lastName', 'email', 'phone', 'phoneType',
      'dateOfBirth', 'address', 'preferredContactMethod', 'smsConsentGiven',
      'insuranceProvider', 'insuranceId', 'policyNumber', 'groupNumber'
    ];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const updatedPatient = await storage.updatePatient(patient.id, updates);
    res.json(updatedPatient);
  } catch (error) {
    logger.error('Error updating profile', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// Get patient appointments
router.get('/patient-portal/appointments', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient, access } = auth;
    if (!access.canViewAppointments) {
      return res.status(403).json({ message: 'Appointment viewing not allowed' });
    }

    const allAppointments = await storage.getAppointments(patient.practiceId);
    const patientAppointments = allAppointments
      .filter(apt => apt.patientId === patient.id)
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

    // Enrich with therapist names
    const enrichedAppointments = await Promise.all(patientAppointments.map(async (apt) => {
      let therapistName = null;
      if (apt.therapistId) {
        const therapist = await storage.getUser(apt.therapistId);
        if (therapist) {
          therapistName = `${therapist.firstName} ${therapist.lastName}`;
        }
      }
      return {
        ...apt,
        therapistName,
      };
    }));

    res.json({ appointments: enrichedAppointments });
  } catch (error) {
    logger.error('Error fetching appointments', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch appointments' });
  }
});

// Get appointment requests
router.get('/patient-portal/appointment-requests', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient } = auth;
    const requests = await storage.getPatientAppointmentRequests(patient.id);

    res.json({ requests });
  } catch (error) {
    logger.error('Error fetching appointment requests', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch appointment requests' });
  }
});

// Get appointment types (for booking)
router.get('/patient-portal/appointment-types', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient } = auth;
    const appointmentTypes = await storage.getAppointmentTypes(patient.practiceId, true);

    // Only return types that allow online booking
    const bookableTypes = appointmentTypes.filter(t => t.allowOnlineBooking);

    res.json(bookableTypes.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      duration: t.duration,
      requiresApproval: t.requiresApproval,
    })));
  } catch (error) {
    logger.error('Error fetching appointment types', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch appointment types' });
  }
});

// Get therapists (for booking)
router.get('/patient-portal/therapists', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const users = await storage.getAllUsers();
    const therapists = users.filter(u => u.role === 'therapist' || u.role === 'admin');

    res.json(therapists.map(t => ({
      id: t.id,
      firstName: t.firstName,
      lastName: t.lastName,
    })));
  } catch (error) {
    logger.error('Error fetching therapists', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch therapists' });
  }
});

// Request new appointment (pending approval)
router.post('/patient-portal/appointments/request', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient } = auth;
    const { appointmentTypeId, therapistId, requestedDate, requestedTime, notes } = req.body;

    if (!appointmentTypeId || !requestedDate || !requestedTime) {
      return res.status(400).json({ message: 'Appointment type, date, and time are required' });
    }

    // Validate appointment type exists
    const appointmentType = await storage.getAppointmentType(parseInt(appointmentTypeId));
    if (!appointmentType) {
      return res.status(404).json({ message: 'Invalid appointment type' });
    }

    // Create appointment request
    const request = await storage.createAppointmentRequest({
      practiceId: patient.practiceId,
      patientId: patient.id,
      appointmentTypeId: parseInt(appointmentTypeId),
      therapistId: therapistId || null,
      requestedDate,
      requestedTime,
      notes: notes || null,
      status: 'pending_approval',
    });

    res.status(201).json({
      message: 'Appointment request submitted successfully',
      request,
    });
  } catch (error) {
    logger.error('Error creating appointment request', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create appointment request' });
  }
});

// Cancel appointment request
router.post('/patient-portal/appointment-requests/:id/cancel', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient } = auth;
    const requestId = parseInt(req.params.id);

    const request = await storage.getAppointmentRequest(requestId);
    if (!request || request.patientId !== patient.id) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.status !== 'pending_approval') {
      return res.status(400).json({ message: 'Only pending requests can be cancelled' });
    }

    await storage.updateAppointmentRequest(requestId, { status: 'cancelled' });

    res.json({ message: 'Request cancelled successfully' });
  } catch (error) {
    logger.error('Error cancelling request', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to cancel request' });
  }
});

// Patient portal: get shared progress notes
router.get('/patient-portal/progress-notes', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient } = auth;
    const notes = await storage.getSharedPatientProgressNotes(patient.id);
    res.json(notes);
  } catch (error) {
    logger.error('Error fetching portal progress notes', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch progress notes' });
  }
});

// Debug endpoint to check/fix demo data (only in demo mode)
router.get('/debug/demo-status', async (req, res) => {
  try {
    const isDemoMode = !!process.env.RENDER;
    if (!isDemoMode) {
      return res.status(403).json({ message: 'Debug endpoint only available in demo mode' });
    }

    // Import db for raw queries
    const { getDb } = await import('../db');
    const { sql } = await import('drizzle-orm');
    const db = await getDb();

    // Check table columns
    const patientCols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'patients' ORDER BY ordinal_position
    `);

    // Check database state
    const practices = await storage.getAllPracticeIds();
    const practiceCount = practices.length;

    let patientCount = 0;
    let userCount = 0;

    if (practiceCount > 0) {
      // Use raw query to avoid column issues
      const patientResult = await db.execute(sql`SELECT COUNT(*) as count FROM patients WHERE practice_id = ${practices[0]}`);
      patientCount = parseInt(patientResult.rows[0]?.count || '0', 10);
      const users = await storage.getAllUsers();
      userCount = users.length;
    }

    res.json({
      demoMode: isDemoMode,
      database: {
        practices: practiceCount,
        patients: patientCount,
        users: userCount,
      },
      patientColumns: patientCols.rows.map((r: any) => r.column_name),
      status: practiceCount > 0 && patientCount > 0 ? 'ready' : 'needs_seed',
    });
  } catch (error) {
    logger.error('Error checking demo status', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to check demo status', error: String(error) });
  }
});

// Force seed demo data
router.post('/debug/force-seed', async (req, res) => {
  try {
    const isDemoMode = !!process.env.RENDER;
    if (!isDemoMode) {
      return res.status(403).json({ message: 'Debug endpoint only available in demo mode' });
    }

    // Import and run seed
    const { seedDatabase } = await import('../seeds');
    await seedDatabase();

    res.json({ message: 'Seed completed', timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Error force seeding', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to seed', error: String(error) });
  }
});

export default router;
