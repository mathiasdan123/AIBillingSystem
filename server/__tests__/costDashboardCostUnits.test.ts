/**
 * Pins down the cents-vs-dollars conversion that bit us once.
 *
 * Anthropic's cost_report returns `amount` in minor units (cents for USD).
 * If anyone "fixes" the dashboard to use the raw amount as dollars again,
 * MTD spend will jump 100× — exactly what happened on 2026-05-26 when the
 * dashboard first went live and showed $605 instead of $6.05.
 *
 * This test mounts the real cost-dashboard route, stubs the Anthropic Admin
 * fetch helpers to return a known cents amount, and asserts the headline
 * dollar number comes out divided by 100.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, mockFetchCost, mockFetchUsage } = vi.hoisted(() => ({
  mockStorage: { getUser: vi.fn() },
  mockFetchCost: vi.fn(),
  mockFetchUsage: vi.fn(),
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'admin-1' } };
    next();
  },
}));
vi.mock('../services/anthropicAdminApi', () => ({
  fetchCost: (...args: any[]) => mockFetchCost(...args),
  fetchMessagesUsage: (...args: any[]) => mockFetchUsage(...args),
  clearAdminApiCache: vi.fn(),
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));

import costDashboardRouter from '../routes/cost-dashboard';

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
  // By default return empty data; individual tests can override.
  mockFetchCost.mockResolvedValue({ data: [], has_more: false });
  mockFetchUsage.mockResolvedValue({ data: [], has_more: false });
  app = express();
  app.use(express.json());
  app.use('/api', costDashboardRouter);
});

describe('cost-dashboard cents-to-dollars conversion', () => {
  it('treats Anthropic amount as cents — $6.05 actual renders as 6.05, not 605', async () => {
    // Anthropic returns 605 cents = $6.05. The previous bug rendered this as $605.
    // All four fetches (mtdCost, dailyCost, modelCost, dailyUsage) share the same mock here.
    mockFetchCost.mockImplementation(async (opts: any) => {
      // Only the first MTD-scope call (no groupBy) feeds the headline number.
      if (!opts.groupBy) {
        return { data: [{ starting_at: '2026-05-01', ending_at: '2026-05-27', results: [{ amount: 605, currency: 'USD' }] }], has_more: false };
      }
      return { data: [], has_more: false };
    });

    const res = await request(app).get('/api/admin/cost-dashboard/summary');
    expect(res.status).toBe(200);
    expect(res.body.mtd.spendUsd).toBe(6.05);
    expect(res.body.mtd.usedPct).toBeCloseTo((6.05 / 500) * 100, 1); // ~1.21% of $500
    expect(res.body.mtd.warning).toBe(false); // 1.21% is nowhere near 80% threshold
  });

  it('sums multiple cents rows correctly', async () => {
    mockFetchCost.mockImplementation(async (opts: any) => {
      if (!opts.groupBy) {
        return {
          data: [
            { starting_at: '2026-05-01', ending_at: '2026-05-15', results: [{ amount: 1000, currency: 'USD' }] }, // $10
            { starting_at: '2026-05-15', ending_at: '2026-05-27', results: [{ amount: 2550, currency: 'USD' }] }, // $25.50
          ],
          has_more: false,
        };
      }
      return { data: [], has_more: false };
    });

    const res = await request(app).get('/api/admin/cost-dashboard/summary');
    expect(res.body.mtd.spendUsd).toBe(35.5);
  });

  it('by-model rollup also converts cents to dollars', async () => {
    mockFetchCost.mockImplementation(async (opts: any) => {
      if (opts.groupBy?.includes('description')) {
        return {
          data: [{
            starting_at: '2026-05-01',
            ending_at: '2026-05-27',
            results: [
              { amount: 5000, currency: 'USD', description: 'claude-sonnet-4-5 input tokens' }, // $50
              { amount: 1500, currency: 'USD', description: 'claude-haiku-4-5 input tokens' }, // $15
            ],
          }],
          has_more: false,
        };
      }
      return { data: [], has_more: false };
    });

    const res = await request(app).get('/api/admin/cost-dashboard/summary');
    const sonnet = res.body.spendByModel.find((m: any) => m.model === 'claude-sonnet-4-5');
    const haiku = res.body.spendByModel.find((m: any) => m.model === 'claude-haiku-4-5');
    expect(sonnet.usd).toBe(50);
    expect(haiku.usd).toBe(15);
  });

  it('daily-trend dollars are also divided by 100', async () => {
    let callIdx = 0;
    mockFetchCost.mockImplementation(async (opts: any) => {
      callIdx++;
      // Second call is the 30-day trend.
      if (!opts.groupBy && callIdx === 2) {
        return {
          data: [
            { starting_at: '2026-05-20', ending_at: '2026-05-21', results: [{ amount: 200, currency: 'USD' }] }, // $2
            { starting_at: '2026-05-21', ending_at: '2026-05-22', results: [{ amount: 350, currency: 'USD' }] }, // $3.50
          ],
          has_more: false,
        };
      }
      return { data: [], has_more: false };
    });

    const res = await request(app).get('/api/admin/cost-dashboard/summary');
    expect(res.body.dailyTrend).toHaveLength(2);
    expect(res.body.dailyTrend[0].usd).toBe(2);
    expect(res.body.dailyTrend[1].usd).toBe(3.5);
  });
});
