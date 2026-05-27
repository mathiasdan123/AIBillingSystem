/**
 * Tests that workspaceIds gets forwarded to Anthropic as the
 * `workspace_ids[]` query param. This is the bit that scopes the cost
 * dashboard to TherapyBill production instead of the whole personal org.
 *
 * Mocks global fetch to inspect the URL Anthropic is called with.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIG_FETCH = globalThis.fetch;
const ORIG_ENV = { ...process.env };

beforeEach(() => {
  process.env.ANTHROPIC_ADMIN_API_KEY = 'sk-ant-admin-test';
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 })) as any;
});
afterEach(() => {
  globalThis.fetch = ORIG_FETCH;
  process.env = { ...ORIG_ENV };
  vi.restoreAllMocks();
});

async function importFresh() {
  // Re-import to dodge the module-level in-process response cache between tests.
  vi.resetModules();
  return await import('../services/anthropicAdminApi');
}

const RANGE = {
  startingAt: new Date('2026-05-01T00:00:00Z'),
  endingAt: new Date('2026-05-31T23:59:59Z'),
};

describe('anthropicAdminApi workspace_ids passthrough', () => {
  it('fetchCost forwards workspaceIds as workspace_ids[]', async () => {
    const mod = await importFresh();
    await mod.fetchCost({ ...RANGE, workspaceIds: ['wkspc_abc123'] });
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('workspace_ids%5B%5D=wkspc_abc123');
  });

  it('fetchCost omits workspace_ids[] when no workspaceIds are passed', async () => {
    const mod = await importFresh();
    await mod.fetchCost(RANGE);
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('workspace_ids');
  });

  it('fetchMessagesUsage forwards workspaceIds as workspace_ids[]', async () => {
    const mod = await importFresh();
    await mod.fetchMessagesUsage({ ...RANGE, bucketWidth: '1d', workspaceIds: ['wkspc_xyz789'] });
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('workspace_ids%5B%5D=wkspc_xyz789');
  });

  it('supports multiple workspace ids (e.g. prod + staging)', async () => {
    const mod = await importFresh();
    await mod.fetchCost({ ...RANGE, workspaceIds: ['wkspc_prod', 'wkspc_staging'] });
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('workspace_ids%5B%5D=wkspc_prod');
    expect(calledUrl).toContain('workspace_ids%5B%5D=wkspc_staging');
  });
});
