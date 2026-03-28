/**
 * Tests for server/routes/admin.ts
 *
 * Covers:
 *  - POST /api/admin/cache/clear  — requires admin role
 *  - GET  /api/admin/cache/stats  — requires admin role
 *  - GET  /api/admin/payer-integrations  — requires admin or billing role
 *  - POST /api/admin/payer-credentials  — requires admin or billing role
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Storage mock — use vi.hoisted so the object is available when vi.mock hoists
// ---------------------------------------------------------------------------
const mockStorage = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAllPayerCredentialsList: vi.fn(),
  upsertPayerCredentials: vi.fn(),
  getPayerCredentials: vi.fn(),
  updatePayerHealthStatus: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock('../storage', () => ({ storage: mockStorage }));

// ---------------------------------------------------------------------------
// Cache service mock
// ---------------------------------------------------------------------------
const mockCache = vi.hoisted(() => ({
  clear: vi.fn().mockResolvedValue(undefined),
  getStats: vi.fn().mockReturnValue({ backend: 'memory', memoryEntries: 42 }),
}));

vi.mock('../services/cacheService', () => ({ cache: mockCache }));

// ---------------------------------------------------------------------------
// Scheduler mock (used by hard-delete route)
// ---------------------------------------------------------------------------
vi.mock('../scheduler', () => ({
  triggerHardDeletionNow: vi.fn().mockResolvedValue({ deletedCount: 0, errors: [] }),
}));

// ---------------------------------------------------------------------------
// StediAdapter mock
// ---------------------------------------------------------------------------
vi.mock('../payer-integrations/adapters/payers/StediAdapter', () => ({
  StediAdapter: vi.fn().mockImplementation(() => ({
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 5 }),
  })),
}));

// ---------------------------------------------------------------------------
// replitAuth mock — role is controlled per-test via the variable below
// ---------------------------------------------------------------------------
let currentUserRole = 'admin';

vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'test-admin-1' } };
    req.userPracticeId = 1;
    req.userRole = currentUserRole;
    next();
  },
  setupAuth: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Logger mock
// ---------------------------------------------------------------------------
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import router under test
// ---------------------------------------------------------------------------
import adminRouter from '../routes/admin';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', adminRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Admin Routes (/api/admin)', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    currentUserRole = 'admin';
    app = buildApp();
  });

  // =========================================================================
  // Cache endpoints
  // =========================================================================

  describe('POST /api/admin/cache/clear', () => {
    it('should clear the cache and return stats for an admin user', async () => {
      mockStorage.getUser.mockResolvedValue({ id: 'test-admin-1', role: 'admin' });

      const res = await request(app)
        .post('/api/admin/cache/clear')
        .expect(200);

      expect(res.body.message).toBe('Cache cleared successfully');
      expect(res.body.stats).toMatchObject({ backend: 'memory', memoryEntries: 42 });
      expect(mockCache.clear).toHaveBeenCalledOnce();
    });

    it('should return 403 when user is not admin', async () => {
      currentUserRole = 'therapist';
      app = buildApp();
      mockStorage.getUser.mockResolvedValue({ id: 'test-admin-1', role: 'therapist' });

      const res = await request(app)
        .post('/api/admin/cache/clear')
        .expect(403);

      expect(res.body.message).toMatch(/Admin role required/i);
      expect(mockCache.clear).not.toHaveBeenCalled();
    });

    it('should return 403 when user is billing role (cache clear is admin-only)', async () => {
      currentUserRole = 'billing';
      app = buildApp();
      mockStorage.getUser.mockResolvedValue({ id: 'test-admin-1', role: 'billing' });

      const res = await request(app)
        .post('/api/admin/cache/clear')
        .expect(403);

      expect(mockCache.clear).not.toHaveBeenCalled();
    });

    it('should return 500 when cache.clear throws', async () => {
      mockStorage.getUser.mockResolvedValue({ id: 'test-admin-1', role: 'admin' });
      mockCache.clear.mockRejectedValueOnce(new Error('Redis unavailable'));

      const res = await request(app)
        .post('/api/admin/cache/clear')
        .expect(500);

      expect(res.body.message).toBe('Failed to clear cache');
    });
  });

  describe('GET /api/admin/cache/stats', () => {
    it('should return cache stats for an admin user', async () => {
      mockStorage.getUser.mockResolvedValue({ id: 'test-admin-1', role: 'admin' });

      const res = await request(app)
        .get('/api/admin/cache/stats')
        .expect(200);

      expect(res.body).toMatchObject({ backend: 'memory', memoryEntries: 42 });
      expect(mockCache.getStats).toHaveBeenCalledOnce();
    });

    it('should return 403 for non-admin users', async () => {
      currentUserRole = 'therapist';
      app = buildApp();
      mockStorage.getUser.mockResolvedValue({ id: 'test-admin-1', role: 'therapist' });

      const res = await request(app)
        .get('/api/admin/cache/stats')
        .expect(403);

      expect(res.body.message).toMatch(/Admin role required/i);
      expect(mockCache.getStats).not.toHaveBeenCalled();
    });

    it('should return 500 when getStats throws', async () => {
      mockStorage.getUser.mockResolvedValue({ id: 'test-admin-1', role: 'admin' });
      mockCache.getStats.mockImplementationOnce(() => { throw new Error('Stats error'); });

      const res = await request(app)
        .get('/api/admin/cache/stats')
        .expect(500);

      expect(res.body.message).toBe('Failed to fetch cache stats');
    });
  });

  // =========================================================================
  // Payer integrations
  // =========================================================================

  describe('GET /api/admin/payer-integrations', () => {
    it('should return payer integrations list for admin', async () => {
      mockStorage.getUser.mockResolvedValue({ id: 'test-admin-1', role: 'admin' });
      mockStorage.getAllPayerCredentialsList.mockResolvedValue([
        { id: 1, payerName: 'stedi', status: 'healthy' },
      ]);

      const res = await request(app)
        .get('/api/admin/payer-integrations')
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].payerName).toBe('stedi');
    });

    it('should return payer integrations list for billing role', async () => {
      currentUserRole = 'billing';
      app = buildApp();
      mockStorage.getUser.mockResolvedValue({ id: 'test-admin-1', role: 'billing' });
      mockStorage.getAllPayerCredentialsList.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/admin/payer-integrations')
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should return 403 for therapist role', async () => {
      currentUserRole = 'therapist';
      app = buildApp();
      mockStorage.getUser.mockResolvedValue({ id: 'test-admin-1', role: 'therapist' });

      const res = await request(app)
        .get('/api/admin/payer-integrations')
        .expect(403);

      expect(res.body.message).toMatch(/Admin or billing role required/i);
    });
  });

  describe('POST /api/admin/payer-credentials', () => {
    it('should save payer credentials for admin', async () => {
      mockStorage.getUser.mockResolvedValue({ id: 'test-admin-1', role: 'admin' });
      mockStorage.upsertPayerCredentials.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/admin/payer-credentials')
        .send({ payerName: 'stedi', apiKey: 'test_api_key_123' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockStorage.upsertPayerCredentials).toHaveBeenCalledWith(1, {
        payerName: 'stedi',
        apiKey: 'test_api_key_123',
      });
    });

    it('should return 403 for therapist role', async () => {
      currentUserRole = 'therapist';
      app = buildApp();
      mockStorage.getUser.mockResolvedValue({ id: 'test-admin-1', role: 'therapist' });

      const res = await request(app)
        .post('/api/admin/payer-credentials')
        .send({ payerName: 'stedi', apiKey: 'key' })
        .expect(403);

      expect(mockStorage.upsertPayerCredentials).not.toHaveBeenCalled();
    });
  });
});
