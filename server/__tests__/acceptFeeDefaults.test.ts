import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * POST /api/cpt-codes/accept-defaults
 *
 * The per-practice cutover copied platform charges into every existing
 * practice, so "has a rate" stopped meaning "someone chose this number" and
 * the fee-schedule screen had no way to show which charges were reviewed.
 *
 * This endpoint records that a human confirmed them. The rule it must never
 * break: it changes NO dollar amounts. Confirming a charge and setting a
 * charge are different acts, and only the first is safe in one click.
 */
const authCtx: { userRole: string; userPracticeId: number | null } = {
  userRole: 'admin',
  userPracticeId: 1,
};

const { storageStub } = vi.hoisted(() => ({
  storageStub: {
    acceptPlatformDefaultRates: vi.fn(),
    getUser: vi.fn(),
    getPracticeCptCodes: vi.fn(),
    getCptCodes: vi.fn(),
    upsertPracticeCptRate: vi.fn(),
    resolvePracticeCptRate: vi.fn(),
    deletePracticeCptRate: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('../services/cacheService', () => ({
  cache: { wrap: vi.fn(async (_k: string, _t: any, fn: any) => fn()), del: vi.fn() },
  CacheKeys: { cptCodes: () => 'global:cpt-codes' },
  CacheTTL: { CODE_LOOKUPS: 60 },
}));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'user-1' } };
    req.userRole = authCtx.userRole;
    req.userPracticeId = authCtx.userPracticeId;
    next();
  },
}));

import sessionsRouter from '../routes/sessions';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', sessionsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  authCtx.userRole = 'admin';
  authCtx.userPracticeId = 1;
  storageStub.getUser.mockResolvedValue({ id: 'user-1', role: 'admin' });
  storageStub.acceptPlatformDefaultRates.mockResolvedValue(24);
});

describe('POST /api/cpt-codes/accept-defaults', () => {
  it('confirms the practice\'s unreviewed defaults', async () => {
    const res = await request(makeApp()).post('/api/cpt-codes/accept-defaults').send({});
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(24);
    expect(res.body.message).toMatch(/24 charges confirmed/i);
    expect(storageStub.acceptPlatformDefaultRates).toHaveBeenCalledWith(1, 'user-1');
  });

  // The guarantee that makes one-click acceptance safe.
  it('never writes a dollar amount', async () => {
    await request(makeApp()).post('/api/cpt-codes/accept-defaults').send({ baseRate: '999.00' });
    expect(storageStub.upsertPracticeCptRate).not.toHaveBeenCalled();
    expect(storageStub.deletePracticeCptRate).not.toHaveBeenCalled();
  });

  it('scopes to the caller\'s own practice', async () => {
    authCtx.userPracticeId = 7;
    await request(makeApp()).post('/api/cpt-codes/accept-defaults').send({});
    expect(storageStub.acceptPlatformDefaultRates).toHaveBeenCalledWith(7, 'user-1');
  });

  it('is harmless when nothing is left to confirm', async () => {
    storageStub.acceptPlatformDefaultRates.mockResolvedValue(0);
    const res = await request(makeApp()).post('/api/cpt-codes/accept-defaults').send({});
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(0);
    expect(res.body.message).toMatch(/no unreviewed platform defaults/i);
  });

  it('refuses a therapist — charges are an admin/billing decision', async () => {
    authCtx.userRole = 'therapist';
    storageStub.getUser.mockResolvedValue({ id: 'user-1', role: 'therapist' });
    const res = await request(makeApp()).post('/api/cpt-codes/accept-defaults').send({});
    expect(res.status).toBe(403);
    expect(storageStub.acceptPlatformDefaultRates).not.toHaveBeenCalled();
  });
});
