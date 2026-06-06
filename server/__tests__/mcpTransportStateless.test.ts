/**
 * Regression test for the MCP session-affinity bug.
 *
 * The old /mcp handler kept sessions in an in-memory per-process Map. Behind
 * 2 ECS tasks with no ALB stickiness, a session created on one task was unknown
 * to the other, so follow-up requests hung until an MCP -32001 timeout.
 *
 * The fix makes the transport STATELESS: a fresh server + transport per request,
 * no session map. This test asserts the property that proves the fix — a
 * tools/call with NO prior initialize and NO mcp-session-id is handled
 * successfully (under the old code such a request depended on hitting the exact
 * task that owned the session).
 */
import { describe, it, expect, vi } from 'vitest';

// The router builds OAuth issuer URLs from APP_URL/BASE_URL at module load.
// vi.hoisted runs before the static imports below, so set a valid URL here.
vi.hoisted(() => {
  process.env.APP_URL = 'https://test.therapybill.local';
});

// Bearer auth → passthrough that injects a token (no real OAuth in the unit test)
vi.mock('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js', () => ({
  requireBearerAuth: () => (req: any, _res: any, next: any) => {
    req.auth = { token: 'test-token' };
    next();
  },
}));

// OAuth provider is instantiated at module load — stub it out.
vi.mock('../mcp/oauth-provider', () => ({
  TherapyBillOAuthProvider: class {},
}));

// API-key auth → fixed practice context.
vi.mock('../mcp/auth', () => ({
  authenticateKey: vi.fn(async () => ({
    practiceId: 1, userId: 'user-1', role: 'admin', apiKey: 'k',
  })),
}));

// A minimal real MCP server with one trivial tool, so we exercise the real
// StreamableHTTPServerTransport without pulling in the full tool/storage layer.
vi.mock('../mcp/server', async () => {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  return {
    createMcpServer: () => {
      const s = new McpServer({ name: 'test', version: '0.0.0' });
      s.tool('ping', 'health check', {}, async () => ({
        content: [{ type: 'text', text: 'pong' }],
      }));
      return s;
    },
  };
});

import express from 'express';
import request from 'supertest';
import mcpTransportRouter from '../routes/mcp-transport';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/mcp', mcpTransportRouter);
  return app;
}

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': '2025-06-18',
};

describe('MCP /mcp stateless transport', () => {
  it('handles a tools/call with no prior initialize and no session id', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/mcp')
      .set(MCP_HEADERS)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ping', arguments: {} } });

    expect(res.status).toBe(200);
    // enableJsonResponse → direct JSON-RPC result, not an SSE stream.
    const body = typeof res.body === 'object' && Object.keys(res.body).length
      ? res.body
      : JSON.parse(res.text);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.error).toBeUndefined();
    expect(JSON.stringify(body.result)).toContain('pong');
  });

  it('does not issue a server-side session id (stateless)', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/mcp')
      .set(MCP_HEADERS)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ping', arguments: {} } });

    expect(res.status).toBe(200);
    // No session to pin the client to a specific task — that's the whole point.
    expect(res.headers['mcp-session-id']).toBeUndefined();
  });

  it('rejects unauthenticated-context calls cleanly (GET not allowed in stateless mode)', async () => {
    const app = makeApp();
    const res = await request(app).get('/mcp').set(MCP_HEADERS);
    expect(res.status).toBe(405);
  });
});
