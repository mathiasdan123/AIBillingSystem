import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import { withAudit } from '../audit';
import type { McpPracticeContext } from '../types';

export function registerDashboardTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  const getDashboardStats = withAudit(
    'get_dashboard_stats',
    'analytics',
    false,
    async () => {
      return storage.getDashboardStats(context.practiceId);
    },
  );

  server.tool(
    'get_dashboard_stats',
    'Get practice dashboard KPIs: total claims, success rate, revenue, denial rate, pending claims, average days to payment.',
    {},
    () => getDashboardStats({}, context),
  );
}
