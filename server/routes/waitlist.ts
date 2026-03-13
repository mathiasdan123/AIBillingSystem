/**
 * Waitlist Routes
 *
 * Handles:
 * - GET /api/waitlist - List waitlist entries with filters
 * - GET /api/waitlist/stats - Get waitlist statistics (count, avg wait, fill rate)
 * - GET /api/waitlist/:id - Get single waitlist entry
 * - POST /api/waitlist - Create waitlist entry
 * - PUT /api/waitlist/:id - Update waitlist entry
 * - PATCH /api/waitlist/:id - Partial update (backward compat)
 * - DELETE /api/waitlist/:id - Delete waitlist entry
 * - POST /api/waitlist/auto-fill - Auto-find and offer cancelled slot to waitlist
 * - POST /api/waitlist/:id/accept - Patient accepts offered slot
 * - POST /api/waitlist/:id/decline - Patient declines offered slot, offer to next
 * - POST /api/waitlist/find-matches - Find matching entries for cancellation slot
 * - POST /api/waitlist/:id/notify - Notify waitlist patient about opening
 * - POST /api/waitlist/:id/schedule - Mark waitlist entry as scheduled
 * - POST /api/waitlist/expire - Expire old waitlist entries
 *
 * Mounted at /api so all paths include their full prefix.
 */

import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
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

// ==================== WAITLIST CRUD ====================

// Get waitlist entries
router.get('/waitlist', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      status: req.query.status as string | undefined,
      therapistId: req.query.therapistId as string | undefined,
      patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
      priority: req.query.priority ? parseInt(req.query.priority as string) : undefined,
    };
    const entries = await storage.getWaitlist(practiceId, filters);
    res.json(entries);
  } catch (error) {
    logger.error('Error fetching waitlist', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch waitlist' });
  }
});

// Get waitlist statistics (enhanced with fill rate)
router.get('/waitlist/stats', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const stats = await storage.getWaitlistStats(practiceId);

    // Calculate fill rate and monthly stats from all entries
    const allEntries = await storage.getWaitlist(practiceId);
    const scheduledCount = allEntries.filter((e: any) => e.status === 'scheduled').length;
    const expiredOrCancelledCount = allEntries.filter((e: any) =>
      e.status === 'expired' || e.status === 'cancelled'
    ).length;
    const totalResolved = scheduledCount + expiredOrCancelledCount;
    const fillRate = totalResolved > 0 ? Math.round((scheduledCount / totalResolved) * 100) : 0;

    // Count slots filled this month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const filledThisMonth = allEntries.filter((e: any) => {
      if (e.status !== 'scheduled') return false;
      const updated = new Date(e.updatedAt);
      return updated >= monthStart;
    }).length;

    // Count offered entries
    const offeredCount = allEntries.filter((e: any) => e.status === 'offered').length;

    res.json({
      ...stats,
      offered: offeredCount,
      fillRate,
      filledThisMonth,
    });
  } catch (error) {
    logger.error('Error fetching waitlist stats', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch waitlist stats' });
  }
});

// Get a single waitlist entry
router.get('/waitlist/:id', isAuthenticated, async (req: any, res) => {
  try {
    const entry = await storage.getWaitlistEntry(parseInt(req.params.id));
    if (!entry) {
      return res.status(404).json({ message: 'Waitlist entry not found' });
    }
    res.json(entry);
  } catch (error) {
    logger.error('Error fetching waitlist entry', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch waitlist entry' });
  }
});

// Create a new waitlist entry
router.post('/waitlist', isAuthenticated, async (req: any, res) => {
  try {
    const data = {
      ...req.body,
      practiceId: getAuthorizedPracticeId(req),
    };
    const entry = await storage.createWaitlistEntry(data);
    res.status(201).json(entry);
  } catch (error) {
    logger.error('Error creating waitlist entry', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create waitlist entry' });
  }
});

// Update a waitlist entry (PUT)
router.put('/waitlist/:id', isAuthenticated, async (req: any, res) => {
  try {
    const entry = await storage.updateWaitlistEntry(parseInt(req.params.id), req.body);
    res.json(entry);
  } catch (error) {
    logger.error('Error updating waitlist entry', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update waitlist entry' });
  }
});

// Update a waitlist entry (PATCH - backward compat)
router.patch('/waitlist/:id', isAuthenticated, async (req: any, res) => {
  try {
    const entry = await storage.updateWaitlistEntry(parseInt(req.params.id), req.body);
    res.json(entry);
  } catch (error) {
    logger.error('Error updating waitlist entry', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update waitlist entry' });
  }
});

// Delete a waitlist entry
router.delete('/waitlist/:id', isAuthenticated, async (req: any, res) => {
  try {
    await storage.deleteWaitlistEntry(parseInt(req.params.id));
    res.json({ message: 'Waitlist entry deleted' });
  } catch (error) {
    logger.error('Error deleting waitlist entry', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete waitlist entry' });
  }
});

// ==================== AUTO-FILL SYSTEM ====================

/**
 * POST /api/waitlist/auto-fill
 *
 * When an appointment is cancelled, automatically find matching waitlist patients.
 * Matches by: therapist preference, day of week, time window, appointment type.
 * Ranks by priority (desc), then wait time (longest first).
 * Offers the slot to the top match with a 24-hour response deadline.
 */
router.post('/waitlist/auto-fill', isAuthenticated, async (req: any, res) => {
  try {
    const { appointmentId, therapistId, date, startTime, endTime, appointmentType } = req.body;
    const practiceId = getAuthorizedPracticeId(req);

    if (!date || !startTime) {
      return res.status(400).json({ message: 'date and startTime are required' });
    }

    const result = await autoFillSlot(practiceId, {
      appointmentId,
      therapistId,
      date,
      startTime,
      endTime,
      appointmentType,
    });

    res.json(result);
  } catch (error) {
    logger.error('Error auto-filling waitlist slot', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to auto-fill slot' });
  }
});

/**
 * POST /api/waitlist/:id/accept
 * Patient accepts the offered slot, creates an appointment.
 */
router.post('/waitlist/:id/accept', isAuthenticated, async (req: any, res) => {
  try {
    const entryId = parseInt(req.params.id);
    const entry = await storage.getWaitlistEntry(entryId);
    if (!entry) {
      return res.status(404).json({ message: 'Waitlist entry not found' });
    }
    if (entry.status !== 'offered') {
      return res.status(400).json({ message: 'Entry is not in offered status' });
    }

    // Check if respondBy deadline has passed
    if (entry.respondBy && new Date(entry.respondBy) < new Date()) {
      await storage.updateWaitlistEntry(entryId, {
        status: 'waiting',
        offeredAt: null,
        offeredSlot: null,
        respondBy: null,
      } as any);
      return res.status(400).json({ message: 'Offer has expired. The slot may no longer be available.' });
    }

    const offeredSlot = entry.offeredSlot as { date: string; startTime: string; endTime: string } | null;
    if (!offeredSlot) {
      return res.status(400).json({ message: 'No offered slot data found' });
    }

    // Create appointment from the offered slot
    const appointment = await storage.createAppointment({
      practiceId: entry.practiceId,
      patientId: entry.patientId,
      therapistId: entry.therapistId || undefined,
      title: entry.appointmentType || 'Waitlist Appointment',
      startTime: new Date(`${offeredSlot.date}T${offeredSlot.startTime}`),
      endTime: new Date(`${offeredSlot.date}T${offeredSlot.endTime}`),
      status: 'scheduled',
      notes: `Booked from waitlist entry #${entryId}`,
    });

    // Mark waitlist entry as scheduled
    await storage.updateWaitlistEntry(entryId, {
      status: 'scheduled',
      scheduledAppointmentId: appointment.id,
    } as any);

    logger.info('Waitlist entry accepted and appointment created', {
      waitlistEntryId: entryId,
      appointmentId: appointment.id,
    });

    res.json({
      message: 'Slot accepted and appointment created',
      appointment,
      waitlistEntry: { ...entry, status: 'scheduled', scheduledAppointmentId: appointment.id },
    });
  } catch (error) {
    logger.error('Error accepting waitlist offer', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to accept waitlist offer' });
  }
});

/**
 * POST /api/waitlist/:id/decline
 * Patient declines the offered slot. Reverts to waiting and offers to next match.
 */
router.post('/waitlist/:id/decline', isAuthenticated, async (req: any, res) => {
  try {
    const entryId = parseInt(req.params.id);
    const entry = await storage.getWaitlistEntry(entryId);
    if (!entry) {
      return res.status(404).json({ message: 'Waitlist entry not found' });
    }
    if (entry.status !== 'offered') {
      return res.status(400).json({ message: 'Entry is not in offered status' });
    }

    const offeredSlot = entry.offeredSlot as { date: string; startTime: string; endTime: string } | null;

    // Revert entry back to waiting
    await storage.updateWaitlistEntry(entryId, {
      status: 'waiting',
      offeredAt: null,
      offeredSlot: null,
      respondBy: null,
    } as any);

    logger.info('Waitlist offer declined', { waitlistEntryId: entryId });

    // Offer to next match
    let nextOffer = null;
    if (offeredSlot) {
      nextOffer = await autoFillSlot(entry.practiceId, {
        therapistId: entry.therapistId || undefined,
        date: offeredSlot.date,
        startTime: offeredSlot.startTime,
        endTime: offeredSlot.endTime,
        appointmentType: entry.appointmentType || undefined,
        excludeEntryIds: [entryId],
      });
    }

    res.json({
      message: 'Offer declined',
      nextOffer,
    });
  } catch (error) {
    logger.error('Error declining waitlist offer', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to decline waitlist offer' });
  }
});

// ==================== LEGACY ENDPOINTS ====================

// Find matching waitlist entries for a cancellation slot
router.post('/waitlist/find-matches', isAuthenticated, async (req: any, res) => {
  try {
    const { therapistId, date, time } = req.body;
    const practiceId = getAuthorizedPracticeId(req);
    const matches = await storage.getWaitlistForSlot(
      practiceId,
      therapistId,
      new Date(date),
      time
    );
    res.json(matches);
  } catch (error) {
    logger.error('Error finding waitlist matches', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to find waitlist matches' });
  }
});

// Notify a waitlist patient about an opening
router.post('/waitlist/:id/notify', isAuthenticated, async (req: any, res) => {
  try {
    const { date, time, therapistId } = req.body;
    const entryId = parseInt(req.params.id);

    const entry = await storage.getWaitlistEntry(entryId);
    if (!entry) {
      return res.status(404).json({ message: 'Waitlist entry not found' });
    }

    const patient = await storage.getPatient(entry.patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const practice = await storage.getPractice(entry.practiceId);
    const practiceName = practice?.name || 'Your Practice';

    const slotDate = new Date(date);
    const formattedDate = slotDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    const results: { emailSent?: boolean; smsSent?: boolean; errors: string[] } = { errors: [] };

    if (patient.email) {
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
            from: `"${practiceName}" <${process.env.EMAIL_FROM || 'noreply@therapybill.ai'}>`,
            to: patient.email,
            subject: `Appointment Opening Available - ${formattedDate}`,
            html: `
              <p>Hi ${patient.firstName},</p>
              <p>Great news! An appointment slot has opened up that matches your preferences:</p>
              <p><strong>Date:</strong> ${formattedDate}<br>
              <strong>Time:</strong> ${time}</p>
              <p>If you'd like to book this appointment, please contact us as soon as possible as slots fill up quickly.</p>
              <p>Best regards,<br>${practiceName}</p>
            `,
          });
          results.emailSent = true;
        }
      } catch (err) {
        results.errors.push(`Email failed: ${(err as Error).message}`);
      }
    }

    if (patient.phone) {
      try {
        const { sendSMS, isSMSConfigured } = await import('../services/smsService');
        if (isSMSConfigured()) {
          const smsResult = await sendSMS(
            patient.phone,
            `Hi ${patient.firstName}! An appointment slot opened at ${practiceName} on ${formattedDate} at ${time}. Reply YES to book or call us ASAP!`
          );
          results.smsSent = smsResult.success;
          if (!smsResult.success) {
            results.errors.push(`SMS failed: ${smsResult.error}`);
          }
        }
      } catch (err) {
        results.errors.push(`SMS error: ${(err as Error).message}`);
      }
    }

    if (results.emailSent || results.smsSent) {
      await storage.markWaitlistNotified(entryId, { date, time, therapistId });
    }

    res.json({
      message: 'Patient notified',
      ...results,
    });
  } catch (error) {
    logger.error('Error notifying waitlist patient', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to notify patient' });
  }
});

// Mark waitlist entry as scheduled
router.post('/waitlist/:id/schedule', isAuthenticated, async (req: any, res) => {
  try {
    const { appointmentId } = req.body;
    const entry = await storage.markWaitlistScheduled(
      parseInt(req.params.id),
      appointmentId
    );
    res.json(entry);
  } catch (error) {
    logger.error('Error scheduling waitlist entry', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to schedule waitlist entry' });
  }
});

// Expire old waitlist entries
router.post('/waitlist/expire', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const count = await storage.expireOldWaitlistEntries(practiceId);
    res.json({ message: `Expired ${count} waitlist entries` });
  } catch (error) {
    logger.error('Error expiring waitlist entries', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to expire waitlist entries' });
  }
});

// ==================== AUTO-FILL HELPER ====================

interface AutoFillParams {
  appointmentId?: number;
  therapistId?: string;
  date: string;
  startTime: string;
  endTime?: string;
  appointmentType?: string;
  excludeEntryIds?: number[];
}

/**
 * Find matching waitlist patients for a cancelled slot and offer to the top match.
 * Exported so it can be called from the appointment cancellation flow.
 */
export async function autoFillSlot(practiceId: number, params: AutoFillParams) {
  const { therapistId, date, startTime, endTime, appointmentType, excludeEntryIds = [] } = params;

  const slotDate = new Date(date);
  const dayOfWeek = slotDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

  // Get all waiting entries for this practice
  const waitingEntries = await storage.getWaitlist(practiceId, { status: 'waiting' });

  // Filter and score matches
  const matches = waitingEntries
    .filter((entry: any) => {
      // Exclude specific entry IDs (e.g., just-declined entries)
      if (excludeEntryIds.includes(entry.id)) return false;

      // Check expiration
      if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) return false;

      // Check therapist preference (if the entry has a preference, it must match)
      if (entry.therapistId && therapistId && entry.therapistId !== therapistId) return false;

      // Check preferred days
      const preferredDays = entry.preferredDays as string[] | null;
      if (preferredDays && preferredDays.length > 0 && !preferredDays.includes(dayOfWeek)) return false;

      // Check preferred time range
      if (entry.preferredTimeStart && entry.preferredTimeEnd) {
        if (startTime < entry.preferredTimeStart || startTime > entry.preferredTimeEnd) return false;
      }

      // Check appointment type (if both specify one, they must match)
      if (appointmentType && entry.appointmentType && entry.appointmentType !== appointmentType) return false;

      return true;
    })
    .sort((a: any, b: any) => {
      // Sort by priority descending, then by createdAt ascending (longest wait first)
      if ((b.priority || 0) !== (a.priority || 0)) {
        return (b.priority || 0) - (a.priority || 0);
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  if (matches.length === 0) {
    return { matched: false, message: 'No matching waitlist patients found', matchCount: 0 };
  }

  const topMatch = matches[0] as any;

  // Set 24-hour response deadline
  const respondBy = new Date();
  respondBy.setHours(respondBy.getHours() + 24);

  const offeredSlot = {
    date,
    startTime,
    endTime: endTime || startTime,
  };

  // Update entry to "offered" status
  await storage.updateWaitlistEntry(topMatch.id, {
    status: 'offered',
    offeredAt: new Date(),
    offeredSlot,
    respondBy,
  } as any);

  // Send notification (email/SMS placeholder)
  let notificationSent = false;
  try {
    const patient = await storage.getPatient(topMatch.patientId);
    const practice = await storage.getPractice(practiceId);
    const practiceName = practice?.name || 'Your Practice';

    if (patient) {
      const formattedDate = slotDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });

      if (patient.email) {
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
              from: `"${practiceName}" <${process.env.EMAIL_FROM || 'noreply@therapybill.ai'}>`,
              to: patient.email,
              subject: `Appointment Slot Available - ${formattedDate} at ${startTime}`,
              html: `
                <p>Hi ${patient.firstName},</p>
                <p>An appointment slot has opened up that matches your waitlist preferences:</p>
                <p><strong>Date:</strong> ${formattedDate}<br>
                <strong>Time:</strong> ${startTime}${endTime ? ` - ${endTime}` : ''}</p>
                <p>Please respond within 24 hours to secure this slot.</p>
                <p>Best regards,<br>${practiceName}</p>
              `,
            });
            notificationSent = true;
          }
        } catch (err) {
          logger.warn('Auto-fill email notification failed', { error: (err as Error).message });
        }
      }

      if (patient.phone) {
        try {
          const { sendSMS, isSMSConfigured } = await import('../services/smsService');
          if (isSMSConfigured()) {
            const smsResult = await sendSMS(
              patient.phone,
              `Hi ${patient.firstName}! A slot opened at ${practiceName} on ${formattedDate} at ${startTime}. Reply within 24hrs to book!`
            );
            if (smsResult.success) notificationSent = true;
          }
        } catch (err) {
          logger.warn('Auto-fill SMS notification failed', { error: (err as Error).message });
        }
      }
    }
  } catch (err) {
    logger.warn('Auto-fill notification error', { error: (err as Error).message });
  }

  logger.info('Waitlist auto-fill: slot offered', {
    waitlistEntryId: topMatch.id,
    patientId: topMatch.patientId,
    slot: offeredSlot,
    matchCount: matches.length,
    notificationSent,
  });

  return {
    matched: true,
    message: 'Slot offered to top matching patient',
    matchCount: matches.length,
    offeredTo: {
      waitlistEntryId: topMatch.id,
      patientId: topMatch.patientId,
      priority: topMatch.priority,
      respondBy: respondBy.toISOString(),
    },
    notificationSent,
  };
}

export default router;
