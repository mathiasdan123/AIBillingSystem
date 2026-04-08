import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import * as stediService from '../../services/stediService';
import { withAudit } from '../audit';
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

      const lineItems = await storage.getClaimLineItems(input.claimId);

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
    },
  );

  server.tool(
    'submit_claim',
    'Submit a claim to the clearinghouse (Stedi 837P). The claim must already exist in the database.',
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
}
