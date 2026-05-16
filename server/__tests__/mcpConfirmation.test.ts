import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * MCP mutation gate (Phase 4): when `practices.mcp_requires_confirmation`
 * is true, MCP mutation tools refuse with a clear message directing the
 * user to the web chat. Default false → mutations pass through.
 */

const { storageStub } = vi.hoisted(() => ({
  storageStub: { getPractice: vi.fn() },
}));

vi.mock('../storage', () => ({ storage: storageStub }));

import { withMcpMutationGate } from '../mcp/confirmation';

beforeEach(() => {
  storageStub.getPractice.mockReset();
});

const ctx = { userId: 'u', practiceId: 7, role: 'admin' } as any;

describe('withMcpMutationGate', () => {
  it('passes through to the handler when mcpRequiresConfirmation is false', async () => {
    storageStub.getPractice.mockResolvedValueOnce({ mcpRequiresConfirmation: false });
    const handler = vi.fn(async () => ({ ok: true }));
    const gated = withMcpMutationGate(handler);

    const result = await gated({ x: 1 }, ctx);
    expect(result).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith({ x: 1 }, ctx);
  });

  it('passes through when the field is missing entirely (legacy practice rows)', async () => {
    storageStub.getPractice.mockResolvedValueOnce({});
    const handler = vi.fn(async () => 'ran');
    const gated = withMcpMutationGate(handler);
    await expect(gated({}, ctx)).resolves.toBe('ran');
  });

  it('refuses with the user-facing message when mcpRequiresConfirmation is true', async () => {
    storageStub.getPractice.mockResolvedValue({ mcpRequiresConfirmation: true });
    const handler = vi.fn();
    const gated = withMcpMutationGate(handler);

    await expect(gated({}, ctx)).rejects.toThrow(/requires server-side confirmation/i);
    await expect(gated({}, ctx)).rejects.toThrow(/web chat|disable mcp_requires_confirmation/i);
    expect(handler).not.toHaveBeenCalled();
  });

  it('fails OPEN when storage.getPractice throws (avoid breaking all MCP mutations on a DB blip)', async () => {
    storageStub.getPractice.mockRejectedValueOnce(new Error('connection lost'));
    const handler = vi.fn(async () => 'ran');
    const gated = withMcpMutationGate(handler);

    await expect(gated({}, ctx)).resolves.toBe('ran');
    expect(handler).toHaveBeenCalled();
  });
});
