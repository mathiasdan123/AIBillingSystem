import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import * as stripeService from '../../services/stripeService';
import { withAudit } from '../audit';
import { withMcpMutationGate } from '../confirmation';
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
}
