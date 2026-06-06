import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import * as stripeService from '../../services/stripeService';
import { withAudit } from '../audit';
import { withMcpMutationGate } from '../confirmation';
import { rejectIfDemoDataMessage } from '../../services/bulkEligibilityService';
import type { McpPracticeContext } from '../types';

export function registerAppointmentTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  const getAppointments = withAudit(
    'get_appointments',
    'appointment',
    true,
    async (input: { startDate?: string; endDate?: string; status?: string }) => {
      // P1.1 perf: filter in SQL, not JS. Default limit caps response size
      // and prevents the "fetch every appointment, then filter" pattern
      // that caused MCP timeouts on busy practices.
      return storage.getAppointmentsFiltered(context.practiceId, {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        status: input.status,
      });
    },
  );

  server.tool(
    'get_appointments',
    'Get appointments for the practice, optionally filtered by date range and status.',
    {
      startDate: z
        .string()
        .optional()
        .describe('Start date filter (YYYY-MM-DD)'),
      endDate: z
        .string()
        .optional()
        .describe('End date filter (YYYY-MM-DD)'),
      status: z
        .string()
        .optional()
        .describe('Filter by status: scheduled, completed, cancelled'),
    },
    (input) => getAppointments(input, context),
  );

  // ── create_appointment_self_pay_invoice ───────────────────────────────
  // P0.4 self-pay path — generate a Stripe payment link for an appointment.
  // Mirrors the in-app dispatcher case + POST /api/appointments/:id/self-pay-invoice.
  // Auto-computes amount from appointment_type.price when not supplied.
  // Capped at $10k. Reuses the existing createPatientPaymentLink primitive.
  const createAppointmentSelfPayInvoice = withAudit(
    'create_appointment_self_pay_invoice',
    'appointment',
    true,
    withMcpMutationGate(
      async (
        input: { appointmentId: number; amount?: number; description?: string },
        ctx: McpPracticeContext,
      ) => {
        if (!stripeService.isStripeConfigured()) {
          throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY to enable self-pay invoicing.');
        }
        const appt: any = await storage.getAppointment(input.appointmentId);
        if (!appt) throw new Error(`Appointment ${input.appointmentId} not found`);
        if (appt.practiceId !== ctx.practiceId) {
          throw new Error('Access denied: appointment belongs to a different practice');
        }
        const patient: any = appt.patientId ? await storage.getPatient(appt.patientId) : null;
        if (!patient) throw new Error('Appointment has no associated patient — cannot generate invoice');
        let amountDollars = typeof input.amount === 'number' ? input.amount : undefined;
        if (typeof amountDollars !== 'number' || !Number.isFinite(amountDollars)) {
          if (appt.appointmentTypeId) {
            const aptType: any = await storage.getAppointmentType(appt.appointmentTypeId);
            const rate = aptType?.price ? parseFloat(aptType.price) : NaN;
            if (Number.isFinite(rate) && rate > 0) amountDollars = rate;
          }
        }
        if (typeof amountDollars !== 'number' || !Number.isFinite(amountDollars) || amountDollars <= 0) {
          throw new Error('Could not determine an invoice amount. Either supply `amount` explicitly, or configure a price on the appointment type.');
        }
        if (amountDollars > 10000) {
          throw new Error('Self-pay invoice amount exceeds the $10,000 cap.');
        }
        const startTimeIso = appt.startTime
          ? new Date(appt.startTime).toISOString().split('T')[0]
          : '';
        const description = input.description
          || `${appt.title || 'Therapy session'}${startTimeIso ? ` — ${startTimeIso}` : ''}`;
        const paymentLink = await stripeService.createPatientPaymentLink({
          amount: Math.round(amountDollars * 100),
          patientName: `${patient.firstName} ${patient.lastName}`,
          practiceId: ctx.practiceId,
          patientId: patient.id,
          description,
        });
        return {
          appointment: {
            id: appt.id,
            patient: `${patient.firstName} ${patient.lastName}`,
            date: startTimeIso,
          },
          invoice: {
            amount: amountDollars.toFixed(2),
            currency: 'USD',
            description,
            paymentLinkUrl: paymentLink.url,
            paymentLinkId: paymentLink.id,
          },
        };
      },
    ),
  );

  server.tool(
    'create_appointment_self_pay_invoice',
    "Generate a self-pay Stripe payment link for a specific appointment — for sessions billed directly to the parent/caregiver instead of through insurance. Auto-computes the amount from the appointment type's price when no amount is supplied. Does NOT create a claim; this is the explicit skip-the-claim path. Returns a Stripe payment link to share with the parent.",
    {
      appointmentId: z.number().describe('The appointment to bill self-pay'),
      amount: z.number().optional().describe('Override amount in dollars. If omitted, computed from appointment_type.price. Max $10,000.'),
      description: z.string().optional().describe('Free-text invoice description. Auto-generated from session details if omitted.'),
    },
    (input) => createAppointmentSelfPayInvoice(input, context),
  );

  // ── P1.5 scheduling backfill ──────────────────────────────────────────
  // Seven actions that previously existed only on the in-app dispatcher
  // (server/routes/ai-assistant.ts) — now mirrored on MCP so therapists
  // can drive their day end-to-end through Blanche. Behavior matches the
  // in-app dispatcher exactly. Mutations are wrapped in
  // withMcpMutationGate so practices that require confirmation see the
  // proposal-confirm card before the change lands.

  // Small helper — every scheduling tool starts the same way: look up the
  // appointment and confirm it belongs to the calling practice.
  async function loadAppointmentForPractice(
    appointmentId: number,
    ctx: McpPracticeContext,
  ): Promise<any> {
    const appt: any = await storage.getAppointment(appointmentId);
    if (!appt) throw new Error(`Appointment ${appointmentId} not found.`);
    if (appt.practiceId !== ctx.practiceId) {
      throw new Error('Appointment not found in this practice.');
    }
    return appt;
  }

  // ── reschedule_appointment ──
  const rescheduleAppointment = withAudit(
    'reschedule_appointment',
    'appointment',
    true,
    withMcpMutationGate(
      async (
        input: { appointmentId: number; date: string; time: string; duration?: number },
        ctx: McpPracticeContext,
      ) => {
        const existing = await loadAppointmentForPractice(input.appointmentId, ctx);
        const existingStart = new Date(existing.startTime as string);
        const existingEnd = new Date(existing.endTime as string);
        const existingDurationMin = Math.max(
          15,
          Math.round((existingEnd.getTime() - existingStart.getTime()) / 60000),
        );
        const duration = input.duration || existingDurationMin;
        const newStart = new Date(`${input.date}T${input.time}:00`);
        if (isNaN(newStart.getTime())) {
          throw new Error('Invalid date/time. Use YYYY-MM-DD and HH:MM (24h).');
        }
        const newEnd = new Date(newStart.getTime() + duration * 60000);
        const updated: any = await storage.updateAppointment(input.appointmentId, {
          startTime: newStart,
          endTime: newEnd,
        } as any);
        return {
          success: true,
          appointment: { id: updated.id, date: input.date, time: input.time, duration },
        };
      },
    ),
  );
  server.tool(
    'reschedule_appointment',
    'Move an existing appointment to a new date and/or time. Preserves duration unless overridden.',
    {
      appointmentId: z.number().describe('The appointment to reschedule'),
      date: z.string().describe('New date in YYYY-MM-DD format'),
      time: z.string().describe('New start time in HH:MM (24h) format'),
      duration: z.number().optional().describe('Optional new duration in minutes; defaults to existing duration'),
    },
    (input) => rescheduleAppointment(input, context),
  );

  // ── cancel_appointment ──
  const cancelAppointment = withAudit(
    'cancel_appointment',
    'appointment',
    true,
    withMcpMutationGate(
      async (
        input: { appointmentId: number; reason: string; notes?: string },
        ctx: McpPracticeContext,
      ) => {
        const existing = await loadAppointmentForPractice(input.appointmentId, ctx);
        if (existing.status === 'cancelled') {
          return { success: true, alreadyCancelled: true, appointment: { id: existing.id, status: existing.status } };
        }
        const cancelled: any = await storage.cancelAppointment(
          input.appointmentId,
          input.reason || 'cancelled via assistant',
          input.notes,
          ctx.userId,
        );
        return { success: true, appointment: { id: cancelled.id, status: cancelled.status } };
      },
    ),
  );
  server.tool(
    'cancel_appointment',
    'Cancel an existing appointment. Marks it as cancelled with a reason; does not delete it.',
    {
      appointmentId: z.number().describe('The appointment to cancel'),
      reason: z.string().describe('Cancellation reason (e.g. "patient request", "provider unavailable")'),
      notes: z.string().optional().describe('Optional free-text notes about the cancellation'),
    },
    (input) => cancelAppointment(input, context),
  );

  // ── check_in_appointment ──
  const checkInAppointment = withAudit(
    'check_in_appointment',
    'appointment',
    true,
    withMcpMutationGate(
      async (input: { appointmentId: number }, ctx: McpPracticeContext) => {
        const existing = await loadAppointmentForPractice(input.appointmentId, ctx);
        if (existing.status === 'cancelled') throw new Error('Cannot check in a cancelled appointment.');
        if (existing.checkedInAt) {
          return { success: true, alreadyCheckedIn: true, appointment: { id: existing.id, status: existing.status } };
        }
        const updated: any = await storage.updateAppointment(input.appointmentId, {
          checkedInAt: new Date(),
          checkedInBy: ctx.userId,
          status: 'checked_in',
        } as any);
        return { success: true, appointment: { id: updated.id, status: updated.status } };
      },
    ),
  );
  server.tool(
    'check_in_appointment',
    'Mark a patient as checked in / arrived for their appointment. Sets the check-in timestamp and moves the appointment to status "checked_in".',
    { appointmentId: z.number().describe('The appointment to check in') },
    (input) => checkInAppointment(input, context),
  );

  // ── session_start ──
  const sessionStart = withAudit(
    'session_start',
    'appointment',
    true,
    withMcpMutationGate(
      async (input: { appointmentId: number }, ctx: McpPracticeContext) => {
        const existing = await loadAppointmentForPractice(input.appointmentId, ctx);
        if (!existing.checkedInAt) {
          throw new Error('Patient must be checked in before starting the session. Call check_in_appointment first.');
        }
        if (existing.sessionStartedAt) {
          return { success: true, alreadyStarted: true, appointment: { id: existing.id, status: existing.status } };
        }
        const updated: any = await storage.updateAppointment(input.appointmentId, {
          sessionStartedAt: new Date(),
          status: 'in_progress',
        } as any);
        return { success: true, appointment: { id: updated.id, status: updated.status } };
      },
    ),
  );
  server.tool(
    'session_start',
    'Mark that the clinical session has started. The patient must already be checked in.',
    { appointmentId: z.number().describe('The appointment whose session is starting') },
    (input) => sessionStart(input, context),
  );

  // ── session_end ──
  const sessionEnd = withAudit(
    'session_end',
    'appointment',
    true,
    withMcpMutationGate(
      async (input: { appointmentId: number }, ctx: McpPracticeContext) => {
        const existing = await loadAppointmentForPractice(input.appointmentId, ctx);
        if (!existing.sessionStartedAt) {
          throw new Error('Session has not been started. Call session_start first.');
        }
        if (existing.sessionEndedAt) {
          return { success: true, alreadyEnded: true, appointment: { id: existing.id, status: existing.status } };
        }
        const updated: any = await storage.updateAppointment(input.appointmentId, {
          sessionEndedAt: new Date(),
        } as any);
        return { success: true, appointment: { id: updated.id, status: updated.status } };
      },
    ),
  );
  server.tool(
    'session_end',
    'Mark that the clinical session has ended. Session must have been started first.',
    { appointmentId: z.number().describe('The appointment whose session is ending') },
    (input) => sessionEnd(input, context),
  );

  // ── check_out_appointment ──
  const checkOutAppointment = withAudit(
    'check_out_appointment',
    'appointment',
    true,
    withMcpMutationGate(
      async (input: { appointmentId: number }, ctx: McpPracticeContext) => {
        const existing = await loadAppointmentForPractice(input.appointmentId, ctx);
        if (!existing.checkedInAt) throw new Error('Patient must be checked in before checking out.');
        if (existing.checkedOutAt) {
          return { success: true, alreadyCheckedOut: true, appointment: { id: existing.id, status: existing.status } };
        }
        const updated: any = await storage.updateAppointment(input.appointmentId, {
          checkedOutAt: new Date(),
          status: 'completed',
        } as any);
        return { success: true, appointment: { id: updated.id, status: updated.status } };
      },
    ),
  );
  server.tool(
    'check_out_appointment',
    'Check a patient out at the end of their visit. Sets check-out timestamp and marks the appointment "completed".',
    { appointmentId: z.number().describe('The appointment to check out') },
    (input) => checkOutAppointment(input, context),
  );

  // ── mark_no_show ──
  const markNoShow = withAudit(
    'mark_no_show',
    'appointment',
    true,
    withMcpMutationGate(
      async (
        input: { appointmentId: number; notes?: string },
        ctx: McpPracticeContext,
      ) => {
        const existing = await loadAppointmentForPractice(input.appointmentId, ctx);
        if (existing.status === 'cancelled') {
          return { success: true, alreadyCancelled: true, appointment: { id: existing.id, status: existing.status } };
        }
        // Routes through the same cancellation path as cancel_appointment
        // so the no-show report (which filters by cancellationReason)
        // picks it up. Matches in-app dispatcher behavior exactly.
        const cancelled: any = await storage.cancelAppointment(
          input.appointmentId,
          'no-show',
          input.notes,
          ctx.userId,
        );
        return { success: true, appointment: { id: cancelled.id, status: cancelled.status } };
      },
    ),
  );
  server.tool(
    'mark_no_show',
    'Mark an appointment as a no-show — the patient did not arrive. Cancels with reason "no-show" so it surfaces in the no-show report and late-cancellation policy logic.',
    {
      appointmentId: z.number().describe('The appointment to mark as no-show'),
      notes: z.string().optional().describe('Optional free-text notes (e.g. "called twice, no answer")'),
    },
    (input) => markNoShow(input, context),
  );

  // ── MCP backfill: create_appointment / suggest_appointment_slot /
  //    send_appointment_reminder ────────────────────────────────────────────
  // These three previously lived only on the in-app Blanche dispatcher
  // (server/routes/ai-assistant.ts). Behavior mirrors the dispatcher exactly.
  // Mutations are wrapped in withMcpMutationGate.

  // ── create_appointment ──
  const createAppointment = withAudit(
    'create_appointment',
    'appointment',
    true,
    withMcpMutationGate(
      async (
        input: { patientId: number; date: string; time: string; duration?: number; type?: string },
        ctx: McpPracticeContext,
      ) => {
        const patient: any = await storage.getPatient(input.patientId);
        if (!patient) throw new Error(`Patient ${input.patientId} not found.`);
        if (patient.practiceId !== ctx.practiceId) {
          throw new Error('Patient not found in this practice.');
        }
        const duration = input.duration || 60;
        const startTime = new Date(`${input.date}T${input.time}:00`);
        if (isNaN(startTime.getTime())) {
          throw new Error('Invalid date/time. Use YYYY-MM-DD and HH:MM (24h).');
        }
        const endTime = new Date(startTime.getTime() + duration * 60000);
        const appt: any = await storage.createAppointment({
          practiceId: ctx.practiceId,
          patientId: input.patientId,
          startTime,
          endTime,
          title: input.type || 'Therapy Session',
          status: 'scheduled',
        } as any);
        return {
          appointment: { id: appt.id, date: input.date, time: input.time, duration },
          message: 'Appointment scheduled successfully.',
        };
      },
    ),
  );
  server.tool(
    'create_appointment',
    'Schedule a new appointment for an existing patient. The patient must already exist in this practice — look them up with search_patients first. Defaults to a 60-minute "Therapy Session".',
    {
      patientId: z.number().describe('The existing patient to schedule (must belong to this practice)'),
      date: z.string().describe('Appointment date in YYYY-MM-DD format'),
      time: z.string().describe('Start time in HH:MM (24h) format'),
      duration: z.number().optional().describe('Duration in minutes; defaults to 60'),
      type: z.string().optional().describe('Appointment title/type; defaults to "Therapy Session"'),
    },
    (input) => createAppointment(input, context),
  );

  // ── suggest_appointment_slot ──
  // Read-only — no mutation gate. Finds OPEN slots (not existing appointments).
  const suggestAppointmentSlot = withAudit(
    'suggest_appointment_slot',
    'appointment',
    false,
    async (
      input: { durationMinutes?: number; daysAhead?: number; startHour?: number; endHour?: number },
      ctx: McpPracticeContext,
    ) => {
      const duration = Math.max(15, input.durationMinutes || 60);
      const daysAhead = Math.min(30, Math.max(1, input.daysAhead || 7));
      const startHour = Math.min(23, Math.max(0, input.startHour ?? 9));
      const endHour = Math.min(23, Math.max(startHour + 1, input.endHour ?? 17));

      const now = new Date();
      const rangeStart = new Date(now);
      const rangeEnd = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
      const existingAppts = await storage.getAppointmentsByDateRange(ctx.practiceId, rangeStart, rangeEnd);

      const busy: Array<{ start: number; end: number }> = existingAppts
        .filter((a: any) => a.status !== 'cancelled')
        .map((a: any) => ({
          start: new Date(a.startTime).getTime(),
          end: new Date(a.endTime).getTime(),
        }));

      const overlaps = (s: number, e: number) => busy.some((b) => s < b.end && e > b.start);

      const suggestions: Array<{ date: string; time: string; iso: string }> = [];
      const slotMs = duration * 60000;

      for (let d = 0; d < daysAhead && suggestions.length < 5; d++) {
        const day = new Date(now);
        day.setDate(day.getDate() + d);
        day.setHours(0, 0, 0, 0);

        for (let hour = startHour; hour <= endHour - Math.ceil(duration / 60) && suggestions.length < 5; hour++) {
          for (const minute of [0, 30]) {
            const slotStart = new Date(day);
            slotStart.setHours(hour, minute, 0, 0);
            if (slotStart.getTime() < now.getTime() + 30 * 60000) continue;
            const slotEnd = new Date(slotStart.getTime() + slotMs);
            if (slotEnd.getHours() > endHour || (slotEnd.getHours() === endHour && slotEnd.getMinutes() > 0)) continue;
            if (overlaps(slotStart.getTime(), slotEnd.getTime())) continue;

            const yyyy = slotStart.getFullYear();
            const mm = String(slotStart.getMonth() + 1).padStart(2, '0');
            const dd = String(slotStart.getDate()).padStart(2, '0');
            const hh = String(slotStart.getHours()).padStart(2, '0');
            const mi = String(slotStart.getMinutes()).padStart(2, '0');
            suggestions.push({
              date: `${yyyy}-${mm}-${dd}`,
              time: `${hh}:${mi}`,
              iso: slotStart.toISOString(),
            });
            if (suggestions.length >= 5) break;
          }
        }
      }

      return {
        durationMinutes: duration,
        searchedDays: daysAhead,
        businessHours: `${startHour}:00 - ${endHour}:00`,
        suggestions,
        message: suggestions.length
          ? `Found ${suggestions.length} open slot(s) over the next ${daysAhead} day(s).`
          : `No open slots found in the next ${daysAhead} day(s) within ${startHour}:00-${endHour}:00.`,
      };
    },
  );
  server.tool(
    'suggest_appointment_slot',
    'Suggest up to 5 OPEN appointment slots over the coming days, avoiding conflicts with existing non-cancelled appointments. Returns available openings — NOT existing appointments (use get_appointments for those).',
    {
      durationMinutes: z.number().optional().describe('Desired slot length in minutes; defaults to 60'),
      daysAhead: z.number().optional().describe('How many days ahead to search (1-30); defaults to 7'),
      startHour: z.number().optional().describe('Earliest hour of the business day (0-23); defaults to 9'),
      endHour: z.number().optional().describe('Latest hour of the business day (0-23); defaults to 17'),
    },
    (input) => suggestAppointmentSlot(input, context),
  );

  // ── send_appointment_reminder ──
  const sendAppointmentReminder = withAudit(
    'send_appointment_reminder',
    'appointment',
    true,
    withMcpMutationGate(
      async (
        input: { appointmentId: number; channel?: string },
        ctx: McpPracticeContext,
      ) => {
        const appointment: any = await storage.getAppointment(input.appointmentId);
        if (!appointment) throw new Error('Appointment not found.');
        if (appointment.practiceId !== ctx.practiceId) {
          throw new Error('Appointment does not belong to your practice.');
        }
        if (!appointment.patientId) throw new Error('Appointment has no patient assigned.');

        // Mirror the in-app dispatcher: never dispatch a real SMS/email for
        // demo/showcase rows. Without this, an MCP call against practice 1's
        // is_demo appointments would fire a real reminder.
        const apptDemoMessage = rejectIfDemoDataMessage(appointment, 'appointment');
        if (apptDemoMessage) throw new Error(apptDemoMessage);

        const patient: any = await storage.getPatient(appointment.patientId);
        if (!patient) throw new Error('Patient not found for this appointment.');

        const patientDemoMessage = rejectIfDemoDataMessage(patient, 'patient');
        if (patientDemoMessage) throw new Error(patientDemoMessage);

        const practice: any = await storage.getPractice(ctx.practiceId);
        const practiceName = practice?.name || 'Your Practice';

        const channel = (input.channel || 'both').toLowerCase();
        const wantEmail = channel === 'email' || channel === 'both';
        const wantSms = channel === 'sms' || channel === 'both';

        // Reuse the same reminder plumbing as the in-app dispatcher.
        const { sendAppointmentReminderSMS, isSMSConfigured } = await import('../../services/smsService');
        const { sendEmail } = await import('../../services/emailService');
        const { appointmentReminder } = await import('../../services/emailTemplates');
        const { isEmailConfigured } = await import('../../email');

        const startTime = new Date(appointment.startTime);
        const appointmentTime = startTime.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });

        let emailSent = false;
        let smsSent = false;
        const errors: string[] = [];

        if (wantEmail && patient.email) {
          if (!isEmailConfigured()) {
            errors.push('Email not configured for this practice.');
          } else {
            const { subject, html, text } = appointmentReminder({
              patientName: patient.firstName,
              appointmentDate: startTime,
              appointmentTime,
              providerName: undefined,
              practiceName,
              practiceAddress: practice?.address || undefined,
              practicePhone: practice?.phone || undefined,
            });
            const emailResult = await sendEmail({ to: patient.email, subject, html, text, fromName: practiceName });
            emailSent = emailResult.success;
            if (!emailResult.success) errors.push(`Email: ${emailResult.error || 'failed'}`);
          }
        }

        if (wantSms && patient.phone) {
          if (!isSMSConfigured()) {
            errors.push('SMS not configured for this practice.');
          } else {
            const smsResult = await sendAppointmentReminderSMS(
              patient.phone,
              patient.firstName,
              startTime,
              practiceName,
              practice?.phone || undefined,
            );
            smsSent = smsResult.success;
            if (!smsResult.success) errors.push(`SMS: ${smsResult.error || 'failed'}`);
          }
        }

        if (!emailSent && !smsSent) {
          throw new Error(
            `Could not send reminder. ${errors.length ? errors.join(' ') : 'Patient has no email or phone on file for the requested channel.'}`,
          );
        }

        try {
          await storage.updateAppointment(input.appointmentId, { reminderSent: true } as any);
        } catch {
          // non-fatal
        }

        return {
          appointmentId: input.appointmentId,
          patient: `${patient.firstName} ${patient.lastName}`,
          emailSent,
          smsSent,
          warnings: errors.length ? errors : undefined,
          message: `Reminder sent for appointment on ${startTime.toLocaleDateString()} at ${appointmentTime} (${[emailSent && 'email', smsSent && 'SMS'].filter(Boolean).join(' + ')}).`,
        };
      },
    ),
  );
  server.tool(
    'send_appointment_reminder',
    'Send an appointment reminder to the patient via email and/or SMS. Reuses the practice\'s reminder templates. Marks the appointment as reminder-sent on success.',
    {
      appointmentId: z.number().describe('The appointment to send a reminder for'),
      channel: z.string().optional().describe('Delivery channel: "email", "sms", or "both" (default)'),
    },
    (input) => sendAppointmentReminder(input, context),
  );
}
