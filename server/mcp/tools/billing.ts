import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import {
  reviewBillingCodeAccuracy,
  getInsuranceBillingRules,
} from '../../services/aiBillingAccuracyReview';
import { withAudit } from '../audit';
import type { McpPracticeContext } from '../types';

export function registerBillingTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  // ── billing_code_accuracy_review ──────────────────────────────────────
  // Public MCP tool name and internal service both use the "accuracy"
  // framing required by CLAUDE.md. See
  // server/services/aiBillingAccuracyReview.ts.
  const billingCodeAccuracyReview = withAudit(
    'billing_code_accuracy_review',
    'claim',
    false,
    async (input: {
      sessionDuration: number;
      subjective?: string;
      objective?: string;
      assessment?: string;
      plan?: string;
      interventions?: string[];
      insuranceName: string;
      insuranceId?: number;
      icd10Code?: string;
      icd10Description?: string;
    }) => {
      const cptCodes = await storage.getAllCptCodes();

      const { rules, preferences } = await getInsuranceBillingRules(
        storage,
        input.insuranceId ?? null,
      );

      const sessionDetails = {
        duration: input.sessionDuration,
        subjective: input.subjective || '',
        objective: input.objective || '',
        assessment: input.assessment || '',
        plan: input.plan || '',
        interventions: input.interventions || [],
      };

      const icd10 = input.icd10Code
        ? { code: input.icd10Code, description: input.icd10Description || '' }
        : undefined;

      return reviewBillingCodeAccuracy(
        sessionDetails as any,
        cptCodes as any[],
        input.insuranceName,
        rules as any[],
        preferences as any,
        icd10,
      );
    },
  );

  server.tool(
    'billing_code_accuracy_review',
    'AI-assisted billing code accuracy review. Suggests CPT codes and units based on session details and insurance rules. IMPORTANT: All coding decisions must be reviewed and approved by the treating provider.',
    {
      sessionDuration: z.number().describe('Session duration in minutes'),
      subjective: z
        .string()
        .optional()
        .describe('SOAP subjective section'),
      objective: z.string().optional().describe('SOAP objective section'),
      assessment: z
        .string()
        .optional()
        .describe('SOAP assessment section'),
      plan: z.string().optional().describe('SOAP plan section'),
      interventions: z
        .array(z.string())
        .optional()
        .describe('List of interventions performed'),
      insuranceName: z.string().describe('Insurance company name'),
      insuranceId: z
        .number()
        .optional()
        .describe('Insurance record ID for payer-specific rules'),
      icd10Code: z
        .string()
        .optional()
        .describe('Primary ICD-10 diagnosis code'),
      icd10Description: z
        .string()
        .optional()
        .describe('ICD-10 code description'),
    },
    (input) => billingCodeAccuracyReview(input, context),
  );

  // ── get_recovery_summary ──────────────────────────────────────────────
  // The "Sheer for practices" advocate voice: lets the assistant answer
  // "how much have you recovered/protected for me?" with REAL numbers from
  // the Recovery Ledger. Read-only; honest framing — appeals recovered +
  // underpayments caught are hard dollars; denials flagged is a COUNT, never
  // dollarized. Optional date window (YYYY-MM-DD).
  const getRecoverySummary = withAudit(
    'get_recovery_summary',
    'claim',
    false,
    async (input: { startDate?: string; endDate?: string }) => {
      const start = input.startDate ? new Date(input.startDate) : undefined;
      const end = input.endDate ? new Date(input.endDate) : undefined;
      const stats = await storage.getRecoveryLedgerStats(
        context.practiceId,
        start && !isNaN(start.getTime()) ? start : undefined,
        end && !isNaN(end.getTime()) ? end : undefined,
      );
      const usd = (n: number) =>
        n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
      return {
        ...stats,
        // A ready-to-speak line so the assistant doesn't have to assemble it.
        headline:
          `Recovered ${usd(stats.valueDelivered)} in hard dollars` +
          ` (${usd(stats.appealsRecovered.totalRecovered)} via ${stats.appealsRecovered.count} won/partial appeal(s)` +
          ` + ${usd(stats.underpaymentsCaught.amount)} in underpayments caught across ${stats.underpaymentsCaught.count} claim(s)).` +
          ` Separately, ${stats.denialsFlagged.count} at-risk claim(s) were flagged before submission (not counted as recovered dollars).`,
      };
    },
  );

  server.tool(
    'get_recovery_summary',
    'Summarize the money the platform has recovered and protected for the practice (the "payer advocate" view): dollars won back via appeals, underpayments caught vs contract, and a count of at-risk claims flagged before submission. Returns hard-dollar totals plus a ready-to-speak headline. Optional startDate/endDate (YYYY-MM-DD) to window the period.',
    {
      startDate: z
        .string()
        .optional()
        .describe('Window start, YYYY-MM-DD (optional)'),
      endDate: z
        .string()
        .optional()
        .describe('Window end, YYYY-MM-DD (optional)'),
    },
    (input) => getRecoverySummary(input, context),
  );
}
