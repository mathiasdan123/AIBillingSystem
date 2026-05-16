/**
 * MCP mutation gate (Phase 4).
 *
 * Default behavior: MCP mutations execute as they always have — Claude Desktop's
 * own "Allow tool call?" prompt is the user's consent checkpoint.
 *
 * When a practice flips `practices.mcp_requires_confirmation = true`, MCP
 * mutations are refused at the server with a clear message directing the user
 * to the web chat (where they get a proper Confirm/Cancel proposal card) or to
 * the admin who can disable the flag.
 *
 * MCP has no native UI for a second confirmation step — building one would
 * require turning every mutation into a two-roundtrip dance through Claude
 * Desktop, which is bad UX. Refusing-with-a-message is honest and safe.
 */

import { storage } from '../storage';
import type { McpPracticeContext } from './types';

const MCP_CONFIRMATION_BLOCK_MESSAGE =
  'This practice requires server-side confirmation for AI mutation actions via MCP. ' +
  'To perform this action, please use the TherapyBill web chat (where you can confirm in the chat panel), ' +
  'or ask an admin to disable mcp_requires_confirmation in Settings.';

async function isMcpConfirmationRequired(practiceId: number): Promise<boolean> {
  try {
    const practice = await storage.getPractice(practiceId);
    return !!(practice as any)?.mcpRequiresConfirmation;
  } catch {
    // Fail-closed: if we can't read the practice setting, default to ALLOW
    // (same as today). The alternative — failing-closed-to-DENY — would break
    // every MCP mutation if the practices table briefly hiccups. Allow is the
    // historical behavior and the explicit default for this feature.
    return false;
  }
}

/**
 * Wraps an MCP mutation handler with the confirmation gate. Use this for any
 * tool that mutates state (create/update/delete/send/submit). Reads should
 * not be wrapped — they're always allowed.
 *
 * Composition order with withAudit: put this INSIDE withAudit, so a refused
 * mutation is still logged as a failed call for compliance traceability:
 *
 *   const handler = withAudit('create_invoice', 'payment', true,
 *     withMcpMutationGate(async (input, context) => { ... })
 *   );
 */
export function withMcpMutationGate<TInput, TOutput>(
  handler: (input: TInput, context: McpPracticeContext) => Promise<TOutput>,
): (input: TInput, context: McpPracticeContext) => Promise<TOutput> {
  return async (input, context) => {
    if (await isMcpConfirmationRequired(context.practiceId)) {
      throw new Error(MCP_CONFIRMATION_BLOCK_MESSAGE);
    }
    return handler(input, context);
  };
}
