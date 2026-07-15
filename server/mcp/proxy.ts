/**
 * MCP stdio-to-HTTP proxy
 *
 * Bridges Claude Desktop (stdio) to the remote TherapyBill MCP HTTP endpoint.
 * Uses the official MCP SDK transports for reliable message handling.
 *
 * Usage in claude_desktop_config.json:
 *   "command": "node",
 *   "args": ["--import=tsx", "server/mcp/proxy.ts"],
 *   "env": { "THERAPYBILL_API_KEY": "tbai_xxx" }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const API_KEY = process.env.THERAPYBILL_API_KEY || process.env.MCP_API_KEY;
const MCP_URL = process.env.THERAPYBILL_MCP_URL || 'https://app.therapybillai.com/mcp';

if (!API_KEY) {
  process.stderr.write('Error: THERAPYBILL_API_KEY is required\n');
  process.exit(1);
}

async function main() {
  process.stderr.write(`MCP proxy: connecting to ${MCP_URL}\n`);

  // Create the HTTP transport to the remote server
  const url = new URL(MCP_URL);
  const httpTransport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
    },
  });

  // Create stdio transport for Claude Desktop
  const stdioTransport = new StdioServerTransport();

  // Forward messages from stdio (Claude Desktop) to HTTP (remote server)
  stdioTransport.onmessage = async (message) => {
    try {
      process.stderr.write(`proxy -> remote: ${JSON.stringify(message).slice(0, 100)}\n`);
      await httpTransport.send(message);
    } catch (err: any) {
      process.stderr.write(`proxy send error: ${err.message}\n`);
    }
  };

  // Forward messages from HTTP (remote server) to stdio (Claude Desktop)
  httpTransport.onmessage = async (message) => {
    try {
      process.stderr.write(`remote -> proxy: ${JSON.stringify(message).slice(0, 100)}\n`);
      await stdioTransport.send(message);
    } catch (err: any) {
      process.stderr.write(`proxy receive error: ${err.message}\n`);
    }
  };

  httpTransport.onerror = (err) => {
    process.stderr.write(`HTTP transport error: ${err.message}\n`);
  };

  httpTransport.onclose = () => {
    process.stderr.write('HTTP transport closed\n');
    process.exit(0);
  };

  stdioTransport.onclose = () => {
    process.stderr.write('stdio transport closed\n');
    process.exit(0);
  };

  // Start both transports
  await stdioTransport.start();
  await httpTransport.start();

  process.stderr.write('MCP proxy: ready\n');
}

main().catch((err) => {
  process.stderr.write(`MCP proxy fatal: ${err.message}\n`);
  process.exit(1);
});
