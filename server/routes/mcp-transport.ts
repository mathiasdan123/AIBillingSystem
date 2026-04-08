/**
 * MCP Streamable HTTP Transport Route
 *
 * Mounts the MCP server on the main Express app at POST /mcp.
 * Claude Desktop (and other MCP clients) connect here with:
 *   { "url": "https://app.therapybillai.com/mcp", "headers": { "Authorization": "Bearer tbai_xxx" } }
 *
 * Each authenticated API key gets its own McpServer + transport session.
 */

import { Router, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authenticateKey } from '../mcp/auth';
import { createMcpServer } from '../mcp/server';
import logger from '../services/logger';
import type { McpPracticeContext } from '../mcp/types';

const router = Router();

// Session map: sessionId -> { server, transport, context }
interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  context: McpPracticeContext;
}
const sessions = new Map<string, McpSession>();

/**
 * Extract Bearer token from Authorization header.
 */
function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

/**
 * POST /mcp — Handle MCP JSON-RPC requests
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const apiKey = extractBearerToken(req);
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer <api-key>' });
    }

    // Check for existing session
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Reuse existing session
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // New session: authenticate and create server
    let context: McpPracticeContext;
    try {
      context = await authenticateKey(apiKey);
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

/**
 * GET /mcp — SSE endpoint for server-initiated messages (optional)
 */
router.get('/', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
    return;
  }
  res.status(400).json({ error: 'No active session. Send a POST request first.' });
});

/**
 * DELETE /mcp — Close an MCP session
 */
router.delete('/', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
    sessions.delete(sessionId);
    return;
  }
  res.status(400).json({ error: 'No active session.' });
});

// Clean up stale sessions every 30 minutes
setInterval(() => {
  // Sessions are cleaned up via transport.onclose, but this is a safety net
  if (sessions.size > 0) {
    logger.info(`MCP HTTP sessions active: ${sessions.size}`);
  }
}, 30 * 60 * 1000);

export default router;
