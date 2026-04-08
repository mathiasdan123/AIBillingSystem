import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import { withAudit } from '../audit';
import type { McpPracticeContext } from '../types';

export function registerAnalyticsTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  // ── get_ar_aging ──────────────────────────────────────────────────────
  const getArAging = withAudit('get_ar_aging', 'analytics', false, async () => {
    return storage.getDaysInAR(context.practiceId);
  });

  server.tool(
    'get_ar_aging',
    'Get accounts receivable aging report: average days in AR, breakdown by aging bucket (0-30, 31-60, 61-90, 91-120, 120+), and by insurance.',
    {},
    () => getArAging({}, context),
  );

  // ── get_collection_rate ───────────────────────────────────────────────
  const getCollectionRate = withAudit(
    'get_collection_rate',
    'analytics',
    false,
    async () => {
      return storage.getCollectionRate(context.practiceId);
    },
  );

  server.tool(
    'get_collection_rate',
    'Get collection rate metrics: total billed, total collected, collection rate percentage, and breakdown by insurance.',
    {},
    () => getCollectionRate({}, context),
  );

  // ── get_revenue_by_month ──────────────────────────────────────────────
  const getRevenueByMonth = withAudit(
    'get_revenue_by_month',
    'analytics',
    false,
    async (input: { startDate: string; endDate: string }) => {
      return storage.getRevenueByMonth(
        context.practiceId,
        new Date(input.startDate),
        new Date(input.endDate),
      );
    },
  );

  server.tool(
    'get_revenue_by_month',
    'Get monthly revenue and claim counts for a date range.',
    {
      startDate: z.string().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().describe('End date (YYYY-MM-DD)'),
    },
    (input) => getRevenueByMonth(input, context),
  );
}
