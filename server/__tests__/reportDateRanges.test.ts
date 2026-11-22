/**
 * Specific calendar dates on report endpoints: the canned reports and the
 * benchmarking metrics accept ?start=YYYY-MM-DD&end=YYYY-MM-DD, answer 400 for
 * a range that cannot be right, and keep working with no range at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { dbState, cacheState } = vi.hoisted(() => ({
  dbState: { result: [] as any[] },
  cacheState: { keys: [] as string[] },
}));

function fluent(): any {
  const target: any = () => {};
  const proxy: any = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: any, reject: any) => Promise.resolve(dbState.result).then(resolve, reject);
      }
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}
function fluentDb(): any {
  return { select: () => fluent(), selectDistinct: () => fluent(), execute: async () => ({ rows: dbState.result }) };
}

vi.mock('../db', () => ({ db: fluentDb(), getDb: async () => fluentDb(), dbReady: Promise.resolve() }));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'u1' } };
    req.userPracticeId = 1;
    req.userRole = 'admin';
    next();
  },
}));
vi.mock('../storage', () => ({ storage: { getUser: async () => ({ id: 'u1', role: 'admin', practiceId: 1 }) } }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/cacheService', () => ({
  cache: {
    get: async () => null,
    set: async () => {},
    del: async () => {},
    wrap: async (key: string, _ttl: number, fn: () => Promise<any>) => {
      cacheState.keys.push(key);
      return fn();
    },
  },
  CacheKeys: new Proxy({}, { get: () => () => 'cache-key' }),
  CacheTTL: new Proxy({}, { get: () => 60 }),
}));
vi.mock('../services/phiEncryptionService', () => ({
  decryptField: (v: any) => v,
  resolveEncryptedDob: (_enc: any, plain: any) => plain,
  decryptPatientRecord: (r: any) => r,
}));

import cannedReportsRouter from '../routes/canned-reports';
import benchmarkingRouter from '../routes/benchmarking';

const CANNED = [
  '/days-to-note-completion',
  '/cancellations',
  '/adjustments',
  '/intake-completion',
  '/referrals',
  '/capacity-utilization',
  '/operations',
];

let app: Express;
beforeEach(() => {
  dbState.result = [];
  cacheState.keys = [];
  app = express();
  app.use('/api/reports', cannedReportsRouter);
  app.use('/api/benchmarking', benchmarkingRouter);
});

describe('canned reports: chosen calendar dates', () => {
  it.each(CANNED)('%s answers 400 when the start is after the end', async (route) => {
    const res = await request(app).get(`/api/reports${route}?start=2026-11-18&end=2026-11-05`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/on or before/);
  });

  it.each(CANNED)('%s answers 400 when only one date is given', async (route) => {
    const res = await request(app).get(`/api/reports${route}?start=2026-11-05`);
    expect(res.status).toBe(400);
  });

  it.each(CANNED)('%s answers 400 for dates that are not real', async (route) => {
    const res = await request(app).get(`/api/reports${route}?start=2026-02-31&end=2026-03-05`);
    expect(res.status).toBe(400);
  });

  it.each(CANNED)('%s answers 400 for a range longer than the maximum', async (route) => {
    const res = await request(app).get(`/api/reports${route}?start=2020-01-01&end=2026-11-18`);
    expect(res.status).toBe(400);
  });

  it.each(CANNED)('%s accepts a specific range and still works with no range', async (route) => {
    const chosen = await request(app).get(`/api/reports${route}?start=2026-11-05&end=2026-11-18`);
    expect(chosen.status).toBe(200);
    const none = await request(app).get(`/api/reports${route}`);
    expect(none.status).toBe(200);
  });

  it('covers the whole end day: the reported window ends at the last instant of the end date', async () => {
    const res = await request(app).get('/api/reports/cancellations?start=2026-11-05&end=2026-11-18');
    expect(res.status).toBe(200);
    // 11:59:59 PM Eastern on Nov 18 is 04:59:59 UTC on Nov 19.
    expect(res.body.end).toBe('2026-11-19T04:59:59.999Z');
    expect(res.body.start).toBe('2026-11-05T05:00:00.000Z');
  });
});

describe('benchmarking metrics: chosen calendar dates', () => {
  it('answers 400 for an unusable range', async () => {
    const res = await request(app).get('/api/benchmarking/metrics?start=2026-11-18&end=2026-11-05');
    expect(res.status).toBe(400);
    expect(cacheState.keys).toHaveLength(0);
  });

  it('computes for a chosen range and caches it under that range, not a preset', async () => {
    const res = await request(app).get('/api/benchmarking/metrics?start=2026-11-05&end=2026-11-18');
    expect(res.status).toBe(200);
    expect(cacheState.keys).toEqual(['practice:1:benchmarking:metrics:2026-11-05:2026-11-18']);
  });

  it('still supports the preset periods', async () => {
    const res = await request(app).get('/api/benchmarking/metrics?period=6m');
    expect(res.status).toBe(200);
    expect(cacheState.keys).toEqual(['practice:1:benchmarking:metrics:6m']);
  });
});
