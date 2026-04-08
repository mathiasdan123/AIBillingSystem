import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import * as stediService from '../../services/stediService';
import { withAudit } from '../audit';
import type { McpPracticeContext } from '../types';

export function registerEligibilityTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  const checkEligibility = withAudit(
    'check_eligibility',
    'insurance',
    true,
    async (input: {
      patientId: number;
      payerId?: string;
      serviceTypeCodes?: string[];
      dateOfService?: string;
    }) => {
      const patient = await storage.getPatient(input.patientId);
      if (!patient) throw new Error(`Patient ${input.patientId} not found`);
      if ((patient as any).practiceId !== context.practiceId) {
        throw new Error('Access denied: patient belongs to a different practice');
      }

      const practice = await storage.getPractice(context.practiceId);
      if (!practice) throw new Error('Practice not found');

      const request: stediService.EligibilityRequest = {
        subscriber: {
          memberId: (patient as any).insuranceId || (patient as any).memberId || '',
          firstName: (patient as any).firstName || '',
          lastName: (patient as any).lastName || '',
          dateOfBirth: (patient as any).dateOfBirth || '',
        },
        provider: {
          npi: (practice as any).npi || '',
          organizationName: (practice as any).name || '',
        },
        payer: {
          id: input.payerId || (patient as any).payerId || '',
        },
        serviceTypeCodes: input.serviceTypeCodes || ['30'],
        dateOfService:
          input.dateOfService || new Date().toISOString().split('T')[0],
      };

      return stediService.checkEligibility(request);
    },
  );

  server.tool(
    'check_eligibility',
    'Check insurance eligibility for a patient via the clearinghouse (Stedi 270/271). Returns coverage status, copays, deductibles, and out-of-pocket maximums.',
    {
      patientId: z.number().describe('Patient ID to check eligibility for'),
      payerId: z
        .string()
        .optional()
        .describe("Payer ID override (defaults to patient's insurance payer)"),
      serviceTypeCodes: z
        .array(z.string())
        .optional()
        .describe("Service type codes (default: ['30'] for health benefit coverage)"),
      dateOfService: z
        .string()
        .optional()
        .describe('Date of service (YYYY-MM-DD, defaults to today)'),
    },
    (input) => checkEligibility(input, context),
  );
}
