/**
 * /api/health/data — the check that distinguishes "empty" from "healthy".
 *
 * The 2026-08-26 incident: the ICD-10 catalog was empty in production, the
 * diagnosis picker rendered empty mid-billing-session, and every smoke check
 * passed because a 200 with [] looks healthy. This endpoint 503s naming the
 * empty catalog, so the deploy pipeline goes red instead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({ icd10: [] as any[], cpt: [] as any[], stedi: true }));

vi.mock('../storage', () => ({
  storage: {
    getIcd10Codes: async () => H.icd10,
    getCptCodes: async () => H.cpt,
    getAllPracticeIds: async () => [1],
  },
}));
vi.mock('../services/stediService', () => ({ isStediConfigured: () => H.stedi }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import express from 'express';
import request from 'supertest';

function makeApp() {
  const app = express();
  // Mirror of the route in server/routes.ts — registered inline there amidst
  // the full app graph, so the handler logic is replicated against the same
  // mocked storage contract rather than importing 100 routers.
  app.get('/api/health/data', async (_req, res) => {
    const { storage } = await import('../storage');
    const checks: Record<string, any> = {};
    const countCheck = async (name: string, fn: () => Promise<number>, min: number) => {
      try {
        const count = await fn();
        checks[name] = { ok: count >= min, count };
      } catch {
        checks[name] = { ok: false, error: 'query_failed' };
      }
    };
    await countCheck('icd10Catalog', async () => (await storage.getIcd10Codes()).length, 1);
    await countCheck('cptCatalog', async () => (await storage.getCptCodes()).length, 1);
    const { isStediConfigured } = await import('../services/stediService');
    checks.stediConfigured = { ok: isStediConfigured() };
    const ok = Object.values(checks).every((c: any) => c.ok);
    res.status(ok ? 200 : 503).json({ ok, checks });
  });
  return app;
}

beforeEach(() => {
  H.icd10 = [{ id: 1 }];
  H.cpt = [{ id: 1 }];
  H.stedi = true;
});

describe('GET /api/health/data', () => {
  it('200s when the catalogs have rows and the clearinghouse is configured', async () => {
    const res = await request(makeApp()).get('/api/health/data');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('503s naming an EMPTY ICD-10 catalog — the incident case', async () => {
    H.icd10 = [];
    const res = await request(makeApp()).get('/api/health/data');
    expect(res.status).toBe(503);
    expect(res.body.checks.icd10Catalog.ok).toBe(false);
    expect(res.body.checks.icd10Catalog.count).toBe(0);
  });

  it('503s when the clearinghouse key is missing', async () => {
    H.stedi = false;
    const res = await request(makeApp()).get('/api/health/data');
    expect(res.status).toBe(503);
  });

  it('treats a query failure as unhealthy, not as empty-but-fine', async () => {
    const broken = { icd10: null as any };
    H.icd10 = new Proxy([], { get() { throw new Error('db down'); } }) as any;
    const res = await request(makeApp()).get('/api/health/data');
    expect(res.status).toBe(503);
    expect(res.body.checks.icd10Catalog.error).toBe('query_failed');
  });
});
