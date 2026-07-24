/**
 * HIPAA audit logging wrapper for MCP tool calls.
 *
 * Every tool invocation is logged to the audit_log table with PHI-redacted
 * input/output summaries.
 *
 * This wrapper is also the PHI gate for the MCP surface: tools declared with
 * containsPhi=true refuse unless the practice has explicitly enabled PHI over
 * MCP (practices.mcp_phi_enabled). PHI flowing through a customer's own
 * Claude (Desktop/claude.ai) is only HIPAA-covered once the Anthropic BAA
 * question is settled for that path, so PHI access is an opt-in flag flip —
 * scheduling/analytics/dashboard tools work regardless. Demo practices bypass
 * the gate: their data is fake, so there is no PHI to protect.
 */

import { logAuditEvent } from '../middleware/auditMiddleware';
import { storage } from '../storage';
import logger from '../services/logger';
import type { McpPracticeContext } from './types';

export const MCP_PHI_DISABLED_MESSAGE =
  'PHI access over MCP is not enabled for this practice. This tool returns protected health ' +
  'information, which is gated until a practice admin enables it (Settings -> MCP Integration -> ' +
  'Connector Security -> Enable PHI access). Non-PHI tools (dashboard, analytics, payer search) ' +
  'remain available.';

/**
 * Whether this practice may receive PHI over the MCP surface.
 *
 * Fail-CLOSED: if the practice record cannot be read, PHI is refused. This is
 * the opposite default from the mutation gate (confirmation.ts), deliberately:
 * a transient DB hiccup degrading PHI tools is acceptable; leaking PHI through
 * an un-checkable gate is not.
 */
async function isPhiAllowed(practiceId: number): Promise<boolean> {
  try {
    const practice: any = await storage.getPractice(practiceId);
    if (!practice) return false;
    return !!practice.mcpPhiEnabled || !!practice.isDemo;
  } catch {
    return false;
  }
}

/**
 * Wraps an MCP tool handler with the PHI gate, audit logging, and error
 * handling. Returns the tool result as a JSON string for the MCP response.
 */
export function withAudit<TInput, TOutput>(
  toolName: string,
  resourceType: string,
  containsPhi: boolean,
  handler: (input: TInput, context: McpPracticeContext) => Promise<TOutput>,
) {
  return async (
    input: TInput,
    context: McpPracticeContext,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    const start = Date.now();
    let success = true;
    let errorMessage: string | undefined;
    let result: TOutput | undefined;

    try {
      if (containsPhi && !(await isPhiAllowed(context.practiceId))) {
        throw new Error(MCP_PHI_DISABLED_MESSAGE);
      }
      result = await handler(input, context);
      return {
        content: [
          {
            type: 'text' as const,
            // P1.1 follow-up: no pretty-print indent. The MCP client (an
            // LLM) never reads this with human eyes; the indent doubled
            // payload size for nothing, contributing to client timeouts
            // on list-returning tools.
            text: JSON.stringify({ success: true, data: result, containsPhi }),
          },
        ],
      };
    } catch (err: any) {
      success = false;
      errorMessage = err.message || 'Unknown error';
      logger.error(`MCP tool ${toolName} failed`, {
        error: errorMessage,
        practiceId: context.practiceId,
        userId: context.userId,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: false, error: errorMessage }),
          },
        ],
      };
    } finally {
      const durationMs = Date.now() - start;
      try {
        await logAuditEvent({
          eventCategory: 'mcp_tool_call',
          eventType: toolName,
          resourceType,
          userId: context.userId,
          practiceId: context.practiceId,
          details: { durationMs, success, error: errorMessage },
          success,
        });
      } catch (auditErr: any) {
        logger.error('Failed to write MCP audit log', {
          error: auditErr.message,
        });
      }
    }
  };
}
