/**
 * Rate limits on the two root-mounted MCP surfaces that sit outside the /api
 * general limiter (CodeQL #134 / #135):
 *
 *   POST /authorize/callback  — accepts an MCP API key; brute-force surface.
 *   /mcp                      — bearer verification + API-key DB lookup per
 *                               request, even unauthenticated.
 *
 * Redis is stubbed as unavailable so the limiters use their in-memory store,
 * which is what production does when REDIS_URL is unset.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/redisClient', () => ({
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
  clearRateLimitStore,
  stopCleanupInterval,
} from '../middleware/rate-limiter';

/** App that trusts X-Forwarded-For so tests can present distinct client IPs. */
function appWith(limiter: any, handler = (_req: any, res: any) => res.json({ ok: true })) {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.post('/t', limiter, handler);
  app.get('/t', limiter, handler);
  return app;
}

beforeEach(() => {
  clearRateLimitStore();
});

describe('mcpOAuthCallbackLimiter (POST /authorize/callback)', () => {
  it('allows 10 attempts per IP per window, then answers 429 with Retry-After', async () => {
    const app = appWith(mcpOAuthCallbackLimiter);
    for (let i = 0; i < 10; i++) {
      await request(app).post('/t').set('X-Forwarded-For', '203.0.113.5').send({}).expect(200);
    }
    const res = await request(app).post('/t').set('X-Forwarded-For', '203.0.113.5').send({}).expect(429);
    expect(res.body.error).toBe('RATE_LIMIT_EXCEEDED');
    expect(res.body.message).toMatch(/authorization attempts/i);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers['x-ratelimit-limit']).toBe('10');
  });

  it('keys per IP: another address keeps its own budget', async () => {
    const app = appWith(mcpOAuthCallbackLimiter);
    for (let i = 0; i < 10; i++) {
      await request(app).post('/t').set('X-Forwarded-For', '203.0.113.5').send({}).expect(200);
    }
    await request(app).post('/t').set('X-Forwarded-For', '203.0.113.6').send({}).expect(200);
  });

  it('does not share a budget with the login/auth limiter', async () => {
    const { authLimiter } = await import('../middleware/rate-limiter');
    const app = express();
    app.set('trust proxy', true);
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
  it('allows 120 requests per IP per minute, then answers 429', async () => {
    const app = appWith(mcpTransportLimiter);
    for (let i = 0; i < 120; i++) {
      await request(app).post('/t').set('X-Forwarded-For', '203.0.113.50').send({}).expect(200);
    }
    const res = await request(app).post('/t').set('X-Forwarded-For', '203.0.113.50').send({}).expect(429);
    expect(res.body.error).toBe('RATE_LIMIT_EXCEEDED');
    expect(res.headers['x-ratelimit-limit']).toBe('120');
  });

  it('applies to every method, not only POST', async () => {
    const app = appWith(mcpTransportLimiter);
    for (let i = 0; i < 120; i++) {
      await request(app).get('/t').set('X-Forwarded-For', '203.0.113.51').expect(200);
    }
    await request(app).get('/t').set('X-Forwarded-For', '203.0.113.51').expect(429);
  });

  it('a second IP is unaffected by the first one being throttled', async () => {
    const app = appWith(mcpTransportLimiter);
    for (let i = 0; i < 121; i++) {
      await request(app).post('/t').set('X-Forwarded-For', '203.0.113.52').send({});
    }
    await request(app).post('/t').set('X-Forwarded-For', '203.0.113.53').send({}).expect(200);
  });
});

// Keep the in-memory cleanup timer from holding the worker open.
stopCleanupInterval();
