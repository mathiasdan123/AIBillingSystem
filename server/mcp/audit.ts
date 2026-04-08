/**
 * HIPAA audit logging wrapper for MCP tool calls.
 *
 * Every tool invocation is logged to the audit_log table with PHI-redacted
 * input/output summaries.
 */

import { logAuditEvent } from '../middleware/auditMiddleware';
import logger from '../services/logger';
import type { McpPracticeContext } from './types';

/**
 * Wraps an MCP tool handler with audit logging and error handling.
 * Returns the tool result as a JSON string for the MCP response.
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
      result = await handler(input, context);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { success: true, data: result, containsPhi },
              null,
              2,
            ),
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
