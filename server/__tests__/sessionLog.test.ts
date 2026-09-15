import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockDb = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('../db', () => ({ getDb: async () => mockDb, db: mockDb }));
vi.mock('../replitAuth', () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.user = { claims: { sub: 'u1' } }; req.userPracticeId = 1; req.userRole = 'admin'; next(); } }));
vi.mock('../middleware/financial-access', () => ({ requireFinancialRole: (_req: any, _res: any, next: any) => next() }));
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../services/cacheService', () => ({ cache: { get: async () => null, set: async () => {} }, CacheKeys: { therapistProductivity: () => 'k' } }));

import analyticsRouter from '../routes/analytics';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRouter);
  return app;
}

// Chainable stub: users query returns therapists; per-therapist agg returns counts.
function chain(result: any) {
  return { from: () => ({ where: () => Promise.resolve(result) }) };
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/analytics/session-log', () => {
  it('tallies completed sessions and evaluations per therapist', async () => {
    mockDb.select
      .mockReturnValueOnce(chain([{ id: 't1', firstName: 'Meg', lastName: 'K', credentials: 'OTR/L' }]))
      .mockReturnValueOnce(chain([{ completedEvaluations: 1, completedSessions: 8, cancelled: 2, noShow: 1 }]));

    const res = await request(buildApp()).get('/api/analytics/session-log?start=2026-09-01&end=2026-09-14');
    expect(res.status).toBe(200);
    expect(res.body.therapists).toHaveLength(1);
    expect(res.body.therapists[0]).toMatchObject({
      therapistName: 'Meg K', completedSessions: 8, completedEvaluations: 1, totalCompleted: 9,
    });
    expect(res.body.totals.totalCompleted).toBe(9);
  });

  it('returns empty totals when there are no therapists', async () => {
    mockDb.select.mockReturnValueOnce(chain([]));
    const res = await request(buildApp()).get('/api/analytics/session-log');
    expect(res.status).toBe(200);
    expect(res.body.therapists).toEqual([]);
    expect(res.body.totals.totalCompleted).toBe(0);
  });
});
