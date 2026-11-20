/**
 * Practice checks apply to every caller except the platform admin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, authCtx } = vi.hoisted(() => ({
  mockStorage: {
    getUser: vi.fn(),
    getRecoveryLedgerStats: vi.fn(async () => ({ recovered: 0 })),
    getBillerCockpit: vi.fn(async () => ({ held: [] })),
    getSupervisees: vi.fn(async () => [{ id: 't-2', firstName: 'S', lastName: 'Two' }]),
  },
  authCtx: { userId: 'u1', role: 'admin', practiceId: 2 as number | null, platformAdmin: false },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => {
  const fluent = (): any => new Proxy(() => {}, {
    get: (_t, prop: string) => (prop === 'then' ? (res: any) => Promise.resolve([]).then(res) : () => fluent()),
    apply: () => fluent(),
  });
  const db = { select: () => fluent(), selectDistinct: () => fluent(), insert: () => fluent(), update: () => fluent(), delete: () => fluent(), execute: async () => ({ rows: [] }) };
  return { db, getDb: async () => db, dbReady: Promise.resolve() };
});
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: authCtx.userId } };
    req.userPracticeId = authCtx.practiceId;
    req.userRole = authCtx.role;
    req.isPlatformAdmin = authCtx.platformAdmin;
    next();
  },
}));
vi.mock('../middleware/financial-access', () => ({ requireFinancialRole: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../services/cacheService', () => ({
  cache: { get: async () => null, set: async () => {}, del: async () => {}, wrap: async (_k: string, _ttl: number, fn: () => any) => fn() },
  CacheKeys: new Proxy({}, { get: () => () => 'cache-key' }),
  CacheTTL: { ANALYTICS: 60 },
}));

import analyticsRouter from '../routes/analytics';
import sessionsRouter from '../routes/sessions';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRouter);
  app.use('/api', sessionsRouter);
  return app;
}

const USERS: Record<string, any> = {
  u1: { id: 'u1', role: 'admin', practiceId: 2 },
  'sup-1': { id: 'sup-1', role: 'therapist', practiceId: 1 },
  'sup-2': { id: 'sup-2', role: 'therapist', practiceId: 2 },
};

beforeEach(() => {
  vi.clearAllMocks();
  authCtx.userId = 'u1';
  authCtx.role = 'admin';
  authCtx.practiceId = 2;
  authCtx.platformAdmin = false;
  mockStorage.getUser.mockImplementation(async (id: string) => USERS[id] ? { ...USERS[id], role: id === 'u1' ? authCtx.role : USERS[id].role, practiceId: id === 'u1' ? authCtx.practiceId : USERS[id].practiceId } : undefined);
});

describe.each([
  ['recovery-ledger', '/api/analytics/recovery-ledger', 'getRecoveryLedgerStats'],
  ['biller-cockpit', '/api/analytics/biller-cockpit', 'getBillerCockpit'],
])('%s — practice check applies to a practice admin', (_name, path, storageFn) => {
  it('a practice admin asking for another practice gets 403 and no data is read', async () => {
    const res = await request(buildApp()).get(`${path}?practiceId=1`);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Access denied for the requested practice/);
    expect((mockStorage as any)[storageFn]).not.toHaveBeenCalled();
  });

  it('a practice admin with no practice assignment cannot pick one by query parameter', async () => {
    authCtx.practiceId = null;
    const res = await request(buildApp()).get(`${path}?practiceId=1`);
    expect(res.status).toBe(403);
    expect((mockStorage as any)[storageFn]).not.toHaveBeenCalled();
  });

  it('a practice admin reads their own practice (explicit or implicit)', async () => {
    expect((await request(buildApp()).get(`${path}?practiceId=2`)).status).toBe(200);
    expect((await request(buildApp()).get(path)).status).toBe(200);
    expect((mockStorage as any)[storageFn]).toHaveBeenCalledWith(2, ...((mockStorage as any)[storageFn].mock.calls[0].slice(1)));
  });

  it('a billing user from another practice still gets 403', async () => {
    authCtx.role = 'billing';
    const res = await request(buildApp()).get(`${path}?practiceId=1`);
    expect(res.status).toBe(403);
  });

  it('a platform admin may read another practice', async () => {
    authCtx.platformAdmin = true;
    const res = await request(buildApp()).get(`${path}?practiceId=1`);
    expect(res.status).toBe(200);
    expect((mockStorage as any)[storageFn].mock.calls[0][0]).toBe(1);
  });
});

describe('GET /api/users/:id/supervisees — practice check applies to a practice admin', () => {
  it('a practice admin asking for a supervisor in another practice gets 404 and no list is read', async () => {
    const res = await request(buildApp()).get('/api/users/sup-1/supervisees');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Supervisor not found' });
    expect(mockStorage.getSupervisees).not.toHaveBeenCalled();
  });

  it('an unknown supervisor id is also 404 (no existence oracle)', async () => {
    const res = await request(buildApp()).get('/api/users/nobody/supervisees');
    expect(res.status).toBe(404);
    expect(mockStorage.getSupervisees).not.toHaveBeenCalled();
  });

  it('a practice admin lists a supervisor in their own practice', async () => {
    const res = await request(buildApp()).get('/api/users/sup-2/supervisees');
    expect(res.status).toBe(200);
    expect(mockStorage.getSupervisees).toHaveBeenCalledWith('sup-2');
  });

  it('a supervisor lists their own supervisees whatever their role', async () => {
    authCtx.userId = 'sup-1';
    authCtx.role = 'therapist';
    authCtx.practiceId = 1;
    const res = await request(buildApp()).get('/api/users/sup-1/supervisees');
    expect(res.status).toBe(200);
  });

  it('a non-admin asking for someone else is still 403', async () => {
    authCtx.role = 'therapist';
    const res = await request(buildApp()).get('/api/users/sup-2/supervisees');
    expect(res.status).toBe(403);
    expect(mockStorage.getSupervisees).not.toHaveBeenCalled();
  });

  it('a platform admin may list a supervisor in another practice', async () => {
    authCtx.platformAdmin = true;
    const res = await request(buildApp()).get('/api/users/sup-1/supervisees');
    expect(res.status).toBe(200);
  });
});
