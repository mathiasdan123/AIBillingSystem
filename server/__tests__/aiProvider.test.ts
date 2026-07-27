import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { toBedrockModel, useBedrock, isAiConfigured } from '../services/aiProvider';

/**
 * The AI provider factory routes server-side Claude calls to AWS Bedrock
 * (HIPAA-eligible under the existing AWS BAA) when AI_PROVIDER=bedrock.
 * These tests lock in the model-ID mapping (verified live against bedrock-runtime:
 * current-gen Claude requires us.anthropic.* inference-profile IDs) and the
 * configuration gating.
 */

const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ['AI_PROVIDER', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('toBedrockModel', () => {
  it('maps first-party IDs to us. inference profiles', () => {
    expect(toBedrockModel('claude-sonnet-4-5')).toBe('us.anthropic.claude-sonnet-4-5-20250929-v1:0');
    expect(toBedrockModel('claude-opus-4-7')).toBe('us.anthropic.claude-opus-4-7');
    expect(toBedrockModel('claude-haiku-4-5-20251001')).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
  });

  it('passes through already-prefixed IDs', () => {
    expect(toBedrockModel('us.anthropic.claude-sonnet-5')).toBe('us.anthropic.claude-sonnet-5');
    expect(toBedrockModel('anthropic.claude-opus-4-7')).toBe('anthropic.claude-opus-4-7');
  });
});

describe('provider gating', () => {
  it('defaults to the direct Anthropic API', () => {
    expect(useBedrock()).toBe(false);
  });

  it('is unconfigured with no key and no bedrock', () => {
    expect(isAiConfigured()).toBe(false);
  });

  it('is configured with an API key', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    expect(isAiConfigured()).toBe(true);
  });

  it('is configured on bedrock without any API key', () => {
    process.env.AI_PROVIDER = 'bedrock';
    expect(useBedrock()).toBe(true);
    expect(isAiConfigured()).toBe(true);
  });
});
