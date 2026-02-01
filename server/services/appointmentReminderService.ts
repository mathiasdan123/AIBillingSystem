/**
 * Appointment Reminder Service
 * Handles scheduling and sending of appointment reminders via email and SMS
 */

import { storage } from '../storage';
import { sendAppointmentReminderSMS, sendAppointmentConfirmationSMS, isSMSConfigured } from './smsService';
import { isEmailConfigured } from '../email';
import nodemailer from 'nodemailer';

// Email configuration
const emailConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
};

const fromAddress = process.env.EMAIL_FROM || 'noreply@therapybill.ai';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport(emailConfig);
  }
  return transporter;
}

interface ReminderResult {
  appointmentId: number;
  patientName: string;
  emailSent: boolean;
  smsSent: boolean;
  error?: string;
}

/**
 * Send appointment reminder email
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

  const formattedDate = data.appointmentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f8fafc;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0 0 10px 0; font-size: 24px;">Appointment Reminder</h1>
      <p style="margin: 0; opacity: 0.9;">${data.practiceName}</p>
    </div>

    <div style="background: white; padding: 30px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
      <p style="font-size: 16px; color: #1e293b;">Hi ${data.patientName},</p>
      <p style="color: #475569;">This is a friendly reminder about your upcoming appointment.</p>

      <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <table style="width: 100%;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; width: 100px;">Date:</td>
            <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${formattedDate}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Time:</td>
            <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${data.appointmentTime}</td>
          </tr>
          ${data.therapistName ? `
          <tr>
            <td style="padding: 8px 0; color: #64748b;">With:</td>
            <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${data.therapistName}</td>
          </tr>
          ` : ''}
          ${data.practiceAddress ? `
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Location:</td>
            <td style="padding: 8px 0; color: #1e293b;">${data.practiceAddress}</td>
          </tr>
          ` : ''}
        </table>
      </div>

      <p style="color: #475569;">Please arrive 10-15 minutes early to complete any necessary paperwork.</p>

      <p style="color: #475569;">Need to reschedule? Please contact us at least 24 hours in advance${data.practicePhone ? ` at <strong>${data.practicePhone}</strong>` : ''}.</p>
    </div>

    <div style="background: #f1f5f9; padding: 20px; border-radius: 0 0 12px 12px; text-align: center; border: 1px solid #e2e8f0; border-top: none;">
      <p style="margin: 0; color: #64748b; font-size: 13px;">
        We look forward to seeing you!<br>
        <strong>${data.practiceName}</strong>
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `
APPOINTMENT REMINDER
====================
${data.practiceName}

Hi ${data.patientName},

This is a reminder about your upcoming appointment.

Date: ${formattedDate}
Time: ${data.appointmentTime}
${data.therapistName ? `With: ${data.therapistName}` : ''}
${data.practiceAddress ? `Location: ${data.practiceAddress}` : ''}

Please arrive 10-15 minutes early to complete any necessary paperwork.

Need to reschedule? Please contact us at least 24 hours in advance${data.practicePhone ? ` at ${data.practicePhone}` : ''}.

We look forward to seeing you!
${data.practiceName}
`;

  try {
    const transport = getTransporter();
    await transport.sendMail({
      from: `"${data.practiceName}" <${fromAddress}>`,
      to,
      subject: `Appointment Reminder - ${formattedDate} at ${data.appointmentTime}`,
      text,
      html,
    });
    return { success: true };
  } catch (error) {
    console.error('Failed to send appointment reminder email:', error);
    return { success: false, error: (error as Error).message };
  }
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
  sendAppointmentReminderEmail,
  getReminderStatus,
};
