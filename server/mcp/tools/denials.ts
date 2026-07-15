import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import { predictDenial } from '../../services/aiDenialPredictor';
import { reviewDeniedClaims, suggestClaimCorrection } from '../../services/denialReviewService';
import { reviewUnderpayments, draftUnderpaymentDispute } from '../../services/underpaymentReviewService';
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

  // ── MCP backfill: review_denied_claims / suggest_claim_correction /
  //    review_underpayments / draft_underpayment_dispute ──────────────────────
  // These previously lived only on the in-app Blanche dispatcher. The business
  // logic is shared via server/services/denialReviewService.ts and
  // server/services/underpaymentReviewService.ts so both surfaces stay in
  // lockstep. All four are reads/analysis (no state mutation), so no
  // mutation gate is applied. They surface PHI → containsPhi:true.
  // Compliance: these tools only *suggest* corrections; the treating provider
  // makes the final coding decision.

  const reviewDeniedClaimsTool = withAudit(
    'review_denied_claims',
    'claim',
    true,
    async (_input: Record<string, never>, ctx: McpPracticeContext) =>
      reviewDeniedClaims(ctx.practiceId),
  );
  server.tool(
    'review_denied_claims',
    'List this practice\'s denied claims (up to 20) with a suggested next action for each based on the denial reason. Use this to triage denials before drafting appeals or corrections.',
    {},
    (input) => reviewDeniedClaimsTool(input, context),
  );

  const suggestClaimCorrectionTool = withAudit(
    'suggest_claim_correction',
    'claim',
    true,
    async (input: { claimId: number }, ctx: McpPracticeContext) =>
      suggestClaimCorrection(ctx.practiceId, input.claimId),
  );
  server.tool(
    'suggest_claim_correction',
    'Analyze a denied claim\'s denial reason and suggest concrete, prioritized corrections (e.g. prior-auth, coding/modifier fixes, timely-filing evidence). These are suggestions only — the treating provider makes the final coding decision.',
    { claimId: z.number().describe('The denied claim to analyze') },
    (input) => suggestClaimCorrectionTool(input, context),
  );

  const reviewUnderpaymentsTool = withAudit(
    'review_underpayments',
    'claim',
    true,
    async (input: { daysBack?: number }, ctx: McpPracticeContext) =>
      reviewUnderpayments(ctx.practiceId, input.daysBack ?? 90),
  );
  server.tool(
    'review_underpayments',
    'Review matched ERA/835 remittance line items and flag underpayments — claims paid below the contracted/expected reimbursement. Returns each underpayment with adjustment-code analysis and whether it appears worth disputing.',
    { daysBack: z.number().optional().describe('How far back to look for remittances, in days; defaults to 90') },
    (input) => reviewUnderpaymentsTool(input, context),
  );

  const draftUnderpaymentDisputeTool = withAudit(
    'draft_underpayment_dispute',
    'claim',
    true,
    async (input: { claimId: number }, ctx: McpPracticeContext) =>
      draftUnderpaymentDispute(ctx.practiceId, input.claimId),
  );
  server.tool(
    'draft_underpayment_dispute',
    'Draft a provider dispute letter for an underpaid claim, using its matched ERA/835 remittance data and the practice fee schedule. Returns the letter text plus an adjustment-code analysis. Review and customize before sending to the payer.',
    { claimId: z.number().describe('The underpaid claim to draft a dispute for (must have matched ERA data)') },
    (input) => draftUnderpaymentDisputeTool(input, context),
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
