/**
 * TherapyBill AI MCP Server
 *
 * Creates the McpServer instance and registers all tools.
 * Tools are scoped to a single practice via McpPracticeContext.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpPracticeContext } from './types';

// Tool registration imports
import { registerDashboardTools } from './tools/dashboard';
import { registerAnalyticsTools } from './tools/analytics';
import { registerAppointmentTools } from './tools/appointments';
import { registerPatientTools } from './tools/patients';
import { registerClaimTools } from './tools/claims';
import { registerEligibilityTools } from './tools/eligibility';
import { registerInvoiceTools } from './tools/invoices';
import { registerEraTools } from './tools/era';
import { registerAppealTools } from './tools/appeals';
import { registerDenialTools } from './tools/denials';
import { registerBillingTools } from './tools/billing';
import { registerSoapTools } from './tools/soap';

export function createMcpServer(context: McpPracticeContext): McpServer {
  const server = new McpServer(
    { name: 'therapybill-ai', version: '1.0.0' },
    {
      instructions: [
        'TherapyBill AI MCP server for medical billing operations.',
        'All billing-related language uses "accuracy" framing, not "optimization" or "maximization".',
        'AI suggests codes -- therapist must always make the final coding decision.',
        `All operations are scoped to practice ${context.practiceId}.`,
        'Tool responses marked with containsPhi:true include protected health information.',
      ].join(' '),
    },
  );

  // Practice intelligence (no PHI, no external APIs)
  registerDashboardTools(server, context);
  registerAnalyticsTools(server, context);

  // Scheduling (partial PHI)
  registerAppointmentTools(server, context);

  // Patient data (PHI, DB only)
  registerPatientTools(server, context);

  // Claims (PHI, DB + Stedi API)
  registerClaimTools(server, context);

  // Eligibility (PHI, Stedi API)
  registerEligibilityTools(server, context);

  // Payments (PHI, Stripe API)
  registerInvoiceTools(server, context);

  // ERA (PHI, DB)
  registerEraTools(server, context);

  // AI-powered tools (PHI, Anthropic/OpenAI APIs)
  registerAppealTools(server, context);
  registerDenialTools(server, context);
  registerBillingTools(server, context);
  registerSoapTools(server, context);

  return server;
}
