/**
 * TherapyBill AI MCP Server — Entry Point
 *
 * Standalone process that exposes TherapyBill AI functionality as MCP tools.
 * Supports stdio (Claude Desktop) and streamable HTTP transports.
 *
 * Usage:
 *   stdio:  node --import=tsx server/mcp/index.ts
 *   http:   MCP_TRANSPORT=streamable-http node --import=tsx server/mcp/index.ts
 *
 * Required env vars: MCP_API_KEY, MCP_PRACTICE_ID, MCP_USER_ID, DATABASE_URL, PHI_ENCRYPTION_KEY
 */

import { dbReady } from '../db';
import { authenticate } from './auth';
import { createMcpServer } from './server';
import logger from '../services/logger';

async function main() {
  // Wait for database connection pool to initialize
  await dbReady;

  // Authenticate and resolve practice context
  const context = await authenticate();
  logger.info('MCP server authenticated', {
    practiceId: context.practiceId,
    userId: context.userId,
    role: context.role,
  });

  // Create MCP server with all tools
  const server = createMcpServer(context);

  // Select transport
  const transportMode = process.env.MCP_TRANSPORT || 'stdio';

  if (transportMode === 'stdio') {
    const { StdioServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/stdio.js'
    );
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('MCP server running on stdio transport');
  } else if (transportMode === 'streamable-http') {
    const express = (await import('express')).default;
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );

    const app = express();
    app.use(express.json());

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    app.post('/mcp', async (req, res) => {
      await transport.handleRequest(req, res, req.body);
    });

    app.get('/mcp', async (req, res) => {
      res.writeHead(405).end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
    });

    app.delete('/mcp', async (req, res) => {
      res.writeHead(405).end(JSON.stringify({ error: 'Method not allowed.' }));
    });

    await server.connect(transport);

    const port = parseInt(process.env.MCP_PORT || '3100', 10);
    app.listen(port, () => {
      logger.info(`MCP server running on streamable HTTP transport at port ${port}`);
    });
  } else {
    throw new Error(
      `Unknown MCP_TRANSPORT: ${transportMode}. Use "stdio" or "streamable-http".`,
    );
  }
}

main().catch((err) => {
  console.error('MCP server failed to start:', err.message);
  process.exit(1);
});
