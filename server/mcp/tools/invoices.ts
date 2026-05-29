import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import {
  createPatientPaymentIntent,
  createPatientPaymentLink,
  getStripeInstance,
  isStripeConfigured,
} from '../../services/stripeService';
import { rejectIfDemoDataMessage } from '../../services/bulkEligibilityService';
import { withAudit } from '../audit';
import { withMcpMutationGate } from '../confirmation';
import type { McpPracticeContext } from '../types';

export function registerInvoiceTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  const createInvoice = withAudit(
    'create_invoice',
    'payment',
    true,
    withMcpMutationGate(async (input: {
      patientId: number;
      amount: number;
      description: string;
      claimId?: number;
    }, ctx: McpPracticeContext) => {
      const patient = await storage.getPatient(input.patientId);
      if (!patient) throw new Error(`Patient ${input.patientId} not found`);
      if ((patient as any).practiceId !== ctx.practiceId) {
        throw new Error('Access denied: patient belongs to a different practice');
      }

      const paymentIntent = await createPatientPaymentIntent({
        amount: Math.round(input.amount * 100), // dollars to cents
        patientEmail: (patient as any).email || '',
        patientName: `${(patient as any).firstName || ''} ${(patient as any).lastName || ''}`.trim(),
        practiceId: ctx.practiceId,
        patientId: input.patientId,
        claimId: input.claimId,
        description: input.description,
      });

      return {
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        amount: input.amount,
        currency: paymentIntent.currency,
      };
    }),
  );

  server.tool(
    'create_invoice',
    'Create a patient payment invoice via Stripe. Amount is in dollars.',
    {
      patientId: z.number().describe('Patient to create invoice for'),
      amount: z.number().describe('Invoice amount in dollars'),
      description: z.string().describe('Invoice description'),
      claimId: z.number().optional().describe('Associated claim ID'),
    },
    (input) => createInvoice(input, context),
  );

  // ── send_patient_payment_link ─────────────────────────────────────────
  // P1.6 backfill — mirrors the in-app dispatcher (server/routes/ai-assistant.ts).
  // Generates a Stripe-hosted payment link for a patient, either resolving the
  // amount from an existing payment intent (invoiceId) or from an explicit
  // dollar amount. Same demo-data guard, same tenant scoping, same metadata
  // validation when reusing an existing payment intent.
  const sendPatientPaymentLink = withAudit(
    'send_patient_payment_link',
    'payment',
    true,
    withMcpMutationGate(
      async (
        input: {
          patientId: number;
          invoiceId?: string;
          amount?: number;
          message?: string;
        },
        ctx: McpPracticeContext,
      ) => {
        if (!isStripeConfigured()) {
          throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY to enable patient payment links.');
        }

        const { patientId, invoiceId, amount, message } = input;
        if (!patientId) throw new Error('patientId is required.');
        if (!invoiceId && (typeof amount !== 'number' || amount <= 0)) {
          throw new Error('Either invoiceId or a positive amount (in dollars) is required.');
        }

        const patient: any = await storage.getPatient(patientId);
        if (!patient) throw new Error('Patient not found.');
        if (patient.practiceId !== ctx.practiceId) {
          throw new Error('Access denied: patient belongs to a different practice.');
        }
        const demoMessage = rejectIfDemoDataMessage(patient, 'patient');
        if (demoMessage) throw new Error(demoMessage);

        // Resolve charge amount: from invoice (Stripe payment intent) if invoiceId
        // provided, else use amount.
        let chargeAmountCents: number;
        let resolvedDescription: string;

        if (invoiceId) {
          try {
            const stripe = getStripeInstance();
            const intent = await stripe.paymentIntents.retrieve(invoiceId);
            // Require metadata to be present AND match. An intent without our
            // metadata didn't originate from this app and must not be reused.
            if (intent.metadata?.practiceId !== String(ctx.practiceId)) {
              throw new Error('Invoice not found for this practice.');
            }
            if (intent.metadata?.patientId !== String(patientId)) {
              throw new Error('Invoice is for a different patient.');
            }
            chargeAmountCents = intent.amount;
            resolvedDescription = message || intent.description || `Payment for ${patient.firstName} ${patient.lastName}`;
          } catch (err) {
            if (err instanceof Error && (
              err.message === 'Invoice not found for this practice.' ||
              err.message === 'Invoice is for a different patient.'
            )) throw err;
            throw new Error(`Could not retrieve invoice ${invoiceId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        } else {
          chargeAmountCents = Math.round((amount as number) * 100);
          resolvedDescription = message || `Payment for ${patient.firstName} ${patient.lastName}`;
        }

        const paymentLink = await createPatientPaymentLink({
          amount: chargeAmountCents,
          patientName: `${patient.firstName || ''} ${patient.lastName || ''}`.trim(),
          practiceId: ctx.practiceId,
          patientId,
          description: resolvedDescription,
        });

        return {
          success: true,
          paymentLink: {
            url: paymentLink.url,
            id: paymentLink.id,
            amount: chargeAmountCents / 100,
            patientName: `${patient.firstName} ${patient.lastName}`,
            patientId,
            invoiceId: invoiceId || null,
          },
          message: `Payment link created for ${patient.firstName} ${patient.lastName} ($${(chargeAmountCents / 100).toFixed(2)}). Share this URL with the patient: ${paymentLink.url}`,
        };
      },
    ),
  );

  server.tool(
    'send_patient_payment_link',
    'Send a Stripe payment link to a patient for a specific invoice or arbitrary amount. Provide either invoiceId (to charge an existing invoice amount) or amount (in dollars). Returns the Stripe-hosted payment URL the patient can use to pay. Contains PHI.',
    {
      patientId: z.number().describe('Patient ID'),
      invoiceId: z.string().optional().describe('Existing invoice / payment intent ID to charge for (alternative to amount)'),
      amount: z.number().optional().describe('Amount to charge in dollars (alternative to invoiceId)'),
      message: z.string().optional().describe('Optional message / description shown on the payment page'),
    },
    (input) => sendPatientPaymentLink(input, context),
  );
}
