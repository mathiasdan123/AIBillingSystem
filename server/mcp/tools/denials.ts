import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import { predictDenial } from '../../services/aiDenialPredictor';
import { assessComplianceRisk } from '../../services/complianceRiskService';
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

  // Pre-submission audit-readiness check (Phase C). Composes the claim
  // scrubber + denial predictor + documentation-vs-billed-code cross-check
  // into one verdict. Advisory — does not submit or modify the claim.
  const checkComplianceRisk = withAudit(
    'check_compliance_risk',
    'claim',
    true,
    async (input: { claimId: number }) => {
      const claim = await storage.getClaim(input.claimId);
      if (!claim) throw new Error(`Claim ${input.claimId} not found`);
      if ((claim as any).practiceId !== context.practiceId) {
        throw new Error('Access denied: claim belongs to a different practice');
      }
      return assessComplianceRisk(input.claimId, context.practiceId);
    },
  );

  server.tool(
    'check_compliance_risk',
    'Assess a claim\'s audit readiness BEFORE submission. Composes structural validation, denial-risk prediction, and a documentation-vs-billed-code check into one audit-readiness score (0-100), level (ready/review/at_risk), and an issue list with suggestions. Advisory only — does not submit or change the claim.',
    { claimId: z.number().describe('Claim ID to assess for compliance/audit risk') },
    (input) => checkComplianceRisk(input, context),
  );
}
