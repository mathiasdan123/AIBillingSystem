/**
 * Appointment Reminder Service
 * Handles scheduling and sending of appointment reminders via email and SMS
 */

import { storage } from '../storage';
import { sendAppointmentReminderSMS, isSMSConfigured } from './smsService';
import { isEmailConfigured } from '../email';
import logger from './logger';
import { sendEmail } from './emailService';
import { appointmentReminder } from './emailTemplates';

interface ReminderResult {
  appointmentId: number;
  patientName: string;
  emailSent: boolean;
  smsSent: boolean;
  error?: string;
}

/**
 * Send appointment reminder email using the centralized email service and templates
 */
async function sendAppointmentReminderEmail(
  to: string,
  data: {
    patientName: string;
    appointmentDate: Date;
    appointmentTime: string;
    practiceName: string;
    practiceAddress?: string;
    practicePhone?: string;
    therapistName?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    return { success: false, error: 'Email not configured' };
  }

  const { subject, html, text } = appointmentReminder({
    patientName: data.patientName,
    appointmentDate: data.appointmentDate,
    appointmentTime: data.appointmentTime,
    providerName: data.therapistName,
    practiceName: data.practiceName,
    practiceAddress: data.practiceAddress,
    practicePhone: data.practicePhone,
  });

  return sendEmail({
    to,
    subject,
    html,
    text,
    fromName: data.practiceName,
  });
}

/**
 * Process appointment reminders for a specific time window
 * @param hoursBeforeAppointment - How many hours before the appointment to send reminder
 */
export async function processAppointmentReminders(
  practiceId: number,
  hoursBeforeAppointment: number = 24
): Promise<ReminderResult[]> {
  const results: ReminderResult[] = [];

  try {
    // Get practice info
    const practice = await storage.getPractice(practiceId);
    if (!practice) {
      console.error('Practice not found:', practiceId);
      return results;
    }

    // Calculate the time window for reminders
    const now = new Date();
    const reminderWindowStart = new Date(now.getTime() + (hoursBeforeAppointment - 1) * 60 * 60 * 1000);
    const reminderWindowEnd = new Date(now.getTime() + hoursBeforeAppointment * 60 * 60 * 1000);

    // Get appointments in the reminder window that haven't been reminded yet
    const appointments = await storage.getAppointmentsForReminder(
      practiceId,
      reminderWindowStart,
      reminderWindowEnd
    );

    console.log(`Found ${appointments.length} appointments needing ${hoursBeforeAppointment}h reminders`);

    for (const appointment of appointments) {
      const result: ReminderResult = {
        appointmentId: appointment.id,
        patientName: '',
        emailSent: false,
        smsSent: false,
      };

      try {
        // Get patient info
        const patient = appointment.patientId
          ? await storage.getPatient(appointment.patientId)
          : null;

        if (!patient) {
          result.error = 'Patient not found';
          results.push(result);
          continue;
        }

        result.patientName = `${patient.firstName} ${patient.lastName}`;

        const appointmentTime = new Date(appointment.startTime).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });

        // Send email reminder if patient has email
        if (patient.email) {
          const emailResult = await sendAppointmentReminderEmail(patient.email, {
            patientName: patient.firstName,
            appointmentDate: new Date(appointment.startTime),
            appointmentTime,
            practiceName: practice.name || 'Your Practice',
            practiceAddress: practice.address || undefined,
            practicePhone: practice.phone || undefined,
          });
          result.emailSent = emailResult.success;
          if (!emailResult.success) {
            console.error(`Email reminder failed for appointment ${appointment.id}:`, emailResult.error);
          }
        }

        // Send SMS reminder if patient has phone
        if (patient.phone) {
          const smsResult = await sendAppointmentReminderSMS(
            patient.phone,
            patient.firstName,
            new Date(appointment.startTime),
            practice.name || 'Your Practice',
            practice.phone || undefined
          );
          result.smsSent = smsResult.success;
          if (!smsResult.success) {
            console.error(`SMS reminder failed for appointment ${appointment.id}:`, smsResult.error);
          }
        }

        // Mark appointment as reminded if at least one notification was sent
        if (result.emailSent || result.smsSent) {
          await storage.updateAppointment(appointment.id, { reminderSent: true });
          console.log(`Reminder sent for appointment ${appointment.id} - Email: ${result.emailSent}, SMS: ${result.smsSent}`);
        }
      } catch (error) {
        result.error = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error processing reminder for appointment ${appointment.id}:`, error);
      }

      results.push(result);
    }
  } catch (error) {
    console.error('Error processing appointment reminders:', error);
  }

  return results;
}

/**
 * Send appointment reminders for all appointments in the next 24 hours
 * that haven't had reminders sent yet. Queries across all practices.
 * If SMS/email fails for one appointment, continues with the others.
 */
export async function sendAppointmentReminders(): Promise<ReminderResult[]> {
  const results: ReminderResult[] = [];

  if (!isEmailConfigured() && !isSMSConfigured()) {
    logger.info('Neither email nor SMS configured, skipping appointment reminders');
    return results;
  }

  try {
    const upcomingAppointments = await storage.getUpcomingAppointmentsForReminders(24);

    logger.info(`Found ${upcomingAppointments.length} appointments needing reminders in the next 24 hours`);

    for (const appointment of upcomingAppointments) {
      const result: ReminderResult = {
        appointmentId: appointment.id,
        patientName: '',
        emailSent: false,
        smsSent: false,
      };

      try {
        const patient = appointment.patientId
          ? await storage.getPatient(appointment.patientId)
          : null;

        if (!patient) {
          result.error = 'Patient not found';
          results.push(result);
          continue;
        }

        result.patientName = `${patient.firstName} ${patient.lastName}`;

        // Look up practice for name and contact info
        const practice = appointment.practiceId
          ? await storage.getPractice(appointment.practiceId)
          : null;
        const practiceName = practice?.name || 'Your Practice';

        const appointmentTime = new Date(appointment.startTime).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });

        // Send SMS reminder if Twilio is configured and patient has phone
        if (isSMSConfigured() && patient.phone) {
          try {
            const smsMessage = `Reminder: You have an appointment with ${practiceName} tomorrow at ${appointmentTime}. Please contact us if you need to reschedule.`;
            const { sendSMS } = await import('./smsService');
            const smsResult = await sendSMS(patient.phone, smsMessage);
            result.smsSent = smsResult.success;
            if (!smsResult.success) {
              logger.error(`SMS reminder failed for appointment ${appointment.id}`, { error: smsResult.error });
            }
          } catch (smsError) {
            logger.error(`SMS reminder error for appointment ${appointment.id}`, {
              error: smsError instanceof Error ? smsError.message : 'Unknown SMS error',
            });
          }
        }

        // Send email reminder if SMTP is configured and patient has email
        if (isEmailConfigured() && patient.email) {
          try {
            const emailResult = await sendAppointmentReminderEmail(patient.email, {
              patientName: patient.firstName,
              appointmentDate: new Date(appointment.startTime),
              appointmentTime,
              practiceName,
              practiceAddress: practice?.address || undefined,
              practicePhone: practice?.phone || undefined,
            });
            result.emailSent = emailResult.success;
            if (!emailResult.success) {
              logger.error(`Email reminder failed for appointment ${appointment.id}`, { error: emailResult.error });
            }
          } catch (emailError) {
            logger.error(`Email reminder error for appointment ${appointment.id}`, {
              error: emailError instanceof Error ? emailError.message : 'Unknown email error',
            });
          }
        }

        // Mark the appointment as reminded if at least one notification was sent
        if (result.emailSent || result.smsSent) {
          await storage.markReminderSent(appointment.id);
          logger.info(`Reminder sent for appointment ${appointment.id}`, {
            patient: result.patientName,
            emailSent: result.emailSent,
            smsSent: result.smsSent,
          });
        }
      } catch (error) {
        result.error = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error processing reminder for appointment ${appointment.id}`, { error: result.error });
      }

      results.push(result);
    }
  } catch (error) {
    logger.error('Error in sendAppointmentReminders', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  return results;
}

/**
 * Get reminder status
 */
export function getReminderStatus() {
  return {
    emailConfigured: isEmailConfigured(),
    smsConfigured: isSMSConfigured(),
  };
}

export default {
  processAppointmentReminders,
  sendAppointmentReminders,
  sendAppointmentReminderEmail,
  getReminderStatus,
};
