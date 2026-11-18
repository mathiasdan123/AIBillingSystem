/**
 * Rate limits on the two root-mounted MCP surfaces that sit outside the /api
 * general limiter (CodeQL #134 / #135):
 *
 *   POST /authorize/callback  — accepts an MCP API key; brute-force surface.
 *   /mcp                      — bearer verification + API-key DB lookup per
 *                               request, even unauthenticated.
 *
 * They are express-rate-limit instances (like the app-level limiters in
 * index.ts). Redis is stubbed as absent so the in-memory store is used, which
 * is what production does when REDIS_URL is unset. Each test uses its own
 * client IPs because the in-memory store lives for the module's lifetime.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/redisClient', () => ({
  initRedisClient: () => null,
  getRedisClient: () => null,
  isRedisReady: () => false,
  isRedisConfigured: () => false,
}));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  mcpOAuthCallbackLimiter,
  mcpTransportLimiter,
  MCP_OAUTH_CALLBACK_MAX,
  MCP_TRANSPORT_MAX_PER_MIN,
} from '../middleware/mcpRateLimits';
import { authLimiter } from '../middleware/rate-limiter';

/** One proxy hop, as in production, so X-Forwarded-For sets req.ip. */
function appWith(limiter: any) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  const ok = (_req: any, res: any) => res.json({ ok: true });
  app.post('/t', limiter, ok);
  app.get('/t', limiter, ok);
  app.delete('/t', limiter, ok);
  return app;
}

describe('mcpOAuthCallbackLimiter (POST /authorize/callback)', () => {
  it('has the documented budget', () => {
    expect(MCP_OAUTH_CALLBACK_MAX).toBe(10);
  });

  it('allows the budget per IP per window, then answers 429 with Retry-After', async () => {
    const app = appWith(mcpOAuthCallbackLimiter);
    for (let i = 0; i < MCP_OAUTH_CALLBACK_MAX; i++) {
      await request(app).post('/t').set('X-Forwarded-For', '203.0.113.5').send({}).expect(200);
    }
    const res = await request(app).post('/t').set('X-Forwarded-For', '203.0.113.5').send({}).expect(429);
    expect(res.body.error).toMatch(/authorization attempts/i);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers['ratelimit-limit']).toBe(String(MCP_OAUTH_CALLBACK_MAX));
  });

  it('keys per IP: another address keeps its own budget', async () => {
    const app = appWith(mcpOAuthCallbackLimiter);
    for (let i = 0; i <= MCP_OAUTH_CALLBACK_MAX; i++) {
      await request(app).post('/t').set('X-Forwarded-For', '203.0.113.15').send({});
    }
    await request(app).post('/t').set('X-Forwarded-For', '203.0.113.16').send({}).expect(200);
  });

  it('does not share a budget with the login/auth limiter', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.post('/login', authLimiter, (_req, res) => res.json({ ok: true }));
    app.post('/cb', mcpOAuthCallbackLimiter, (_req, res) => res.json({ ok: true }));
    // Exhaust the auth limiter (5 / 15 min) from one IP...
    for (let i = 0; i < 5; i++) await request(app).post('/login').set('X-Forwarded-For', '198.51.100.9').expect(200);
    await request(app).post('/login').set('X-Forwarded-For', '198.51.100.9').expect(429);
    // ...the callback still has its own full budget for that IP.
    await request(app).post('/cb').set('X-Forwarded-For', '198.51.100.9').expect(200);
  });
});

describe('mcpTransportLimiter (/mcp)', () => {
  it('has the documented budget', () => {
    expect(MCP_TRANSPORT_MAX_PER_MIN).toBe(120);
  });

  it('allows the budget per IP per minute, then answers 429', async () => {
    const app = appWith(mcpTransportLimiter);
    for (let i = 0; i < MCP_TRANSPORT_MAX_PER_MIN; i++) {
      await request(app).post('/t').set('X-Forwarded-For', '203.0.113.50').send({}).expect(200);
    }
    const res = await request(app).post('/t').set('X-Forwarded-For', '203.0.113.50').send({}).expect(429);
    expect(res.body.error).toMatch(/Too many MCP requests/);
    expect(res.headers['ratelimit-limit']).toBe(String(MCP_TRANSPORT_MAX_PER_MIN));
  });

  it('counts every method against the same per-IP budget', async () => {
    const app = appWith(mcpTransportLimiter);
    for (let i = 0; i < MCP_TRANSPORT_MAX_PER_MIN; i++) {
      const m = i % 3 === 0 ? 'get' : i % 3 === 1 ? 'delete' : 'post';
      await (request(app) as any)[m]('/t').set('X-Forwarded-For', '203.0.113.51').expect(200);
    }
    await request(app).get('/t').set('X-Forwarded-For', '203.0.113.51').expect(429);
  });

  it('a second IP is unaffected by the first one being throttled', async () => {
    const app = appWith(mcpTransportLimiter);
    for (let i = 0; i <= MCP_TRANSPORT_MAX_PER_MIN; i++) {
      await request(app).post('/t').set('X-Forwarded-For', '203.0.113.52').send({});
    }
    await request(app).post('/t').set('X-Forwarded-For', '203.0.113.53').send({}).expect(200);
  });
});
