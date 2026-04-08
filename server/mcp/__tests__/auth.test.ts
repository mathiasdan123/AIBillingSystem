import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db module before importing auth
// The new auth.ts imports db for key lookup; mock it to return empty results
const mockSelect = vi.fn().mockReturnThis();
const mockFrom = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockReturnThis();
const mockLimit = vi.fn().mockResolvedValue([]); // No key found in DB -> falls back to env vars

vi.mock('../../db', () => ({
  dbReady: Promise.resolve(),
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mockLimit }) }) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

// Mock the logger to suppress warnings in tests
vi.mock('../../services/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { authenticate } from '../auth';

describe('MCP auth', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.MCP_API_KEY = 'test-key-123';
    process.env.MCP_PRACTICE_ID = '1';
    process.env.MCP_USER_ID = 'user-1';
    // Reset mock to return no DB results (env-var fallback)
    mockLimit.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns context when all env vars are set (fallback path)', async () => {
    const ctx = await authenticate();
    expect(ctx.practiceId).toBe(1);
    expect(ctx.userId).toBe('user-1');
    expect(ctx.role).toBe('admin');
    expect(ctx.apiKey).toBe('test-key-123');
  });

  it('throws when MCP_API_KEY is missing', async () => {
    delete process.env.MCP_API_KEY;
    delete process.env.THERAPYBILL_API_KEY;
    await expect(authenticate()).rejects.toThrow('MCP_API_KEY');
  });

  it('throws when MCP_PRACTICE_ID is missing and key not in DB', async () => {
    delete process.env.MCP_PRACTICE_ID;
    await expect(authenticate()).rejects.toThrow('MCP_PRACTICE_ID');
  });

  it('throws when MCP_USER_ID is missing and key not in DB', async () => {
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

  it('uses MCP_USER_ROLE when provided (fallback path)', async () => {
    process.env.MCP_USER_ROLE = 'billing';
    const ctx = await authenticate();
    expect(ctx.role).toBe('billing');
  });

  it('accepts THERAPYBILL_API_KEY as an alternative env var', async () => {
    delete process.env.MCP_API_KEY;
    process.env.THERAPYBILL_API_KEY = 'tbai_test123';
    const ctx = await authenticate();
    expect(ctx.apiKey).toBe('tbai_test123');
  });
});
