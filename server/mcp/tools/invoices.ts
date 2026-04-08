import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import { createPatientPaymentIntent } from '../../services/stripeService';
import { withAudit } from '../audit';
import type { McpPracticeContext } from '../types';

export function registerInvoiceTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  const createInvoice = withAudit(
    'create_invoice',
    'payment',
    true,
    async (input: {
      patientId: number;
      amount: number;
      description: string;
      claimId?: number;
    }) => {
      const patient = await storage.getPatient(input.patientId);
      if (!patient) throw new Error(`Patient ${input.patientId} not found`);
      if ((patient as any).practiceId !== context.practiceId) {
        throw new Error('Access denied: patient belongs to a different practice');
      }

      const paymentIntent = await createPatientPaymentIntent({
        amount: Math.round(input.amount * 100), // dollars to cents
        patientEmail: (patient as any).email || '',
        patientName: `${(patient as any).firstName || ''} ${(patient as any).lastName || ''}`.trim(),
        practiceId: context.practiceId,
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
    },
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
}
