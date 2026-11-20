/**
 * Supervision assignment keeps supervisor and supervisee in one practice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, authCtx } = vi.hoisted(() => ({
  mockStorage: {
    getUser: vi.fn(),
    updateUserSupervision: vi.fn(async (userId: string, supervisorId: string | null, requiresCosign: boolean) => ({ id: userId, supervisorId, requiresCosign })),
  },
  authCtx: { userId: 'admin-2', role: 'admin', practiceId: 2 as number | null, platformAdmin: false },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => {
  const fluent = (): any => new Proxy(() => {}, {
    get: (_t, prop: string) => (prop === 'then' ? (res: any) => Promise.resolve([]).then(res) : () => fluent()),
    apply: () => fluent(),
  });
  const db = { select: () => fluent(), insert: () => fluent(), update: () => fluent(), delete: () => fluent(), execute: async () => ({ rows: [] }) };
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

import sessionsRouter from '../routes/sessions';

const USERS: Record<string, any> = {
  'admin-2': { id: 'admin-2', role: 'admin', practiceId: 2 },
  'billing-2': { id: 'billing-2', role: 'billing', practiceId: 2 },
  'ther-2a': { id: 'ther-2a', role: 'therapist', practiceId: 2 },
  'ther-2b': { id: 'ther-2b', role: 'therapist', practiceId: 2 },
  'ther-1': { id: 'ther-1', role: 'therapist', practiceId: 1 },
  'sup-1': { id: 'sup-1', role: 'therapist', practiceId: 1 },
};

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', sessionsRouter);
  return app;
}
const assign = (userId: string, body: any) => request(buildApp()).patch(`/api/users/${userId}/supervision`).send(body);

beforeEach(() => {
  vi.clearAllMocks();
  authCtx.userId = 'admin-2';
  authCtx.role = 'admin';
  authCtx.practiceId = 2;
  authCtx.platformAdmin = false;
  mockStorage.getUser.mockImplementation(async (id: string) => USERS[id]);
});

describe('PATCH /api/users/:id/supervision', () => {
  it('assigns a supervisor from the same practice', async () => {
    const res = await assign('ther-2a', { supervisorId: 'ther-2b', requiresCosign: true });
    expect(res.status).toBe(200);
    expect(mockStorage.updateUserSupervision).toHaveBeenCalledWith('ther-2a', 'ther-2b', true);
  });

  it('rejects a supervisor from another practice and writes nothing', async () => {
    const res = await assign('ther-2a', { supervisorId: 'sup-1' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Supervisor not found' });
    expect(mockStorage.updateUserSupervision).not.toHaveBeenCalled();
  });

  it('rejects an unknown supervisor', async () => {
    const res = await assign('ther-2a', { supervisorId: 'nobody' });
    expect(res.status).toBe(400);
    expect(mockStorage.updateUserSupervision).not.toHaveBeenCalled();
  });

  it('refuses to change a user outside the caller practice (404, nothing written)', async () => {
    const res = await assign('ther-1', { supervisorId: 'sup-1' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'User not found' });
    expect(mockStorage.updateUserSupervision).not.toHaveBeenCalled();
  });

  it('refuses when the caller has no practice assignment', async () => {
    authCtx.practiceId = null;
    const res = await assign('ther-2a', { supervisorId: 'ther-2b' });
    expect(res.status).toBe(404);
    expect(mockStorage.updateUserSupervision).not.toHaveBeenCalled();
  });

  it('a user cannot be their own supervisor', async () => {
    const res = await assign('ther-2a', { supervisorId: 'ther-2a' });
    expect(res.status).toBe(400);
    expect(mockStorage.updateUserSupervision).not.toHaveBeenCalled();
  });

  it('clears a supervisor without a practice lookup on the supervisor', async () => {
    const res = await assign('ther-2a', { supervisorId: null, requiresCosign: false });
    expect(res.status).toBe(200);
    expect(mockStorage.updateUserSupervision).toHaveBeenCalledWith('ther-2a', null, false);
  });

  it('billing role may assign within its own practice', async () => {
    authCtx.userId = 'billing-2';
    authCtx.role = 'billing';
    const res = await assign('ther-2a', { supervisorId: 'ther-2b' });
    expect(res.status).toBe(200);
  });

  it('a platform admin may assign in another practice, still within that practice', async () => {
    authCtx.platformAdmin = true;
    expect((await assign('ther-1', { supervisorId: 'sup-1' })).status).toBe(200);
    expect((await assign('ther-1', { supervisorId: 'ther-2b' })).status).toBe(400); // supervisor must match the user's practice
  });

  it('404 for an unknown user', async () => {
    const res = await assign('ghost', { supervisorId: 'ther-2b' });
    expect(res.status).toBe(404);
    expect(mockStorage.updateUserSupervision).not.toHaveBeenCalled();
  });
});
