/**
 * Provider-aware AI availability and the production provider check.
 *
 * On AWS Bedrock the server authenticates with the task role and needs no
 * API key, so features that tested for ANTHROPIC_API_KEY instead of asking
 * the provider module silently fell back to templates there. And production
 * must run through Bedrock: an unset AI_PROVIDER defaults to the direct API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../storage', () => ({ storage: {} }));

import { assertProductionAiProvider, isAiConfigured } from '../services/aiProvider';
import { isClaudeAppealAvailable } from '../services/claudeAppealService';
import { isReviewAiAvailable } from '../services/reviewResponseService';

const ENV_KEYS = ['AI_PROVIDER', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('appeal and review AI availability follow the provider, not the API key', () => {
  it('available on Bedrock with no API key', () => {
    process.env.AI_PROVIDER = 'bedrock';
    expect(isAiConfigured()).toBe(true);
    expect(isClaudeAppealAvailable()).toBe(true);
    expect(isReviewAiAvailable()).toBe(true);
  });

  it('available on the direct API with a key', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(isClaudeAppealAvailable()).toBe(true);
    expect(isReviewAiAvailable()).toBe(true);
  });

  it('unavailable with neither provider nor key', () => {
    expect(isAiConfigured()).toBe(false);
    expect(isClaudeAppealAvailable()).toBe(false);
    expect(isReviewAiAvailable()).toBe(false);
  });
});

describe('assertProductionAiProvider', () => {
  it('throws in production unless AI_PROVIDER is exactly "bedrock"', () => {
    expect(() => assertProductionAiProvider({ NODE_ENV: 'production' })).toThrow(/must be exactly "bedrock".*got unset/);
    expect(() => assertProductionAiProvider({ NODE_ENV: 'production', AI_PROVIDER: 'anthropic' })).toThrow(/got "anthropic"/);
    expect(() => assertProductionAiProvider({ NODE_ENV: 'production', AI_PROVIDER: 'Bedrock' })).toThrow(/got "Bedrock"/);
    expect(() => assertProductionAiProvider({ NODE_ENV: 'production', AI_PROVIDER: ' bedrock ' })).toThrow();
    // A direct-API key does not substitute for the provider.
    expect(() => assertProductionAiProvider({ NODE_ENV: 'production', ANTHROPIC_API_KEY: 'sk-ant-test' })).toThrow();
  });

  it('passes in production with AI_PROVIDER=bedrock', () => {
    expect(() => assertProductionAiProvider({ NODE_ENV: 'production', AI_PROVIDER: 'bedrock' })).not.toThrow();
  });

  it('is a no-op outside production', () => {
    expect(() => assertProductionAiProvider({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertProductionAiProvider({ NODE_ENV: 'test', AI_PROVIDER: 'anthropic' })).not.toThrow();
    expect(() => assertProductionAiProvider({})).not.toThrow();
  });
});
