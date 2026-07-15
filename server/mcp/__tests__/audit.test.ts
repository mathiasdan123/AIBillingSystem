import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../middleware/auditMiddleware', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../storage', () => ({
  storage: {
    getPractice: vi.fn(),
  },
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

import { withAudit, MCP_PHI_DISABLED_MESSAGE } from '../audit';
import { logAuditEvent } from '../../middleware/auditMiddleware';
import { storage } from '../../storage';
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
    // Default: PHI enabled so pre-existing tests exercise handlers unchanged.
    vi.mocked(storage.getPractice).mockResolvedValue({
      id: 1,
      mcpPhiEnabled: true,
      isDemo: false,
    } as any);
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

  describe('PHI gate (mcp_phi_enabled)', () => {
    it('refuses PHI tools when the practice has not enabled PHI over MCP', async () => {
      vi.mocked(storage.getPractice).mockResolvedValue({
        id: 1, mcpPhiEnabled: false, isDemo: false,
      } as any);
      const handler = vi.fn().mockResolvedValue({ name: 'John' });
      const wrapped = withAudit('get_patient', 'patient', true, handler);

      const result = await wrapped({ id: 1 }, mockContext);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe(MCP_PHI_DISABLED_MESSAGE);
      expect(handler).not.toHaveBeenCalled();
      // The refusal is still audit-logged as a failed call
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'get_patient', success: false }),
      );
    });

    it('allows PHI tools when mcpPhiEnabled is true', async () => {
      const handler = vi.fn().mockResolvedValue({ name: 'John' });
      const wrapped = withAudit('get_patient', 'patient', true, handler);

      const result = await wrapped({ id: 1 }, mockContext);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(handler).toHaveBeenCalled();
    });

    it('allows PHI tools for demo practices (fake data is not PHI)', async () => {
      vi.mocked(storage.getPractice).mockResolvedValue({
        id: 2, mcpPhiEnabled: false, isDemo: true,
      } as any);
      const handler = vi.fn().mockResolvedValue({ name: 'Demo Patient' });
      const wrapped = withAudit('get_patient', 'patient', true, handler);

      const result = await wrapped({ id: 1 }, mockContext);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
    });

    it('fails CLOSED when the practice record cannot be read', async () => {
      vi.mocked(storage.getPractice).mockRejectedValue(new Error('db down'));
      const handler = vi.fn().mockResolvedValue({ name: 'John' });
      const wrapped = withAudit('get_patient', 'patient', true, handler);

      const result = await wrapped({ id: 1 }, mockContext);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('never gates non-PHI tools, even when the practice read fails', async () => {
      vi.mocked(storage.getPractice).mockRejectedValue(new Error('db down'));
      const handler = vi.fn().mockResolvedValue({ total: 5 });
      const wrapped = withAudit('get_dashboard_stats', 'analytics', false, handler);

      const result = await wrapped({}, mockContext);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      // Non-PHI path must not even look up the practice
      expect(storage.getPractice).not.toHaveBeenCalled();
    });
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
