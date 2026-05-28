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
}
