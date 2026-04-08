/**
 * MCP server authentication.
 *
 * Resolves a McpPracticeContext by validating the API key against the database.
 * Falls back to env-var-based auth for local development / backward compatibility.
 *
 * For stdio mode: MCP_API_KEY is set in the Claude Desktop config.
 * For HTTP mode: the key is passed via authenticateKey() from the route handler.
 */

import * as crypto from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import type { McpPracticeContext } from './types';
import { db, dbReady } from '../db';
import { mcpApiKeys } from '@shared/schema';
import logger from '../services/logger';

/**
 * Authenticate an MCP API key against the database.
 * Used by both stdio (env var) and HTTP (header) transports.
 */
export async function authenticateKey(apiKey: string): Promise<McpPracticeContext> {
  await dbReady;

  // Hash the incoming key for lookup
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  // Look up in database
  const [keyRecord] = await db
    .select()
    .from(mcpApiKeys)
    .where(and(
      eq(mcpApiKeys.keyHash, keyHash),
      isNull(mcpApiKeys.revokedAt),
    ))
    .limit(1);

  if (keyRecord) {
    // Update lastUsedAt asynchronously (fire-and-forget)
    db.update(mcpApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(mcpApiKeys.id, keyRecord.id))
      .then(() => {})
      .catch((err: any) => logger.error('Failed to update MCP key lastUsedAt', { error: err.message }));

    return {
      practiceId: keyRecord.practiceId,
      userId: keyRecord.userId,
      role: 'admin',
      apiKey,
    };
  }

  // Key not found in DB — fall back to env-var auth for backward compatibility
  return authenticateEnvVarFallback(apiKey);
}

/**
 * Legacy env-var-based authentication fallback.
 * Used when the key is not found in the database (local dev, migration period).
 */
function authenticateEnvVarFallback(apiKey: string): McpPracticeContext {
  const practiceIdStr = process.env.MCP_PRACTICE_ID;
  const userId = process.env.MCP_USER_ID;

  if (!practiceIdStr || !userId) {
    throw new Error(
      'Invalid or revoked MCP API key. If using legacy env-var auth, set MCP_PRACTICE_ID and MCP_USER_ID.',
    );
  }

  logger.warn('MCP auth: using legacy env-var fallback. Generate a key via Settings > MCP Integration.');

  const practiceId = parseInt(practiceIdStr, 10);
  if (isNaN(practiceId) || practiceId <= 0) {
    throw new Error('MCP_PRACTICE_ID must be a positive integer');
  }

  return {
    practiceId,
    userId,
    role: process.env.MCP_USER_ROLE || 'admin',
    apiKey,
  };
}

/**
 * Main authenticate function for stdio transport (reads key from env).
 */
export async function authenticate(): Promise<McpPracticeContext> {
  const apiKey = process.env.MCP_API_KEY || process.env.THERAPYBILL_API_KEY;
  if (!apiKey) {
    throw new Error('MCP_API_KEY environment variable is required');
  }

  return authenticateKey(apiKey);
}
