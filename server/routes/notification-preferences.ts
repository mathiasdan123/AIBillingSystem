/**
 * Notification Preferences Routes
 *
 * Handles:
 * - GET  /notification-preferences           - Get current staff user's preferences
 * - PUT  /notification-preferences           - Update current staff user's preferences
 * - GET  /patient-portal/notification-preferences  - Get patient portal preferences
 * - PUT  /patient-portal/notification-preferences  - Update patient portal preferences
 *
 * Mounted at /api so all paths include their full prefix.
 */

import { Router } from 'express';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';
import {
  getPatientPreferences,
  getStaffPreferences,
  updatePreferences,
} from '../services/notificationPreferencesService';
import logger from '../services/logger';

const router = Router();

// ==================== STAFF ROUTES ====================

/**
 * GET /notification-preferences
 * Get notification preferences for the authenticated staff user.
 */
router.get('/notification-preferences', isAuthenticated, async (req: any, res) => {
  try {
    const user = req.user;
    if (!user || !user.practiceId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const prefs = await getStaffPreferences(user.id, user.practiceId);
    return res.json(prefs);
  } catch (error) {
    logger.error('Failed to get notification preferences', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ message: 'Failed to get notification preferences' });
  }
});

/**
 * PUT /notification-preferences
 * Update notification preferences for the authenticated staff user.
 */
router.put('/notification-preferences', isAuthenticated, async (req: any, res) => {
  try {
    const user = req.user;
    if (!user || !user.practiceId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Get or create preferences first to ensure we have the record
    const existing = await getStaffPreferences(user.id, user.practiceId);

    const allowedFields = [
      'emailEnabled',
      'smsEnabled',
      'portalEnabled',
      'appointmentReminders',
      'billingNotifications',
      'claimUpdates',
      'surveyReminders',
      'marketingEmails',
      'quietHoursStart',
      'quietHoursEnd',
    ] as const;

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.json(existing);
    }

    const updated = await updatePreferences(existing.id, updates);
    return res.json(updated);
  } catch (error) {
    logger.error('Failed to update notification preferences', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ message: 'Failed to update notification preferences' });
  }
});

// ==================== PATIENT PORTAL ROUTES ====================

/**
 * Helper to get patient from Bearer token (same pattern as public-portal.ts)
 */
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

/**
 * GET /patient-portal/notification-preferences
 * Get notification preferences for the authenticated patient.
 */
router.get('/patient-portal/notification-preferences', async (req: any, res) => {
  try {
    const result = await getPatientFromPortalToken(req);
    if (!result) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { patient } = result;
    const prefs = await getPatientPreferences(patient.id, patient.practiceId);
    return res.json(prefs);
  } catch (error) {
    logger.error('Failed to get patient notification preferences', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ message: 'Failed to get notification preferences' });
  }
});

/**
 * PUT /patient-portal/notification-preferences
 * Update notification preferences for the authenticated patient.
 */
router.put('/patient-portal/notification-preferences', async (req: any, res) => {
  try {
    const result = await getPatientFromPortalToken(req);
    if (!result) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { patient } = result;
    const existing = await getPatientPreferences(patient.id, patient.practiceId);

    const allowedFields = [
      'emailEnabled',
      'smsEnabled',
      'portalEnabled',
      'appointmentReminders',
      'billingNotifications',
      'claimUpdates',
      'surveyReminders',
      'marketingEmails',
      'quietHoursStart',
      'quietHoursEnd',
    ] as const;

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.json(existing);
    }

    const updated = await updatePreferences(existing.id, updates);
    return res.json(updated);
  } catch (error) {
    logger.error('Failed to update patient notification preferences', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ message: 'Failed to update notification preferences' });
  }
});

export default router;
