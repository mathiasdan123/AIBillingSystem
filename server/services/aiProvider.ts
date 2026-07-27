/**
 * Central AI provider factory — Anthropic API vs AWS Bedrock.
 *
 * WHY: PHI flows through the server-side Claude calls (Blanche, SOAP drafts,
 * appeals). The direct Anthropic API is not yet covered by a BAA, but Claude
 * on Amazon Bedrock is HIPAA-eligible under the AWS BAA this practice already
 * has. Setting AI_PROVIDER=bedrock routes every call built through this
 * factory over Bedrock using the ECS task role's AWS credentials — no API key.
 *
 * Default is the direct Anthropic API ('anthropic') so dev environments and
 * tests behave exactly as before; production opts into Bedrock via env.
 *
 * The Bedrock (Mantle) endpoint serves the same Messages API surface —
 * streaming, prompt caching (cache_control), and tool use all work — but
 * model IDs carry an `anthropic.` prefix. The wrapper below rewrites the
 * model ID on each request so call sites keep using first-party IDs.
 *
 * NOT routed through here: the Anthropic Admin API (cost dashboard) — it is
 * first-party-only and carries no PHI.
 */

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';

export function useBedrock(): boolean {
  return (process.env.AI_PROVIDER || '').toLowerCase() === 'bedrock';
}

/**
 * Whether server-side AI is available at all. On Bedrock, no API key is
 * needed (auth = AWS credential chain); on the direct API, the key must be
 * set. Services should gate on this instead of checking ANTHROPIC_API_KEY.
 */
export function isAiConfigured(): boolean {
  return useBedrock() || !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
}

/**
 * First-party model ID → Bedrock cross-region inference-profile ID
 * (us.anthropic.*), which is what bedrock-runtime requires for
 * current-generation Claude models. Verified live against this account.
 * (The newer Mantle endpoint 403s for this account as of 2026-07-27 —
 * the classic bedrock-runtime path below works and is HIPAA-eligible.)
 */
const BEDROCK_MODEL_MAP: Record<string, string> = {
  'claude-haiku-4-5': 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-haiku-4-5-20251001': 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-sonnet-4-5': 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  'claude-sonnet-4-5-20250929': 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  'claude-opus-4-7': 'us.anthropic.claude-opus-4-7',
  'claude-sonnet-5': 'us.anthropic.claude-sonnet-5',
};

export function toBedrockModel(model: string): string {
  if (model.startsWith('anthropic.') || model.startsWith('us.anthropic.')) return model;
  return BEDROCK_MODEL_MAP[model] ?? `us.anthropic.${model}`;
}

function wrapWithModelMapping<T extends { messages: any }>(client: T): T {
  const messages = client.messages;
  const originalCreate = messages.create.bind(messages);
  const originalStream = messages.stream?.bind(messages);
  const originalCountTokens = messages.countTokens?.bind(messages);

  messages.create = (params: any, ...rest: any[]) =>
    originalCreate({ ...params, model: toBedrockModel(params.model) }, ...rest);
  if (originalStream) {
    messages.stream = (params: any, ...rest: any[]) =>
      originalStream({ ...params, model: toBedrockModel(params.model) }, ...rest);
  }
  if (originalCountTokens) {
    messages.countTokens = (params: any, ...rest: any[]) =>
      originalCountTokens({ ...params, model: toBedrockModel(params.model) }, ...rest);
  }
  return client;
}

/**
 * Construct the AI client for server-side Claude calls. Call sites keep the
 * `Anthropic` type — the Bedrock client exposes the same messages surface.
 */
export function createAiClient(opts: { apiKey?: string } = {}): Anthropic {
  if (useBedrock()) {
    const bedrock = new AnthropicBedrock({
      awsRegion: process.env.AWS_REGION || 'us-east-1',
    });
    return wrapWithModelMapping(bedrock) as unknown as Anthropic;
  }
  return new Anthropic({
    apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY,
  });
}
