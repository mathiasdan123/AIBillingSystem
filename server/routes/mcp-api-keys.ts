/**
 * MCP API Key Management Routes
 *
 * Handles:
 * - POST /api/mcp-api-keys    — Generate a new MCP API key
 * - GET  /api/mcp-api-keys    — List active keys for the practice
 * - DELETE /api/mcp-api-keys/:id — Revoke (soft-delete) a key
 */

import { Router, type Response, type NextFunction } from 'express';
import * as crypto from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db';
import { mcpApiKeys } from '@shared/schema';
import { isAuthenticated } from '../replitAuth';
import { encryptField } from '../services/phiEncryptionService';
import { logAuditEvent } from '../middleware/auditMiddleware';
import logger from '../services/logger';
import { storage } from '../storage';

const router = Router();

// Admin-only middleware (same pattern as auth.ts)
const isAdmin = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const user = await storage.getUser(req.user.claims.sub);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }
    next();
  } catch (error) {
    logger.error('Error checking admin role for MCP keys', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to verify permissions' });
  }
};

/**
 * POST /api/mcp-api-keys — Generate a new MCP API key
 */
router.post('/', isAuthenticated, isAdmin, async (req: any, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
      return res.status(400).json({ message: 'Name is required (1-100 characters)' });
    }

    const userId = req.user.claims.sub;
    const practiceId = req.userPracticeId;
    if (!practiceId) {
      return res.status(400).json({ message: 'User not assigned to a practice' });
    }

    // Generate the API key: tbai_ prefix + 32 random bytes hex = 69 chars
    const rawKey = 'tbai_' + crypto.randomBytes(32).toString('hex');
    const keyPrefix = rawKey.substring(0, 12); // e.g. "tbai_a3f8b2c"
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const encryptedKey = encryptField(rawKey);

    const [inserted] = await db.insert(mcpApiKeys).values({
      practiceId,
      userId,
      name: name.trim(),
      keyPrefix,
      keyHash,
      encryptedKey,
    }).returning();

    // Audit log
    await logAuditEvent({
      eventCategory: 'mcp_api_key',
      eventType: 'mcp_api_key_created',
      resourceType: 'mcp_api_key',
      userId,
      practiceId,
      details: { keyId: inserted.id, keyPrefix },
      success: true,
    }).catch((err: any) => logger.error('Failed to write MCP key audit log', { error: err.message }));

    res.status(201).json({
      id: inserted.id,
      name: inserted.name,
      keyPrefix: inserted.keyPrefix,
      key: rawKey, // Only returned once on creation
      createdAt: inserted.createdAt,
    });
  } catch (error) {
    logger.error('Failed to create MCP API key', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create API key' });
  }
});

/**
 * GET /api/mcp-api-keys — List active keys for the practice
 */
router.get('/', isAuthenticated, isAdmin, async (req: any, res: Response) => {
  try {
    const practiceId = req.userPracticeId;
    if (!practiceId) {
      return res.status(400).json({ message: 'User not assigned to a practice' });
    }

    const keys = await db
      .select({
        id: mcpApiKeys.id,
        name: mcpApiKeys.name,
        keyPrefix: mcpApiKeys.keyPrefix,
        createdAt: mcpApiKeys.createdAt,
        lastUsedAt: mcpApiKeys.lastUsedAt,
      })
      .from(mcpApiKeys)
      .where(and(
        eq(mcpApiKeys.practiceId, practiceId),
        isNull(mcpApiKeys.revokedAt),
      ))
      .orderBy(mcpApiKeys.createdAt);

    res.json(keys);
  } catch (error) {
    logger.error('Failed to list MCP API keys', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to list API keys' });
  }
});

/**
 * DELETE /api/mcp-api-keys/:id — Revoke (soft-delete) a key
 */
router.delete('/:id', isAuthenticated, isAdmin, async (req: any, res: Response) => {
  try {
    const keyId = parseInt(req.params.id, 10);
    if (isNaN(keyId)) {
      return res.status(400).json({ message: 'Invalid key ID' });
    }

    const practiceId = req.userPracticeId;
    if (!practiceId) {
      return res.status(400).json({ message: 'User not assigned to a practice' });
    }

    const [updated] = await db
      .update(mcpApiKeys)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(mcpApiKeys.id, keyId),
        eq(mcpApiKeys.practiceId, practiceId),
        isNull(mcpApiKeys.revokedAt),
      ))
      .returning();

    if (!updated) {
      return res.status(404).json({ message: 'API key not found or already revoked' });
    }

    const userId = req.user.claims.sub;
    await logAuditEvent({
      eventCategory: 'mcp_api_key',
      eventType: 'mcp_api_key_revoked',
      resourceType: 'mcp_api_key',
      userId,
      practiceId,
      details: { keyId, keyPrefix: updated.keyPrefix },
      success: true,
    }).catch((err: any) => logger.error('Failed to write MCP key revoke audit log', { error: err.message }));

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to revoke MCP API key', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to revoke API key' });
  }
});

export default router;
