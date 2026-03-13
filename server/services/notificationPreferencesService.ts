/**
 * Notification Preferences Service
 *
 * Provides helpers to check notification preferences before sending
 * emails, SMS, or portal notifications. Integrates with emailService
 * and smsService to gate outbound messages.
 */

import { db } from '../db';
import { eq, and } from 'drizzle-orm';
import { notificationPreferences } from '@shared/schema';
import logger from './logger';

export type NotificationType =
  | 'appointmentReminders'
  | 'billingNotifications'
  | 'claimUpdates'
  | 'surveyReminders'
  | 'marketingEmails';

export type NotificationChannel = 'email' | 'sms' | 'portal';

interface PreferenceCheckResult {
  allowed: boolean;
  channels: {
    email: boolean;
    sms: boolean;
    portal: boolean;
  };
  inQuietHours: boolean;
}

/**
 * Check whether a notification should be sent to a patient.
 * Returns which channels are allowed and whether we're in quiet hours.
 */
export async function shouldSendNotification(
  patientId: number,
  notificationType: NotificationType,
): Promise<PreferenceCheckResult> {
  try {
    const [prefs] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.patientId, patientId))
      .limit(1);

    // If no preferences record exists, default to allowing everything
    if (!prefs) {
      return {
        allowed: true,
        channels: { email: true, sms: true, portal: true },
        inQuietHours: false,
      };
    }

    // Check if notification type is enabled
    const typeEnabled = prefs[notificationType] ?? true;

    const channels = {
      email: prefs.emailEnabled && typeEnabled,
      sms: prefs.smsEnabled && typeEnabled,
      portal: prefs.portalEnabled && typeEnabled,
    };

    const inQuietHours = isInQuietHours(prefs.quietHoursStart, prefs.quietHoursEnd);

    // At least one channel must be enabled and the type must be enabled
    const allowed = typeEnabled && (channels.email || channels.sms || channels.portal);

    return { allowed, channels, inQuietHours };
  } catch (error) {
    logger.error('Error checking notification preferences', {
      patientId,
      notificationType,
      error: error instanceof Error ? error.message : String(error),
    });
    // On error, default to allowing the notification
    return {
      allowed: true,
      channels: { email: true, sms: true, portal: true },
      inQuietHours: false,
    };
  }
}

/**
 * Check whether a notification should be sent to a staff user.
 */
export async function shouldSendStaffNotification(
  userId: string,
  notificationType: NotificationType,
): Promise<PreferenceCheckResult> {
  try {
    const [prefs] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);

    if (!prefs) {
      return {
        allowed: true,
        channels: { email: true, sms: true, portal: true },
        inQuietHours: false,
      };
    }

    const typeEnabled = prefs[notificationType] ?? true;

    const channels = {
      email: prefs.emailEnabled && typeEnabled,
      sms: prefs.smsEnabled && typeEnabled,
      portal: prefs.portalEnabled && typeEnabled,
    };

    const inQuietHours = isInQuietHours(prefs.quietHoursStart, prefs.quietHoursEnd);
    const allowed = typeEnabled && (channels.email || channels.sms || channels.portal);

    return { allowed, channels, inQuietHours };
  } catch (error) {
    logger.error('Error checking staff notification preferences', {
      userId,
      notificationType,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      allowed: true,
      channels: { email: true, sms: true, portal: true },
      inQuietHours: false,
    };
  }
}

/**
 * Get or create notification preferences for a patient.
 */
export async function getPatientPreferences(patientId: number, practiceId: number) {
  const [existing] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.patientId, patientId))
    .limit(1);

  if (existing) return existing;

  // Create default preferences
  const [created] = await db
    .insert(notificationPreferences)
    .values({ patientId, practiceId })
    .returning();

  return created;
}

/**
 * Get or create notification preferences for a staff user.
 */
export async function getStaffPreferences(userId: string, practiceId: number) {
  const [existing] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(notificationPreferences)
    .values({ userId, practiceId })
    .returning();

  return created;
}

/**
 * Update notification preferences by record ID.
 */
export async function updatePreferences(
  id: number,
  updates: Partial<{
    emailEnabled: boolean;
    smsEnabled: boolean;
    portalEnabled: boolean;
    appointmentReminders: boolean;
    billingNotifications: boolean;
    claimUpdates: boolean;
    surveyReminders: boolean;
    marketingEmails: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
  }>,
) {
  const [updated] = await db
    .update(notificationPreferences)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(notificationPreferences.id, id))
    .returning();

  return updated;
}

/**
 * Check if the current time falls within quiet hours.
 * Quiet hours are specified in HH:MM format (24-hour).
 */
function isInQuietHours(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);

  if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) {
    return false;
  }

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // Same-day range (e.g., 08:00 - 18:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight range (e.g., 22:00 - 08:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

export default {
  shouldSendNotification,
  shouldSendStaffNotification,
  getPatientPreferences,
  getStaffPreferences,
  updatePreferences,
};
