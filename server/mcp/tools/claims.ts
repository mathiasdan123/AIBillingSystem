import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import * as stediService from '../../services/stediService';
import { withAudit } from '../audit';
import { withMcpMutationGate } from '../confirmation';
import { rejectIfDemoDataMessage } from '../../services/bulkEligibilityService';
import type { McpPracticeContext } from '../types';

export function registerClaimTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  // ── submit_claim ──────────────────────────────────────────────────────
  const submitClaim = withAudit(
    'submit_claim',
    'claim',
    true,
    withMcpMutationGate(async (input: { claimId: number }, ctx: McpPracticeContext) => {
      const claim = await storage.getClaim(input.claimId);
      if (!claim) throw new Error(`Claim ${input.claimId} not found`);
      if ((claim as any).practiceId !== ctx.practiceId) {
        throw new Error('Access denied: claim belongs to a different practice');
      }

      // Idempotency: never re-transmit a claim already sent to the payer. A
      // retried tool call must not file a duplicate 837P.
      const status = String((claim as any).status || '').toLowerCase();
      if (['submitted', 'paid', 'appeal', 'denied'].includes(status)) {
        throw new Error(
          `Claim ${input.claimId} is already '${status}' — it has been submitted and cannot be re-submitted.`,
        );
      }

      const patient = await storage.getPatient((claim as any).patientId);
      if (!patient) throw new Error('Patient not found for claim');

      // Never transmit a real 837P for demo data.
      const demoBlock =
        rejectIfDemoDataMessage(claim as any, 'claim') ||
        rejectIfDemoDataMessage(patient as any, 'patient');
      if (demoBlock) throw new Error(demoBlock);

      const practice = await storage.getPractice(ctx.practiceId);
      if (!practice) throw new Error('Practice not found');

      const lineItems = await storage.getClaimLineItems(input.claimId);
      // Refuse to transmit an empty/malformed claim (no billable service lines).
      if (!lineItems || lineItems.length === 0) {
        throw new Error(
          `Claim ${input.claimId} has no line items — add the billed CPT codes (provider-reviewed) before submitting.`,
        );
      }

      const submission: stediService.ClaimSubmission = {
        claimId: String(claim.id),
        totalAmount: Number((claim as any).totalAmount) || 0,
        placeOfService: (claim as any).placeOfService || '11',
        dateOfService: (claim as any).dateOfService
          ? new Date((claim as any).dateOfService).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
        patient: {
          firstName: (patient as any).firstName || '',
          lastName: (patient as any).lastName || '',
          dateOfBirth: (patient as any).dateOfBirth || '',
          gender: ((patient as any).gender || 'U') as 'M' | 'F' | 'U',
          address: {
            line1: (patient as any).address || '',
            city: (patient as any).city || '',
            state: (patient as any).state || '',
            zip: (patient as any).zipCode || '',
          },
          memberId: (patient as any).insuranceId || '',
        },
        provider: {
          npi: (practice as any).npi || '',
          taxId: (practice as any).taxId || '',
          organizationName: (practice as any).name || '',
          address: {
            line1: (practice as any).address || '',
            city: (practice as any).city || '',
            state: (practice as any).state || '',
            zip: (practice as any).zipCode || '',
          },
        },
        payer: {
          id: (claim as any).payerId || '',
          name: (claim as any).payerName || '',
        },
        serviceLines: lineItems.map((li: any) => ({
          procedureCode: li.cptCode || '',
          modifiers: li.modifiers ? li.modifiers.split(',') : [],
          diagnosisCodes: li.diagnosisCodes
            ? li.diagnosisCodes.split(',')
            : [],
          amount: Number(li.amount) || 0,
          units: Number(li.units) || 1,
          dateOfService: (claim as any).dateOfService
            ? new Date((claim as any).dateOfService).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0],
        })),
        diagnosisCodes: (claim as any).diagnosisCodes
          ? (claim as any).diagnosisCodes.split(',')
          : [],
      };

      return stediService.submitClaim(submission);
    }),
  );

  server.tool(
    'submit_claim',
    'Transmit an existing claim to the clearinghouse as a real 837P (an irreversible external action that files with the payer). The claim must already exist with billed CPT line items that the treating provider has reviewed and approved — the provider makes the final coding decision. Already-submitted claims and demo data are refused.',
    { claimId: z.number().describe('Internal claim ID to submit') },
    (input) => submitClaim(input, context),
  );

  // ── get_claim_status ──────────────────────────────────────────────────
  const getClaimStatus = withAudit(
    'get_claim_status',
    'claim',
    true,
    async (input: { claimId: number }) => {
      const claim = await storage.getClaim(input.claimId);
      if (!claim) throw new Error(`Claim ${input.claimId} not found`);
      if ((claim as any).practiceId !== context.practiceId) {
        throw new Error('Access denied: claim belongs to a different practice');
      }

      const patient = await storage.getPatient((claim as any).patientId);
      if (!patient) throw new Error('Patient not found for claim');

      const practice = await storage.getPractice(context.practiceId);
      if (!practice) throw new Error('Practice not found');

      const request: stediService.ClaimStatusRequest = {
        claimId: String(claim.id),
        payer: { id: (claim as any).payerId || '' },
        provider: {
          npi: (practice as any).npi || '',
          taxId: (practice as any).taxId || '',
        },
        subscriber: {
          memberId: (patient as any).insuranceId || '',
          firstName: (patient as any).firstName || '',
          lastName: (patient as any).lastName || '',
          dateOfBirth: (patient as any).dateOfBirth || '',
        },
        dateOfService: (claim as any).dateOfService
          ? new Date((claim as any).dateOfService).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
        claimAmount: Number((claim as any).totalAmount) || undefined,
      };

      return stediService.checkClaimStatus(request);
    },
  );

  server.tool(
    'get_claim_status',
    'Check the status of a submitted claim via the clearinghouse (Stedi 276/277).',
    { claimId: z.number().describe('Internal claim ID to check status for') },
    (input) => getClaimStatus(input, context),
  );

  // ── get_overdue_claims ────────────────────────────────────────────────
  const getOverdueClaims = withAudit(
    'get_overdue_claims',
    'claim',
    false,
    async (input: { daysThreshold?: number; limit?: number }) => {
      const claims = await storage.getClaims(context.practiceId);
      const threshold = input.daysThreshold ?? 30;
      const limit = input.limit ?? 50;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - threshold);

      const overdue = claims
        .filter((c: any) => {
          if (c.status !== 'submitted') return false;
          const submitted = c.submittedAt ? new Date(c.submittedAt) : null;
          return submitted && submitted < cutoff;
        })
        .slice(0, limit);

      return { total: overdue.length, claims: overdue };
    },
  );

  server.tool(
    'get_overdue_claims',
    'Get claims that have been submitted but not resolved past a threshold number of days.',
    {
      daysThreshold: z
        .number()
        .optional()
        .describe('Days past submission to consider overdue (default 30)'),
      limit: z
        .number()
        .optional()
        .describe('Maximum number of claims to return (default 50)'),
    },
    (input) => getOverdueClaims(input, context),
  );

  // ── add_claim_line_item ───────────────────────────────────────────────
  // Mirrors the in-app dispatcher case + POST /api/claims/:id/line-items.
  // Status guard: only draft claims accept new line items. Total
  // recomputed from all line items after the add so subsequent queries
  // reflect the new amount.
  const addClaimLineItem = withAudit(
    'add_claim_line_item',
    'claim',
    false,
    withMcpMutationGate(
      async (
        input: {
          claimId: number;
          cptCodeId: number;
          units?: number;
          icd10CodeId?: number;
          dateOfService?: string;
          modifier?: string;
          notes?: string;
        },
        ctx: McpPracticeContext,
      ) => {
        const claim = await storage.getClaim(input.claimId);
        if (!claim) throw new Error(`Claim ${input.claimId} not found`);
        if ((claim as any).practiceId !== ctx.practiceId) {
          throw new Error('Access denied: claim belongs to a different practice');
        }
        if ((claim as any).status && (claim as any).status !== 'draft') {
          throw new Error(
            `Cannot add line items to a claim in status "${(claim as any).status}". Only draft claims accept new line items. If this claim was denied and needs correction, draft a corrected claim instead.`,
          );
        }
        const cptCodes = await storage.getCptCodes();
        const cptCode: any = cptCodes.find((c: any) => c.id === input.cptCodeId);
        if (!cptCode) throw new Error(`CPT code id ${input.cptCodeId} not found in catalog`);
        const rate = parseFloat(cptCode.baseRate || '289.00');
        const lineUnits = input.units || 1;
        const amount = (rate * lineUnits).toFixed(2);
        const lineItem = await storage.createClaimLineItem({
          claimId: input.claimId,
          cptCodeId: input.cptCodeId,
          icd10CodeId: input.icd10CodeId || null,
          units: lineUnits,
          rate: rate.toFixed(2),
          amount,
          dateOfService: input.dateOfService || new Date().toISOString().split('T')[0],
          modifier: input.modifier || null,
          notes: input.notes || null,
        } as any);
        const allLineItems = await storage.getClaimLineItems(input.claimId);
        const newTotal = allLineItems.reduce(
          (sum: number, li: any) => sum + parseFloat(li.amount || '0'),
          0,
        );
        await storage.updateClaim(input.claimId, { totalAmount: newTotal.toFixed(2) } as any);
        return {
          lineItem: {
            id: lineItem.id, cptCode: cptCode.code, units: lineUnits, rate: rate.toFixed(2), amount,
          },
          claim: {
            id: input.claimId, newTotalAmount: newTotal.toFixed(2), lineItemCount: allLineItems.length,
          },
        };
      },
    ),
  );

  server.tool(
    'add_claim_line_item',
    'Append a single CPT line item to an existing DRAFT claim. The claim total auto-recalculates after the add. Per-line-item EDIT/DELETE not yet supported via this tool. Use when a therapist wants to add a missed CPT code to a claim before submission.',
    {
      claimId: z.number().describe('The ID of the draft claim to add a line item to'),
      cptCodeId: z.number().describe('The CPT code id (look up by code if you only have the string)'),
      units: z.number().optional().describe('Billing units (default 1)'),
      icd10CodeId: z.number().optional().describe('Optional ICD-10 code id for this line item'),
      dateOfService: z.string().optional().describe('Date of service YYYY-MM-DD (default today)'),
      modifier: z.string().optional().describe('Optional CPT modifier'),
      notes: z.string().optional().describe('Optional free-text notes'),
    },
    (input) => addClaimLineItem(input, context),
  );
}
