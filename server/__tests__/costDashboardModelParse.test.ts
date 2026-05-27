import { describe, it, expect } from 'vitest';
import { extractModelFromDescription } from '../services/anthropicModelDescriptionParser';

describe('extractModelFromDescription', () => {
  it('parses dash-separated modern model ids', () => {
    expect(extractModelFromDescription('claude-sonnet-4-5 input tokens')).toBe('claude-sonnet-4-5');
    expect(extractModelFromDescription('claude-opus-4-7 output')).toBe('claude-opus-4-7');
    expect(extractModelFromDescription('claude-haiku-4-5 cache creation')).toBe('claude-haiku-4-5');
  });

  it('strips date suffixes so dated and undated ids roll up together', () => {
    expect(extractModelFromDescription('claude-3-5-haiku-20241022 output')).toBe('claude-3-5-haiku');
  });

  it('parses the prose form Anthropic sometimes returns', () => {
    expect(extractModelFromDescription('Claude Sonnet 4.5 Cache read')).toBe('claude-sonnet-4-5');
    expect(extractModelFromDescription('Claude Haiku 3.5 input')).toBe('claude-haiku-3-5');
  });

  it('returns null for unparseable strings so the caller can fall back to "other"', () => {
    expect(extractModelFromDescription('Server tool use: web_search')).toBeNull();
    expect(extractModelFromDescription('')).toBeNull();
    expect(extractModelFromDescription(undefined)).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(extractModelFromDescription('CLAUDE-SONNET-4-5 INPUT')).toBe('claude-sonnet-4-5');
  });
});
