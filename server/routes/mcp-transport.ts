/**
 * MCP Streamable HTTP Transport Route with OAuth 2.1 Authentication
 *
 * Supports two authentication modes:
 *   1. OAuth 2.1 (Claude Desktop Connectors) — full flow with /.well-known discovery,
 *      dynamic client registration, /authorize, /token, and Bearer token on /mcp.
 *   2. Direct Bearer token — existing API key passed as Authorization: Bearer <api-key>
 *
 * Claude Desktop (and other MCP clients) connect via the Connectors UI at:
 *   URL: https://app.therapybillai.com/mcp
 *
 * The SDK's mcpAuthRouter handles:
 *   - /.well-known/oauth-protected-resource/mcp  (RFC 9728 discovery)
 *   - /.well-known/oauth-authorization-server     (RFC 8414 metadata)
 *   - /register   (RFC 7591 Dynamic Client Registration)
 *   - /authorize  (OAuth 2.1 authorization endpoint)
 *   - /token      (OAuth 2.1 token endpoint)
 *   - /revoke     (Token revocation)
 */

import { Router, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { TherapyBillOAuthProvider } from '../mcp/oauth-provider';
import { authenticateKey } from '../mcp/auth';
import { createMcpServer } from '../mcp/server';
import logger from '../services/logger';
import type { McpPracticeContext } from '../mcp/types';

const router = Router();

// ---------------------------------------------------------------------------
// OAuth 2.1 provider (singleton)
// ---------------------------------------------------------------------------

const oauthProvider = new TherapyBillOAuthProvider();

// Determine base URL for the OAuth issuer/resource server
const BASE_URL = process.env.APP_URL || process.env.BASE_URL || 'https://app.therapybillai.com';
const issuerUrl = new URL(BASE_URL);
const mcpServerUrl = new URL('/mcp', BASE_URL);

// ---------------------------------------------------------------------------
// Bearer auth middleware (validates OAuth access tokens AND direct API keys)
// ---------------------------------------------------------------------------

const bearerAuth = requireBearerAuth({
  verifier: oauthProvider,
  requiredScopes: [],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
});

// ---------------------------------------------------------------------------
// POST /mcp — Handle MCP JSON-RPC requests (with Bearer auth)
//
// STATELESS transport: a fresh McpServer + StreamableHTTPServerTransport is
// created per request and torn down when the response finishes. We deliberately
// do NOT keep a server-side session map.
//
// Why: the app runs 2+ ECS tasks behind an ALB with no stickiness. The previous
// implementation stored sessions in an in-memory per-process Map keyed by
// mcp-session-id. A session created on task A could not be found when the ALB
// round-robined a follow-up request to task B — task B silently spun up a new,
// uninitialized session, and the response never correlated back to the client's
// request id, hanging it until an MCP -32001 timeout. Statelessness makes every
// request self-contained, so it works on any task. (The SDK requires a fresh
// transport per request in stateless mode — reusing one collides message ids.)
// ---------------------------------------------------------------------------

router.post('/', bearerAuth, async (req: Request, res: Response) => {
  // The bearer auth middleware validated the token and set req.auth
  const token = req.auth?.token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Authenticate the API key / OAuth token for the practice context
  let context: McpPracticeContext;
  try {
    context = await authenticateKey(token);
  } catch (err: any) {
    return res.status(401).json({ error: err.message || 'Authentication failed' });
  }

  const server = createMcpServer(context);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode — no server-side session
    enableJsonResponse: true,      // direct JSON request/response, no SSE stream
  });

  // Tear down the per-request server + transport once the response is done,
  // whether it finished normally or the client disconnected.
  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error('MCP transport error', { error: error instanceof Error ? error.message : String(error) });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ---------------------------------------------------------------------------
// GET / DELETE /mcp — not supported in stateless mode
//
// There is no long-lived server-side session to attach an SSE stream to or to
// delete, so these return 405 rather than referencing a session map.
// ---------------------------------------------------------------------------

router.get('/', bearerAuth, (_req: Request, res: Response) => {
  res.status(405).json({ error: 'Method not allowed in stateless mode. Use POST.' });
});

router.delete('/', bearerAuth, (_req: Request, res: Response) => {
  res.status(405).json({ error: 'Method not allowed in stateless mode.' });
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** The OAuth provider instance (needed for the /authorize/callback route). */
export { oauthProvider };

/** The auth router to mount at the app root (serves well-known, authorize, token, register). */
export function getMcpAuthRouter() {
  return mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl,
    baseUrl: issuerUrl,
    resourceServerUrl: mcpServerUrl,
    scopesSupported: ['mcp:tools'],
    resourceName: 'TherapyBill AI MCP Server',
    serviceDocumentationUrl: new URL('https://app.therapybillai.com/settings/mcp-integration'),
  });
}

export default router;
