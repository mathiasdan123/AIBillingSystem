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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
// Session map: sessionId -> { server, transport, context }
// ---------------------------------------------------------------------------

interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  context: McpPracticeContext;
}
const sessions = new Map<string, McpSession>();

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
// ---------------------------------------------------------------------------

router.post('/', bearerAuth, async (req: Request, res: Response) => {
  try {
    // The bearer auth middleware validated the token and set req.auth
    const token = req.auth?.token;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check for existing session
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Reuse existing session
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // New session: authenticate the API key for practice context
    let context: McpPracticeContext;
    try {
      context = await authenticateKey(token);
    } catch (err: any) {
      return res.status(401).json({ error: err.message || 'Authentication failed' });
    }

    // Create a new MCP server and transport for this session
    const server = createMcpServer(context);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    await server.connect(transport);

    // Store session after transport has an ID
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        sessions.delete(sid);
        logger.info('MCP HTTP session closed', { sessionId: sid, practiceId: context.practiceId });
      }
    };

    // Handle the initial request
    await transport.handleRequest(req, res, req.body);

    // Store session for future requests
    const newSessionId = transport.sessionId;
    if (newSessionId) {
      sessions.set(newSessionId, { server, transport, context });
      logger.info('MCP HTTP session created', { sessionId: newSessionId, practiceId: context.practiceId });
    }
  } catch (error) {
    logger.error('MCP transport error', { error: error instanceof Error ? error.message : String(error) });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ---------------------------------------------------------------------------
// GET /mcp — SSE endpoint for server-initiated messages (with Bearer auth)
// ---------------------------------------------------------------------------

router.get('/', bearerAuth, async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
    return;
  }
  res.status(400).json({ error: 'No active session. Send a POST request first.' });
});

// ---------------------------------------------------------------------------
// DELETE /mcp — Close an MCP session (with Bearer auth)
// ---------------------------------------------------------------------------

router.delete('/', bearerAuth, async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
    sessions.delete(sessionId);
    return;
  }
  res.status(400).json({ error: 'No active session.' });
});

// ---------------------------------------------------------------------------
// Clean up stale sessions every 30 minutes
// ---------------------------------------------------------------------------

setInterval(() => {
  if (sessions.size > 0) {
    logger.info(`MCP HTTP sessions active: ${sessions.size}`);
  }
}, 30 * 60 * 1000);

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
