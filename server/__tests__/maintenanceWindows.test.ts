/**
 * Tests for server/routes/maintenance-windows.ts
 *
 * Covers:
 *  - GET    /active   — authenticated, returns active windows for user's practice
 *  - GET    /         — admin-only, returns all windows
 *  - POST   /         — admin-only, validates payload
 *  - PATCH  /:id      — admin-only, updates fields
 *  - DELETE /:id      — admin-only
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Drizzle DB mock — db.select / insert / update / delete return chainable
// objects. Each test reassigns `dbSelectResult` etc. to control the data.
// ---------------------------------------------------------------------------
const dbState = vi.hoisted(() => ({
  selectResult: [] as any[],
  insertResult: [] as any[],
  updateResult: [] as any[],
  deleteResult: [] as any[],
  lastInsertValues: undefined as any,
  lastUpdateValues: undefined as any,
  lastDeleteId: undefined as any,
}));

const mockDb = vi.hoisted(() => {
  // Helper to build a thenable chain that resolves to a given array.
  const chain = (resolveTo: () => any[]) => {
    const obj: any = {};
    const finalize = () => Promise.resolve(resolveTo());
    obj.from = vi.fn(() => obj);
    obj.where = vi.fn(() => obj);
    obj.orderBy = vi.fn(() => obj);
    obj.values = vi.fn((vals: any) => {
      dbState.lastInsertValues = vals;
      return obj;
    });
    obj.set = vi.fn((vals: any) => {
      dbState.lastUpdateValues = vals;
      return obj;
    });
    obj.returning = vi.fn(() => finalize());
    obj.then = (resolve: any, reject: any) => finalize().then(resolve, reject);
    return obj;
  };

  return {
    select: vi.fn(() => chain(() => dbState.selectResult)),
    insert: vi.fn(() => chain(() => dbState.insertResult)),
    update: vi.fn(() => chain(() => dbState.updateResult)),
    delete: vi.fn(() => chain(() => dbState.deleteResult)),
  };
});

vi.mock('../db', () => ({ db: mockDb }));

// ---------------------------------------------------------------------------
// Auth mock — userRole + userPracticeId controlled per-test
// ---------------------------------------------------------------------------
let currentUserRole = 'admin';
let currentUserPracticeId: number | undefined = 1;

vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'test-user-1' } };
    req.userPracticeId = currentUserPracticeId;
    req.userRole = currentUserRole;
    next();
  },
  setupAuth: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import maintenanceRouter from '../routes/maintenance-windows';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/maintenance-windows', maintenanceRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUserRole = 'admin';
  currentUserPracticeId = 1;
  dbState.selectResult = [];
  dbState.insertResult = [];
  dbState.updateResult = [];
  dbState.deleteResult = [];
  dbState.lastInsertValues = undefined;
  dbState.lastUpdateValues = undefined;
});

describe('Maintenance Windows Routes', () => {
  describe('GET /api/maintenance-windows/active', () => {
    it('returns active windows for any authenticated user', async () => {
      currentUserRole = 'therapist';
      const now = new Date();
      dbState.selectResult = [
        {
          id: 1, practiceId: null, message: 'Scheduled maintenance', severity: 'info',
          startsAt: new Date(now.getTime() - 60000), endsAt: new Date(now.getTime() + 60000),
          dismissible: true, createdBy: 'admin-1', createdAt: now, updatedAt: now,
        },
      ];

      const res = await request(buildApp()).get('/api/maintenance-windows/active').expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].message).toBe('Scheduled maintenance');
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('returns an empty array when no windows are active', async () => {
      dbState.selectResult = [];
      const res = await request(buildApp()).get('/api/maintenance-windows/active').expect(200);
      expect(res.body).toEqual([]);
    });

    it('still works when user has no assigned practice', async () => {
      currentUserPracticeId = undefined;
      dbState.selectResult = [];
      await request(buildApp()).get('/api/maintenance-windows/active').expect(200);
    });
  });

  describe('GET /api/maintenance-windows', () => {
    it('returns all windows for admin', async () => {
      dbState.selectResult = [
        { id: 1, message: 'past', severity: 'info', practiceId: null, startsAt: new Date(), endsAt: new Date(), dismissible: true },
      ];
      const res = await request(buildApp()).get('/api/maintenance-windows').expect(200);
      expect(res.body).toHaveLength(1);
    });

    it('returns 403 for non-admin users', async () => {
      currentUserRole = 'therapist';
      const res = await request(buildApp()).get('/api/maintenance-windows').expect(403);
      expect(res.body.message).toMatch(/Admin/i);
    });
  });

  describe('POST /api/maintenance-windows', () => {
    const validPayload = () => ({
      practiceId: null,
      message: 'Scheduled maintenance Sunday 3am ET',
      severity: 'info',
      startsAt: new Date(Date.now() + 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
      dismissible: true,
    });

    it('creates a new window for admin', async () => {
      dbState.insertResult = [{ id: 42, ...validPayload(), createdBy: 'test-user-1' }];

      const res = await request(buildApp())
        .post('/api/maintenance-windows')
        .send(validPayload())
        .expect(201);

      expect(res.body.id).toBe(42);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(dbState.lastInsertValues.createdBy).toBe('test-user-1');
      // startsAt / endsAt should have been coerced to Date instances
      expect(dbState.lastInsertValues.startsAt).toBeInstanceOf(Date);
      expect(dbState.lastInsertValues.endsAt).toBeInstanceOf(Date);
    });

    it('returns 403 for non-admin users', async () => {
      currentUserRole = 'billing';
      await request(buildApp())
        .post('/api/maintenance-windows')
        .send(validPayload())
        .expect(403);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('rejects when endsAt <= startsAt', async () => {
      const start = new Date(Date.now() + 3600_000).toISOString();
      const res = await request(buildApp())
        .post('/api/maintenance-windows')
        .send({ ...validPayload(), startsAt: start, endsAt: start })
        .expect(400);
      expect(res.body.message).toMatch(/endsAt must be after startsAt/i);
    });

    it('rejects an invalid severity', async () => {
      const res = await request(buildApp())
        .post('/api/maintenance-windows')
        .send({ ...validPayload(), severity: 'bogus' })
        .expect(400);
      expect(res.body.message).toMatch(/severity/i);
    });

    it('rejects a missing message', async () => {
      const payload: any = validPayload();
      delete payload.message;
      await request(buildApp())
        .post('/api/maintenance-windows')
        .send(payload)
        .expect(400);
    });
  });

  describe('PATCH /api/maintenance-windows/:id', () => {
    it('updates a window for admin', async () => {
      dbState.updateResult = [{ id: 7, message: 'updated', severity: 'warning' }];

      const res = await request(buildApp())
        .patch('/api/maintenance-windows/7')
        .send({ message: 'updated', severity: 'warning' })
        .expect(200);

      expect(res.body.message).toBe('updated');
      expect(dbState.lastUpdateValues.message).toBe('updated');
      expect(dbState.lastUpdateValues.severity).toBe('warning');
      expect(dbState.lastUpdateValues.updatedAt).toBeInstanceOf(Date);
    });

    it('returns 404 when window does not exist', async () => {
      dbState.updateResult = [];
      await request(buildApp())
        .patch('/api/maintenance-windows/999')
        .send({ message: 'x' })
        .expect(404);
    });

    it('returns 403 for non-admin users', async () => {
      currentUserRole = 'therapist';
      await request(buildApp())
        .patch('/api/maintenance-windows/7')
        .send({ message: 'x' })
        .expect(403);
    });

    it('returns 400 for an invalid id', async () => {
      await request(buildApp())
        .patch('/api/maintenance-windows/abc')
        .send({ message: 'x' })
        .expect(400);
    });

    it('rejects an invalid severity on update', async () => {
      await request(buildApp())
        .patch('/api/maintenance-windows/7')
        .send({ severity: 'bogus' })
        .expect(400);
    });
  });

  describe('DELETE /api/maintenance-windows/:id', () => {
    it('deletes a window for admin', async () => {
      dbState.deleteResult = [{ id: 7 }];

      const res = await request(buildApp())
        .delete('/api/maintenance-windows/7')
        .expect(200);

      expect(res.body).toEqual({ success: true });
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('returns 404 when nothing was deleted', async () => {
      dbState.deleteResult = [];
      await request(buildApp())
        .delete('/api/maintenance-windows/999')
        .expect(404);
    });

    it('returns 403 for non-admin users', async () => {
      currentUserRole = 'therapist';
      await request(buildApp())
        .delete('/api/maintenance-windows/7')
        .expect(403);
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid id', async () => {
      await request(buildApp())
        .delete('/api/maintenance-windows/abc')
        .expect(400);
    });
  });
});
