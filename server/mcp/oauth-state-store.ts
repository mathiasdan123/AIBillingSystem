/**
 * Persistence for MCP OAuth 2.1 transient state.
 *
 * DCR client registrations, pending authorize sessions, and one-time
 * authorization codes must survive across ECS tasks: the ALB has no
 * stickiness, so a client that registers on task A routinely lands its
 * /authorize or /token call on task B. In-memory Maps made that flow fail
 * intermittently (same split-brain class as the pre-PR#210 session map).
 *
 * Payloads are AES-256-GCM encrypted at rest (PHI_ENCRYPTION_KEY) because
 * auth-code entries transiently carry the user's raw API key.
 *
 * The interface exists so unit tests can inject an in-memory fake and the
 * OAuth provider logic can be tested without a database.
 */

import { and, eq, gt, lt } from 'drizzle-orm';
import { mcpOauthState } from '@shared/schema';
import { db, dbReady } from '../db';
import { encryptValue, decryptValue } from '../services/phiEncryptionService';
import logger from '../services/logger';

export type OauthStateKind = 'client' | 'session' | 'code';

export interface OauthStateStore {
  /** Upsert a payload under (kind, key) with a TTL. */
  put(kind: OauthStateKind, key: string, payload: unknown, ttlMs: number): Promise<void>;
  /** Read a non-expired payload, or undefined. */
  get(kind: OauthStateKind, key: string): Promise<any | undefined>;
  /**
   * Atomically read-and-delete a non-expired payload (one-time use for auth
   * codes and pending sessions). Returns undefined if absent, expired, or
   * already consumed by a concurrent request.
   */
  take(kind: OauthStateKind, key: string): Promise<any | undefined>;
  /** Delete expired rows. Safe to run concurrently on every task. */
  cleanup(): Promise<void>;
}

export class PgOauthStateStore implements OauthStateStore {
  async put(kind: OauthStateKind, key: string, payload: unknown, ttlMs: number): Promise<void> {
    await dbReady;
    const encryptedPayload = encryptValue(payload);
    if (!encryptedPayload) throw new Error('Failed to encrypt OAuth state payload');
    const expiresAt = new Date(Date.now() + ttlMs);
    await db
      .insert(mcpOauthState)
      .values({ key, kind, encryptedPayload, expiresAt })
      .onConflictDoUpdate({
        target: mcpOauthState.key,
        set: { kind, encryptedPayload, expiresAt },
      });
  }

  async get(kind: OauthStateKind, key: string): Promise<any | undefined> {
    await dbReady;
    const [row] = await db
      .select()
      .from(mcpOauthState)
      .where(and(
        eq(mcpOauthState.key, key),
        eq(mcpOauthState.kind, kind),
        gt(mcpOauthState.expiresAt, new Date()),
      ))
      .limit(1);
    if (!row) return undefined;
    return decryptValue(row.encryptedPayload as any, true);
  }

  async take(kind: OauthStateKind, key: string): Promise<any | undefined> {
    await dbReady;
    // DELETE ... RETURNING is atomic: two concurrent exchanges of the same
    // auth code can never both succeed, even across ECS tasks.
    const rows = await db
      .delete(mcpOauthState)
      .where(and(
        eq(mcpOauthState.key, key),
        eq(mcpOauthState.kind, kind),
        gt(mcpOauthState.expiresAt, new Date()),
      ))
      .returning();
    if (rows.length === 0) return undefined;
    return decryptValue(rows[0].encryptedPayload as any, true);
  }

  async cleanup(): Promise<void> {
    await dbReady;
    try {
      await db.delete(mcpOauthState).where(lt(mcpOauthState.expiresAt, new Date()));
    } catch (err: any) {
      logger.warn('MCP OAuth state cleanup failed', { error: err.message });
    }
  }
}
