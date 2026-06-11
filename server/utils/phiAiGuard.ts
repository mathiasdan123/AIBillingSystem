/**
 * Operational kill-switch for routing PHI to an external LLM provider.
 *
 * Set PHI_AI_ENABLED=false to hard-fail every PHI→AI call (SOAP generation,
 * appeal letters, denial prediction, etc.). Use this if BAA coverage for the AI
 * provider is unconfirmed or has lapsed (see the documented Anthropic BAA/MCP
 * gap). Defaults to ENABLED so current behavior is unchanged until explicitly
 * turned off.
 */
export function assertPhiAiAllowed(context = 'AI PHI processing'): void {
  if (process.env.PHI_AI_ENABLED === 'false') {
    throw new Error(
      `${context} is disabled (PHI_AI_ENABLED=false). Enable only once BAA coverage for the AI provider is confirmed for this org.`,
    );
  }
}
