/**
 * SMS Service
 * Sends appointment reminders and notifications to patients via Twilio, or
 * via Amazon SNS when SMS_PROVIDER=aws (HIPAA-eligible under the existing
 * AWS BAA, no separate vendor BAA needed - Twilio quoted $1000/mo, declined
 * 2026-10-20). Defaults to Twilio so behavior is unchanged until explicitly
 * opted in (same cutover pattern as AI_PROVIDER/VOICE_PROVIDER/TTS_PROVIDER).
 * Respects patient notification preferences when patientId is provided.
 */

import { shouldSendNotification, type NotificationType } from './notificationPreferencesService';
import * as awsSnsSmsService from './awsSnsSmsService';

interface SMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function useAwsSns(): boolean {
  return (process.env.SMS_PROVIDER || '').toLowerCase() === 'aws';
}

// Check if SMS sending is configured (Twilio credentials, or AWS SNS via the task role)
export function isSMSConfigured(): boolean {
  if (useAwsSns()) {
    return awsSnsSmsService.isSnsSmsAvailable();
  }
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
}

function isTwilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
}

// Lazy load Twilio client
let twilioClient: any = null;

async function getTwilioClient() {
  if (!isTwilioConfigured()) {
    return null;
  }

  if (!twilioClient) {
    const twilio = await import('twilio');
    twilioClient = twilio.default(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }

  return twilioClient;
}

async function sendSMSTwilio(to: string, message: string): Promise<SMSResult> {
  if (!isTwilioConfigured()) {
    console.log(`[SMS Mock] To: ${to}, Message: ${message}`);
    return {
      success: true,
      messageId: 'mock-' + Date.now(),
    };
  }

  try {
    const client = await getTwilioClient();
    if (!client) {
      return { success: false, error: 'Twilio client not available' };
    }

    // Format phone number (ensure E.164 format)
    const formattedPhone = formatPhoneNumber(to);
    if (!formattedPhone) {
      return { success: false, error: 'Invalid phone number format' };
    }

    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedPhone,
    });

    console.log(`SMS sent to ${formattedPhone}: ${result.sid}`);
    return {
      success: true,
      messageId: result.sid,
    };
  } catch (error) {
    console.error('SMS send error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send SMS',
    };
  }
}

/**
 * Send an SMS message, via Amazon SNS when SMS_PROVIDER=aws, else Twilio
 * (or a console-logged mock when neither is configured).
 */
export async function sendSMS(
  to: string,
  message: string
): Promise<SMSResult> {
  if (useAwsSns()) {
    return awsSnsSmsService.sendSMS(to, message);
  }
  return sendSMSTwilio(to, message);
}

/**
 * Format phone number to E.164 format
 */
function formatPhoneNumber(phone: string): string | null {
  if (!phone) return null;

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // Handle US numbers
  if (digits.length === 10) {
    return `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  } else if (digits.startsWith('+')) {
    return phone;
  }

  // Return null for invalid numbers
  return null;
}

/**
 * Send an SMS with notification preference checking.
 * If patientId and notificationType are provided, checks preferences first.
 */
export async function sendSMSWithPreferenceCheck(
  to: string,
  message: string,
  patientId?: number,
  notificationType?: NotificationType,
): Promise<SMSResult> {
  if (patientId && notificationType) {
    const prefResult = await shouldSendNotification(patientId, notificationType);
    if (!prefResult.channels.sms) {
      return { success: true, messageId: 'skipped-by-preference' };
    }
    if (prefResult.inQuietHours) {
      // Note: this skips the send entirely; it is not actually deferred/retried.
      return { success: true, messageId: 'skipped-quiet-hours' };
    }
  }
  return sendSMS(to, message);
}

/**
 * Send appointment reminder SMS
 */
export async function sendAppointmentReminderSMS(
  patientPhone: string,
  patientName: string,
  appointmentDate: Date,
  practiceName: string,
  practicePhone?: string,
  patientId?: number,
): Promise<SMSResult> {
  const formattedDate = appointmentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = appointmentDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const message = `Hi ${patientName}! This is a reminder of your appointment at ${practiceName} on ${formattedDate} at ${formattedTime}. Reply CONFIRM to confirm or call ${practicePhone || 'us'} to reschedule.`;

  return sendSMSWithPreferenceCheck(patientPhone, message, patientId, 'appointmentReminders');
}

/**
 * Send appointment confirmation SMS
 */
export async function sendAppointmentConfirmationSMS(
  patientPhone: string,
  patientName: string,
  appointmentDate: Date,
  practiceName: string
): Promise<SMSResult> {
  const formattedDate = appointmentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = appointmentDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const message = `Your appointment at ${practiceName} is confirmed for ${formattedDate} at ${formattedTime}. We look forward to seeing you, ${patientName}!`;

  return sendSMS(patientPhone, message);
}

/**
 * Send appointment cancellation SMS
 */
export async function sendAppointmentCancellationSMS(
  patientPhone: string,
  patientName: string,
  appointmentDate: Date,
  practiceName: string,
  practicePhone?: string
): Promise<SMSResult> {
  const formattedDate = appointmentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const message = `Hi ${patientName}, your appointment at ${practiceName} on ${formattedDate} has been cancelled. Please call ${practicePhone || 'us'} to reschedule.`;

  return sendSMS(patientPhone, message);
}

export default {
  isSMSConfigured,
  sendSMS,
  sendSMSWithPreferenceCheck,
  sendAppointmentReminderSMS,
  sendAppointmentConfirmationSMS,
  sendAppointmentCancellationSMS,
};
