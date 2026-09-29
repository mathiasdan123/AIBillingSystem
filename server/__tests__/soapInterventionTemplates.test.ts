/**
 * Tests for server/routes/soap-intervention-templates.ts
 *
 * Covers the merged GET (system defaults + practice custom rows, with a
 * practice's "shadow" row applied as a visibility override on the system
 * item), POST honoring an explicit isActive:false (the hide flow the admin
 * UI uses), and the system-default protection on PATCH/DELETE.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Drizzle DB mock — chainable objects; tests reassign dbState fields.
// ---------------------------------------------------------------------------
const dbState = vi.hoisted(() => ({
  selectResult: [] as any[],
  insertResult: [] as any[],
  updateResult: [] as any[],
  lastInsertValues: undefined as any,
  lastUpdateValues: undefined as any,
}));

const mockDb = vi.hoisted(() => {
  const chain = (resolveTo: () => any[]) => {
    const obj: any = {};
    const finalize = () => Promise.resolve(resolveTo());
    obj.from = vi.fn(() => obj);
    obj.where = vi.fn(() => obj);
    obj.orderBy = vi.fn(() => obj);
    obj.limit = vi.fn(() => finalize());
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
    delete: vi.fn(() => chain(() => [])),
  };
});

vi.mock('../db', () => ({ db: mockDb, dbReady: Promise.resolve() }));

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

import interventionsRouter from '../routes/soap-intervention-templates';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/soap-intervention-templates', interventionsRouter);
  return app;
}

const sys = (id: number, category: string, name: string, extra: any = {}) => ({
  id, practiceId: null, category, name, description: null,
  isActive: true, isCustom: false, sortOrder: id, ...extra,
});
const custom = (id: number, category: string, name: string, extra: any = {}) => ({
  id, practiceId: 1, category, name, description: null,
  isActive: true, isCustom: true, sortOrder: 9999, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  currentUserRole = 'admin';
  currentUserPracticeId = 1;
  dbState.selectResult = [];
  dbState.insertResult = [];
  dbState.updateResult = [];
  dbState.lastInsertValues = undefined;
  dbState.lastUpdateValues = undefined;
});

describe('SOAP Intervention Templates Routes', () => {
  describe('GET /api/soap-intervention-templates', () => {
    it('groups system and custom items by category', async () => {
      dbState.selectResult = [
        sys(1, 'ADLs', 'Dressing'),
        sys(2, 'Sensory', 'Sensory Swing'),
        custom(10, 'ADLs', 'Custom feeding routine'),
      ];

      const res = await request(buildApp()).get('/api/soap-intervention-templates').expect(200);

      expect(res.body.categories).toHaveLength(2);
      const adls = res.body.categories.find((c: any) => c.category === 'ADLs');
      expect(adls.items.map((i: any) => i.name)).toEqual(['Dressing', 'Custom feeding routine']);
      expect(adls.items[0].isCustom).toBe(false);
      expect(adls.items[1].isCustom).toBe(true);
    });

    it('applies a practice shadow row as a visibility override on the system item', async () => {
      dbState.selectResult = [
        sys(1, 'Sensory', 'Sensory Swing'),
        sys(2, 'Sensory', 'Brushing protocol'),
        // Practice hid "Sensory Swing": shadow row, same category+name, inactive.
        custom(20, 'Sensory', 'Sensory Swing', { isActive: false }),
      ];

      const res = await request(buildApp()).get('/api/soap-intervention-templates').expect(200);

      // Default view: the hidden system item is gone; no duplicate shadow item.
      const names = res.body.categories.flatMap((c: any) => c.items.map((i: any) => i.name));
      expect(names).toEqual(['Brushing protocol']);
    });

    it('includeInactive=true returns hidden system items once, with overrideId', async () => {
      dbState.selectResult = [
        sys(1, 'Sensory', 'Sensory Swing'),
        custom(20, 'Sensory', 'Sensory Swing', { isActive: false }),
      ];

      const res = await request(buildApp())
        .get('/api/soap-intervention-templates?includeInactive=true')
        .expect(200);

      const items = res.body.categories[0].items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: 1,
        name: 'Sensory Swing',
        isCustom: false,
        isActive: false,
        overrideId: 20,
      });
    });

    it('matches shadow rows case-insensitively', async () => {
      dbState.selectResult = [
        sys(1, 'ADLs', 'Dressing'),
        custom(21, 'adls', 'dressing', { isActive: false }),
      ];

      const res = await request(buildApp()).get('/api/soap-intervention-templates').expect(200);
      expect(res.body.categories).toEqual([]);
    });
  });

  describe('POST /api/soap-intervention-templates', () => {
    it('creates a practice custom row (active by default)', async () => {
      dbState.insertResult = [custom(30, 'ADLs', 'New thing')];

      const res = await request(buildApp())
        .post('/api/soap-intervention-templates')
        .send({ category: 'ADLs', name: 'New thing' })
        .expect(200);

      expect(res.body.id).toBe(30);
      expect(dbState.lastInsertValues).toMatchObject({
        practiceId: 1,
        category: 'ADLs',
        name: 'New thing',
        isCustom: true,
        isActive: true,
      });
    });

    it('honors isActive:false (the hide-a-system-default flow)', async () => {
      dbState.insertResult = [custom(31, 'Sensory', 'Sensory Swing', { isActive: false })];

      await request(buildApp())
        .post('/api/soap-intervention-templates')
        .send({ category: 'Sensory', name: 'Sensory Swing', isActive: false })
        .expect(200);

      expect(dbState.lastInsertValues.isActive).toBe(false);
    });

    it('rejects a missing name', async () => {
      const res = await request(buildApp())
        .post('/api/soap-intervention-templates')
        .send({ category: 'ADLs' })
        .expect(400);
      expect(res.body.message).toMatch(/required/i);
    });
  });

  describe('PATCH /api/soap-intervention-templates/:id', () => {
    it('updates a practice-owned row', async () => {
      dbState.selectResult = [custom(10, 'ADLs', 'Old name')];
      dbState.updateResult = [custom(10, 'ADLs', 'New name')];

      const res = await request(buildApp())
        .patch('/api/soap-intervention-templates/10')
        .send({ name: 'New name' })
        .expect(200);

      expect(res.body.name).toBe('New name');
      expect(dbState.lastUpdateValues.name).toBe('New name');
    });

    it('returns 403 for a system default', async () => {
      dbState.selectResult = [sys(1, 'ADLs', 'Dressing')];

      const res = await request(buildApp())
        .patch('/api/soap-intervention-templates/1')
        .send({ name: 'Hacked' })
        .expect(403);
      expect(res.body.message).toMatch(/system default/i);
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/soap-intervention-templates/:id', () => {
    it('deletes a practice-owned row', async () => {
      dbState.selectResult = [custom(10, 'ADLs', 'Mine')];

      const res = await request(buildApp())
        .delete('/api/soap-intervention-templates/10')
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('returns 403 for a system default', async () => {
      dbState.selectResult = [sys(1, 'ADLs', 'Dressing')];

      const res = await request(buildApp())
        .delete('/api/soap-intervention-templates/1')
        .expect(403);
      expect(res.body.message).toMatch(/system default/i);
      expect(mockDb.delete).not.toHaveBeenCalled();
    });
  });
});
