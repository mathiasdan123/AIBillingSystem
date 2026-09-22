/**
 * Fleet-wide Blanche usage accounting. Locks down:
 *   1. Redis path: INCR + one-time EXPIRE, reads via GET
 *   2. Fallback path: no Redis → in-memory counting still works
 *   3. Redis errors degrade to the in-memory count instead of throwing
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRedis = vi.hoisted(() => {
  const store = new Map<string, number>();
  return {
    store,
    ready: true,
    client: {
      get: vi.fn(async (k: string) => (store.has(k) ? String(store.get(k)) : null)),
      incr: vi.fn(async (k: string) => {
        const next = (store.get(k) ?? 0) + 1;
        store.set(k, next);
        return next;
      }),
      expire: vi.fn(async () => 1),
    },
  };
});

vi.mock('../services/redisClient', () => ({
  getRedisClient: vi.fn(() => (mockRedis.ready ? mockRedis.client : null)),
  isRedisReady: vi.fn(() => mockRedis.ready),
}));

import {
  getDailyUsage,
  incrementDailyUsage,
  _resetMemoryUsage,
} from '../services/blancheUsageService';

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.store.clear();
  mockRedis.ready = true;
  _resetMemoryUsage();
});

describe('blancheUsageService', () => {
  it('counts via Redis INCR and sets the TTL exactly once', async () => {
    await incrementDailyUsage(1);
    await incrementDailyUsage(1);
    expect(await getDailyUsage(1)).toBe(2);
    expect(mockRedis.client.incr).toHaveBeenCalledTimes(2);
    expect(mockRedis.client.expire).toHaveBeenCalledTimes(1); // only on count === 1
  });

  it('keys are per-practice', async () => {
    await incrementDailyUsage(1);
    await incrementDailyUsage(2);
    await incrementDailyUsage(2);
    expect(await getDailyUsage(1)).toBe(1);
    expect(await getDailyUsage(2)).toBe(2);
  });

  it('falls back to in-memory counting when Redis is unavailable', async () => {
    mockRedis.ready = false;
    await incrementDailyUsage(1);
    await incrementDailyUsage(1);
    expect(await getDailyUsage(1)).toBe(2);
    expect(mockRedis.client.incr).not.toHaveBeenCalled();
  });

  it('a Redis read error degrades to the in-memory count instead of throwing', async () => {
    await incrementDailyUsage(1); // memory mirror = 1, redis = 1
    mockRedis.client.get.mockRejectedValueOnce(new Error('conn reset'));
    expect(await getDailyUsage(1)).toBe(1); // served from memory, no throw
  });

  it('a Redis increment error still counts in memory', async () => {
    mockRedis.client.incr.mockRejectedValueOnce(new Error('conn reset'));
    await expect(incrementDailyUsage(1)).resolves.toBeUndefined();
    mockRedis.ready = false; // force reads to the memory path
    expect(await getDailyUsage(1)).toBe(1);
  });
});
