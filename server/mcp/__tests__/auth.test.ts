import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db module before importing auth
vi.mock('../../db', () => ({
  dbReady: Promise.resolve(),
}));

import { authenticate } from '../auth';

describe('MCP auth', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.MCP_API_KEY = 'test-key-123';
    process.env.MCP_PRACTICE_ID = '1';
    process.env.MCP_USER_ID = 'user-1';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns context when all env vars are set', async () => {
    const ctx = await authenticate();
    expect(ctx.practiceId).toBe(1);
    expect(ctx.userId).toBe('user-1');
    expect(ctx.role).toBe('admin');
    expect(ctx.apiKey).toBe('test-key-123');
  });

  it('throws when MCP_API_KEY is missing', async () => {
    delete process.env.MCP_API_KEY;
    await expect(authenticate()).rejects.toThrow('MCP_API_KEY');
  });

  it('throws when MCP_PRACTICE_ID is missing', async () => {
    delete process.env.MCP_PRACTICE_ID;
    await expect(authenticate()).rejects.toThrow('MCP_PRACTICE_ID');
  });

  it('throws when MCP_USER_ID is missing', async () => {
    delete process.env.MCP_USER_ID;
    await expect(authenticate()).rejects.toThrow('MCP_USER_ID');
  });

  it('throws when MCP_PRACTICE_ID is not a valid number', async () => {
    process.env.MCP_PRACTICE_ID = 'abc';
    await expect(authenticate()).rejects.toThrow('positive integer');
  });

  it('throws when MCP_PRACTICE_ID is zero', async () => {
    process.env.MCP_PRACTICE_ID = '0';
    await expect(authenticate()).rejects.toThrow('positive integer');
  });

  it('uses MCP_USER_ROLE when provided', async () => {
    process.env.MCP_USER_ROLE = 'billing';
    const ctx = await authenticate();
    expect(ctx.role).toBe('billing');
  });
});
