/**
 * MCP server authentication.
 *
 * Resolves a McpPracticeContext from environment variables.
 * For stdio mode, MCP_API_KEY + MCP_PRACTICE_ID + MCP_USER_ID are set
 * in the Claude Desktop config or shell environment.
 */

import type { McpPracticeContext } from './types';
import { dbReady } from '../db';

export async function authenticate(): Promise<McpPracticeContext> {
  await dbReady;

  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) {
    throw new Error('MCP_API_KEY environment variable is required');
  }

  const practiceIdStr = process.env.MCP_PRACTICE_ID;
  const userId = process.env.MCP_USER_ID;

  if (!practiceIdStr || !userId) {
    throw new Error(
      'MCP_PRACTICE_ID and MCP_USER_ID environment variables are required',
    );
  }

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
