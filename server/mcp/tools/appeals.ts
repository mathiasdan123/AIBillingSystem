import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import { generateClaudeAppeal } from '../../services/claudeAppealService';
import { withAudit } from '../audit';
import type { McpPracticeContext } from '../types';

export function registerAppealTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  const generateAppealLetter = withAudit(
    'generate_appeal_letter',
    'appeal',
    true,
    async (input: {
      claimId: number;
      denialReason: string;
      appealLevel?: string;
      previousAppealOutcome?: string;
    }) => {
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

      // Try to get SOAP note if available
      let soapNote: string | null = null;
      try {
        const soapNotes = await storage.getSoapNotes(context.practiceId);
        const matching = soapNotes.find(
          (sn: any) => sn.patientId === (claim as any).patientId,
        );
        if (matching) {
          soapNote = [
            matching.subjective,
            matching.objective,
            matching.assessment,
            matching.plan,
          ]
            .filter(Boolean)
            .join('\n\n');
        }
      } catch {
        // SOAP note not available — proceed without it
      }

      return generateClaudeAppeal({
        claim: claim as any,
        lineItems: lineItems as any[],
        patient: patient as any,
        practice: practice as any,
        soapNote,
        denialReason: input.denialReason,
        appealLevel: input.appealLevel,
        previousAppealOutcome: input.previousAppealOutcome,
      });
    },
  );

  server.tool(
    'generate_appeal_letter',
    'Generate an AI-powered appeal letter for a denied claim using Claude. Returns the letter text, denial category, success probability, and suggested actions.',
    {
      claimId: z.number().describe('Denied claim ID to generate appeal for'),
      denialReason: z
        .string()
        .describe('Reason for denial from EOB or denial notice'),
      appealLevel: z
        .string()
        .optional()
        .describe('Appeal level: first, second, external'),
      previousAppealOutcome: z
        .string()
        .optional()
        .describe('Outcome of previous appeal if this is a subsequent appeal'),
    },
    (input) => generateAppealLetter(input, context),
  );
}
