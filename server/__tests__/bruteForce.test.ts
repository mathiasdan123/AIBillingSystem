import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock Redis client — not available in tests
vi.mock('../services/redisClient', () => ({
  getRedisClient: vi.fn(() => null),
  isRedisReady: vi.fn(() => false),
  initRedisClient: vi.fn(() => null),
  shutdownRedis: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    audit: vi.fn(),
  },
}));

import {
  incrementGlobalFailedAuth,
  isSiegeMode,
  bruteForceProtection,
  resetBruteForceCounter,
} from '../middleware/rate-limiter';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    path: '/api/auth/login',
    method: 'POST',
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as unknown as Response;
  return res;
}

describe('Brute Force Protection', () => {
  beforeEach(() => {
    resetBruteForceCounter();
  });

  describe('incrementGlobalFailedAuth', () => {
    it('increments the in-memory counter when Redis is unavailable', async () => {
      const count = await incrementGlobalFailedAuth();
      expect(count).toBe(1);

      const count2 = await incrementGlobalFailedAuth();
      expect(count2).toBe(2);
    });

    it('returns sequential counts', async () => {
      for (let i = 1; i <= 10; i++) {
        const count = await incrementGlobalFailedAuth();
        expect(count).toBe(i);
      }
    });
  });

  describe('isSiegeMode', () => {
    it('returns false when counter is below threshold', async () => {
      // Default threshold is 50
      for (let i = 0; i < 10; i++) {
        await incrementGlobalFailedAuth();
      }
      const active = await isSiegeMode();
      expect(active).toBe(false);
    });

    it('returns true when counter reaches threshold', async () => {
      // Push counter to 50 (default threshold)
      for (let i = 0; i < 50; i++) {
        await incrementGlobalFailedAuth();
      }
      const active = await isSiegeMode();
      expect(active).toBe(true);
    });

    it('returns false after counter is reset', async () => {
      for (let i = 0; i < 50; i++) {
        await incrementGlobalFailedAuth();
      }
      expect(await isSiegeMode()).toBe(true);

      resetBruteForceCounter();
      expect(await isSiegeMode()).toBe(false);
    });
  });

  describe('bruteForceProtection middleware', () => {
    it('calls next immediately in normal mode (no delay)', async () => {
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn();

      const start = Date.now();
      await bruteForceProtection(req, res, next);
      const elapsed = Date.now() - start;

      expect(next).toHaveBeenCalledOnce();
      expect(elapsed).toBeLessThan(100); // No delay
      expect((req as any).siegeMode).toBeUndefined();
    });

    it('adds delay and sets siegeMode flag during siege', async () => {
      // Trigger siege mode
      for (let i = 0; i < 50; i++) {
        await incrementGlobalFailedAuth();
      }

      const req = mockReq();
      const res = mockRes();
      const next = vi.fn();

      const start = Date.now();
      await bruteForceProtection(req, res, next);
      const elapsed = Date.now() - start;

      expect(next).toHaveBeenCalledOnce();
      expect(elapsed).toBeGreaterThanOrEqual(1900); // ~2s delay
      expect((req as any).siegeMode).toBe(true);
    }, 5000);
  });
});
