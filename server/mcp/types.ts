/**
 * Shared types for the TherapyBill AI MCP server.
 */

export interface McpPracticeContext {
  practiceId: number;
  userId: string;
  role: string;
  apiKey?: string;
}

export interface McpToolResult {
  success: boolean;
  data: unknown;
  error?: string;
  containsPhi?: boolean;
}
