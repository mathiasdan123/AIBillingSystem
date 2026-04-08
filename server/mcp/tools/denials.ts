import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import { predictDenial } from '../../services/aiDenialPredictor';
import { withAudit } from '../audit';
import type { McpPracticeContext } from '../types';

export function registerDenialTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  const predictDenialRisk = withAudit(
    'predict_denial_risk',
    'claim',
    true,
    async (input: { claimId: number }) => {
      const claim = await storage.getClaim(input.claimId);
      if (!claim) throw new Error(`Claim ${input.claimId} not found`);
      if ((claim as any).practiceId !== context.practiceId) {
        throw new Error('Access denied: claim belongs to a different practice');
      }

      const lineItems = await storage.getClaimLineItems(input.claimId);
      const patient = await storage.getPatient((claim as any).patientId);
      if (!patient) throw new Error('Patient not found for claim');

      // Try to get SOAP note
      let soapNote: any = null;
      try {
        const soapNotes = await storage.getSoapNotes(context.practiceId);
        soapNote =
          soapNotes.find(
            (sn: any) => sn.patientId === (claim as any).patientId,
          ) || null;
      } catch {
        // SOAP note not available
      }

      return predictDenial(
        claim as any,
        lineItems as any[],
        soapNote,
        patient as any,
      );
    },
  );

  server.tool(
    'predict_denial_risk',
    'Predict the denial risk for a claim before submission. Returns a risk score (0-100), risk level, specific issues detected, and actionable recommendations.',
    { claimId: z.number().describe('Claim ID to analyze for denial risk') },
    (input) => predictDenialRisk(input, context),
  );
}
