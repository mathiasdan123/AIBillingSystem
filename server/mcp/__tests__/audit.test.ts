import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../middleware/auditMiddleware', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    audit: vi.fn(),
  },
}));

import { withAudit } from '../audit';
import { logAuditEvent } from '../../middleware/auditMiddleware';
import type { McpPracticeContext } from '../types';

describe('MCP audit', () => {
  const mockContext: McpPracticeContext = {
    practiceId: 1,
    userId: 'user-1',
    role: 'admin',
    apiKey: 'test-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success result and logs audit event', async () => {
    const handler = vi.fn().mockResolvedValue({ total: 5 });
    const wrapped = withAudit('test_tool', 'test', false, handler);

    const result = await wrapped({ id: 1 }, mockContext);

    expect(handler).toHaveBeenCalledWith({ id: 1 }, mockContext);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ total: 5 });
    expect(parsed.containsPhi).toBe(false);

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCategory: 'mcp_tool_call',
        eventType: 'test_tool',
        resourceType: 'test',
        userId: 'user-1',
        practiceId: 1,
        success: true,
      }),
    );
  });

  it('returns error result on handler failure', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('DB connection failed'));
    const wrapped = withAudit('test_tool', 'test', false, handler);

    const result = await wrapped({}, mockContext);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('DB connection failed');

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        details: expect.objectContaining({ error: 'DB connection failed' }),
      }),
    );
  });

  it('marks PHI-containing results', async () => {
    const handler = vi.fn().mockResolvedValue({ name: 'John' });
    const wrapped = withAudit('get_patient', 'patient', true, handler);

    const result = await wrapped({ id: 1 }, mockContext);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.containsPhi).toBe(true);
  });

  it('still returns result even if audit logging fails', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(logAuditEvent).mockRejectedValueOnce(new Error('audit DB down'));

    const wrapped = withAudit('test_tool', 'test', false, handler);
    const result = await wrapped({}, mockContext);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });
});
