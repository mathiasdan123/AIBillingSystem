import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * BAA routes — regression coverage for the production 500 on GET /api/baa.
 *
 * The session user object only carries claims.sub; practiceId/role live on
 * req.userPracticeId / req.userRole (attached by isAuthenticated from the DB).
 * The route used to read practiceId off req.user, resolve undefined, and
 * throw → 500 for every non-platform-admin, including a practice with no BAA
 * records at all. It must now scope to req.userPracticeId and treat "no
 * records" / "no practice" as a normal empty state.
 */

const { storageStub, authContext } = vi.hoisted(() => ({
  storageStub: {
    getUser: vi.fn(),
    getBaaRecords: vi.fn(async () => []),
    createBaaRecord: vi.fn(async (data: any) => ({ id: 1, ...data })),
    updateBaaRecord: vi.fn(),
    deleteBaaRecord: vi.fn(),
  },
  authContext: {
    current: {
      userId: 'demo-admin',
      practiceId: 2 as number | undefined,
      role: 'admin',
      isPlatformAdmin: false,
    },
  },
}));

vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../replitAuth', () => ({
  // Mirrors the real middleware: session user carries ONLY claims.sub;
  // practice/role context is attached to the request from the DB.
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: authContext.current.userId } };
    req.userPracticeId = authContext.current.practiceId;
    req.userRole = authContext.current.role;
    req.isPlatformAdmin = authContext.current.isPlatformAdmin;
    next();
  },
}));

import { registerBaaRoutes } from '../routes/baaRoutes';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  registerBaaRoutes(app);
  return app;
}

describe('BAA routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContext.current = {
      userId: 'demo-admin',
      practiceId: 2,
      role: 'admin',
      isPlatformAdmin: false,
    };
    storageStub.getUser.mockResolvedValue({ id: 'demo-admin', role: 'admin' });
    storageStub.getBaaRecords.mockResolvedValue([]);
  });

  it('returns 200 with an empty list when the practice has no BAA records (regression: used to 500)', async () => {
    const res = await request(makeApp()).get('/api/baa');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    // Scoped to the caller's own practice from req.userPracticeId.
    expect(storageStub.getBaaRecords).toHaveBeenCalledWith(2);
  });

  it('returns the practice\'s records when they exist', async () => {
    const records = [{ id: 7, practiceId: 2, vendorName: 'AWS', vendorType: 'cloud_provider' }];
    storageStub.getBaaRecords.mockResolvedValue(records as any);

    const res = await request(makeApp()).get('/api/baa');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(records);
  });

  it('returns 200 [] (not 500) for an admin without a practice assignment', async () => {
    authContext.current.practiceId = undefined;

    const res = await request(makeApp()).get('/api/baa');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(storageStub.getBaaRecords).not.toHaveBeenCalled();
  });

  it('clamps a practice admin to their own practice even with ?practiceId=', async () => {
    const res = await request(makeApp()).get('/api/baa?practiceId=1');

    expect(res.status).toBe(200);
    expect(storageStub.getBaaRecords).toHaveBeenCalledWith(2);
  });

  it('lets a platform admin resolve a requested practice', async () => {
    authContext.current.isPlatformAdmin = true;
    authContext.current.practiceId = 1;

    const res = await request(makeApp()).get('/api/baa?practiceId=2');

    expect(res.status).toBe(200);
    expect(storageStub.getBaaRecords).toHaveBeenCalledWith(2);
  });

  it('rejects non-admin users with 403', async () => {
    storageStub.getUser.mockResolvedValue({ id: 'demo-admin', role: 'therapist' });

    const res = await request(makeApp()).get('/api/baa');

    expect(res.status).toBe(403);
  });

  it('POST scopes the new record to the caller\'s practice', async () => {
    const res = await request(makeApp())
      .post('/api/baa')
      .send({ vendorName: 'AWS', vendorType: 'cloud_provider', signedDate: '2026-01-01', expirationDate: '2027-01-01', practiceId: 999 });

    expect(res.status).toBe(201);
    expect(storageStub.createBaaRecord).toHaveBeenCalledWith(
      expect.objectContaining({ practiceId: 2, vendorName: 'AWS' }),
    );
  });

  it('POST returns 400 (not 500) when the user has no practice', async () => {
    authContext.current.practiceId = undefined;

    const res = await request(makeApp())
      .post('/api/baa')
      .send({ vendorName: 'AWS', vendorType: 'cloud_provider' });

    expect(res.status).toBe(400);
    expect(storageStub.createBaaRecord).not.toHaveBeenCalled();
  });
});
