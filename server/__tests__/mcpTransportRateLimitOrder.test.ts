/**
 * The /mcp rate limiter must run BEFORE bearer auth, so a throttled caller
 * never triggers a token verification or an API-key database lookup
 * (CodeQL #135). Mirrors mcpTransportStateless.test.ts's module stubs and
 * counts how often the (stubbed) bearer auth and key lookup are reached.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.APP_URL = 'https://test.therapybill.local';
  // A tiny budget so the test does not need 120 requests.
  process.env.RATE_LIMIT_MAX_MCP_TRANSPORT_PER_MIN = '3';
});

const { bearerCalls, authenticateKey } = vi.hoisted(() => ({
  bearerCalls: { n: 0 },
  authenticateKey: vi.fn(async () => ({ practiceId: 1, userId: 'user-1', role: 'admin', apiKey: 'k' })),
}));

vi.mock('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js', () => ({
  requireBearerAuth: () => (req: any, _res: any, next: any) => {
    bearerCalls.n++;
    req.auth = { token: 'test-token' };
    next();
  },
}));
vi.mock('../mcp/oauth-provider', () => ({ TherapyBillOAuthProvider: class {} }));
vi.mock('../mcp/auth', () => ({ authenticateKey }));
vi.mock('../mcp/server', async () => {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  return {
    createMcpServer: () => {
      const s = new McpServer({ name: 'test', version: '0.0.0' });
      s.tool('ping', 'health check', {}, async () => ({ content: [{ type: 'text', text: 'pong' }] }));
      return s;
    },
  };
});
vi.mock('../services/redisClient', () => ({
  initRedisClient: () => null,
  getRedisClient: () => null,
  isRedisReady: () => false,
  isRedisConfigured: () => false,
}));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import express from 'express';
import request from 'supertest';
import mcpTransportRouter from '../routes/mcp-transport';
import { mcpTransportLimiter } from '../middleware/mcpRateLimits';

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': '2025-06-18',
};
const PING = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ping', arguments: {} } };

function makeApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/mcp', mcpTransportRouter);
  return app;
}

beforeEach(async () => {
  // express-rate-limit's in-memory store lives for the module; reset the IPs these tests use.
  for (const ip of ['203.0.113.77', '203.0.113.78']) await mcpTransportLimiter.resetKey(ip);
  bearerCalls.n = 0;
  authenticateKey.mockClear();
});

describe('/mcp rate limiter ordering', () => {
  it('throttled requests are answered 429 before bearer auth or the key lookup run', async () => {
    const app = makeApp();
    for (let i = 0; i < 3; i++) {
      await request(app).post('/mcp').set(MCP_HEADERS).set('X-Forwarded-For', '203.0.113.77').send(PING).expect(200);
    }
    expect(bearerCalls.n).toBe(3);
    expect(authenticateKey).toHaveBeenCalledTimes(3);

    const res = await request(app).post('/mcp').set(MCP_HEADERS).set('X-Forwarded-For', '203.0.113.77').send(PING).expect(429);
    expect(res.body.error).toMatch(/Too many MCP requests/);
    // The fourth request never reached auth or the database.
    expect(bearerCalls.n).toBe(3);
    expect(authenticateKey).toHaveBeenCalledTimes(3);
  });

  it('GET and DELETE count against the same per-IP budget', async () => {
    const app = makeApp();
    await request(app).get('/mcp').set('X-Forwarded-For', '203.0.113.78').expect(405);
    await request(app).delete('/mcp').set('X-Forwarded-For', '203.0.113.78').expect(405);
    await request(app).get('/mcp').set('X-Forwarded-For', '203.0.113.78').expect(405);
    await request(app).get('/mcp').set('X-Forwarded-For', '203.0.113.78').expect(429);
  });
});

