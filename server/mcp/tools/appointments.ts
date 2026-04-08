import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import { withAudit } from '../audit';
import type { McpPracticeContext } from '../types';

export function registerAppointmentTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  const getAppointments = withAudit(
    'get_appointments',
    'appointment',
    true,
    async (input: { startDate?: string; endDate?: string; status?: string }) => {
      const appointments = await storage.getAppointments(context.practiceId);

      let filtered = appointments;

      if (input.startDate) {
        const start = new Date(input.startDate);
        filtered = filtered.filter(
          (a: any) => new Date(a.startTime) >= start,
        );
      }
      if (input.endDate) {
        const end = new Date(input.endDate);
        filtered = filtered.filter(
          (a: any) => new Date(a.startTime) <= end,
        );
      }
      if (input.status) {
        filtered = filtered.filter((a: any) => a.status === input.status);
      }

      return filtered;
    },
  );

  server.tool(
    'get_appointments',
    'Get appointments for the practice, optionally filtered by date range and status.',
    {
      startDate: z
        .string()
        .optional()
        .describe('Start date filter (YYYY-MM-DD)'),
      endDate: z
        .string()
        .optional()
        .describe('End date filter (YYYY-MM-DD)'),
      status: z
        .string()
        .optional()
        .describe('Filter by status: scheduled, completed, cancelled'),
    },
    (input) => getAppointments(input, context),
  );
}
