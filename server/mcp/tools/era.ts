import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import { withAudit } from '../audit';
import type { McpPracticeContext } from '../types';

export function registerEraTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  const getEraSummary = withAudit(
    'get_era_summary',
    'payment',
    true,
    async (input: { claimId?: number; startDate?: string; endDate?: string }) => {
      // Get payments (ERA/835 data)
      const payments = await storage.getPayments(context.practiceId);

      let filtered = payments as any[];

      if (input.claimId) {
        filtered = filtered.filter((p: any) => p.claimId === input.claimId);
      }
      if (input.startDate) {
        const start = new Date(input.startDate);
        filtered = filtered.filter(
          (p: any) => new Date(p.paymentDate || p.createdAt) >= start,
        );
      }
      if (input.endDate) {
        const end = new Date(input.endDate);
        filtered = filtered.filter(
          (p: any) => new Date(p.paymentDate || p.createdAt) <= end,
        );
      }

      const totalPaid = filtered.reduce(
        (sum: number, p: any) => sum + (Number(p.paidAmount) || 0),
        0,
      );
      const totalAdjusted = filtered.reduce(
        (sum: number, p: any) => sum + (Number(p.adjustmentAmount) || 0),
        0,
      );

      return {
        totalPayments: filtered.length,
        totalPaid,
        totalAdjusted,
        payments: filtered.slice(0, 100),
      };
    },
  );

  server.tool(
    'get_era_summary',
    'Get ERA (Electronic Remittance Advice) summary — payment postings from insurers. Filter by claim or date range.',
    {
      claimId: z.number().optional().describe('Filter by specific claim ID'),
      startDate: z
        .string()
        .optional()
        .describe('Start date filter (YYYY-MM-DD)'),
      endDate: z
        .string()
        .optional()
        .describe('End date filter (YYYY-MM-DD)'),
    },
    (input) => getEraSummary(input, context),
  );
}
