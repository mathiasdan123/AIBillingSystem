import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getPoolStats,
  startPoolMonitor,
  enableSlowQueryLogging,
  checkDbHealth,
} from '../services/dbOptimizer';

// Mock the logger so we can assert on log calls without console noise
vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logger } from '../services/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockPool(overrides: Record<string, any> = {}) {
  return {
    totalCount: 10,
    idleCount: 8,
    waitingCount: 0,
    query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getPoolStats
// ---------------------------------------------------------------------------

describe('getPoolStats', () => {
  it('returns correct stats from a pool object', () => {
    const pool = createMockPool({ totalCount: 10, idleCount: 3, waitingCount: 1 });
    const stats = getPoolStats(pool);
    expect(stats).toEqual({
      totalCount: 10,
      idleCount: 3,
      waitingCount: 1,
      activeCount: 7,
    });
  });

  it('returns zeros when pool has no stats properties', () => {
    const stats = getPoolStats({});
    expect(stats).toEqual({
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      activeCount: 0,
    });
  });

  it('handles null/undefined pool gracefully', () => {
    expect(getPoolStats(null)).toEqual({
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      activeCount: 0,
    });
    expect(getPoolStats(undefined)).toEqual({
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      activeCount: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// startPoolMonitor
// ---------------------------------------------------------------------------

describe('startPoolMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs a warning when pool is near capacity', () => {
    const pool = createMockPool({ totalCount: 10, idleCount: 1, waitingCount: 0 });
    const stop = startPoolMonitor(pool, 1000, 10);

    vi.advanceTimersByTime(1000);

    expect(logger.warn).toHaveBeenCalledWith(
      'Connection pool nearing capacity',
      expect.objectContaining({ utilizationPct: 90 }),
    );

    stop();
  });

  it('logs an error when queries are waiting', () => {
    const pool = createMockPool({ totalCount: 10, idleCount: 0, waitingCount: 3 });
    const stop = startPoolMonitor(pool, 1000, 10);

    vi.advanceTimersByTime(1000);

    expect(logger.error).toHaveBeenCalledWith(
      'Connection pool exhausted - queries are waiting',
      expect.objectContaining({ waitingCount: 3 }),
    );

    stop();
  });

  it('does not log when pool utilisation is low', () => {
    const pool = createMockPool({ totalCount: 10, idleCount: 8, waitingCount: 0 });
    const stop = startPoolMonitor(pool, 1000, 10);

    vi.advanceTimersByTime(1000);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();

    stop();
  });

  it('stops monitoring when cleanup function is called', () => {
    const pool = createMockPool({ totalCount: 10, idleCount: 0, waitingCount: 5 });
    const stop = startPoolMonitor(pool, 1000, 10);

    stop();

    vi.advanceTimersByTime(5000);

    // Should not have logged because we stopped before the first tick
    expect(logger.error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// enableSlowQueryLogging
// ---------------------------------------------------------------------------

describe('enableSlowQueryLogging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs a warning for queries exceeding the threshold', async () => {
    const pool = createMockPool({
      query: vi.fn().mockImplementation(async () => {
        // Simulate a slow query
        await new Promise((r) => setTimeout(r, 10));
        return { rows: [] };
      }),
    });

    // Use a very low threshold so the test passes quickly
    enableSlowQueryLogging(pool, 5);

    await pool.query('SELECT * FROM users WHERE id = $1', [1]);

    expect(logger.warn).toHaveBeenCalledWith(
      'Slow database query detected',
      expect.objectContaining({
        query: expect.stringContaining('SELECT'),
      }),
    );
  });

  it('does not log for fast queries', async () => {
    const pool = createMockPool({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    });

    enableSlowQueryLogging(pool, 500);

    await pool.query('SELECT 1');

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('still throws on query errors', async () => {
    const pool = createMockPool({
      query: vi.fn().mockRejectedValue(new Error('connection refused')),
    });

    enableSlowQueryLogging(pool, 500);

    await expect(pool.query('SELECT 1')).rejects.toThrow('connection refused');
  });

  it('does not double-patch the pool', async () => {
    const originalQuery = vi.fn().mockResolvedValue({ rows: [] });
    const pool = createMockPool({ query: originalQuery });

    enableSlowQueryLogging(pool, 500);
    const firstPatch = pool.query;
    enableSlowQueryLogging(pool, 500);

    // query function should be the same reference (no double wrap)
    expect(pool.query).toBe(firstPatch);
  });

  it('handles pool without query function', () => {
    const pool = { totalCount: 0 };
    // Should not throw
    enableSlowQueryLogging(pool, 500);
    expect(logger.warn).toHaveBeenCalledWith(
      'Cannot enable slow query logging: pool.query is not a function',
    );
  });

  it('handles query config object with text property', async () => {
    const pool = createMockPool({
      query: vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { rows: [] };
      }),
    });

    enableSlowQueryLogging(pool, 5);

    await pool.query({ text: 'SELECT * FROM patients' });

    expect(logger.warn).toHaveBeenCalledWith(
      'Slow database query detected',
      expect.objectContaining({
        query: 'SELECT * FROM patients',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// checkDbHealth
// ---------------------------------------------------------------------------

describe('checkDbHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns healthy when SELECT 1 succeeds', async () => {
    const pool = createMockPool();
    const result = await checkDbHealth(pool);

    expect(result.status).toBe('healthy');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.pool).toEqual(
      expect.objectContaining({
        totalCount: expect.any(Number),
        idleCount: expect.any(Number),
        activeCount: expect.any(Number),
      }),
    );
    expect(result.error).toBeUndefined();
  });

  it('returns unhealthy when query fails', async () => {
    const pool = createMockPool({
      query: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });

    const result = await checkDbHealth(pool);

    expect(result.status).toBe('unhealthy');
    expect(result.error).toBe('ECONNREFUSED');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('includes pool stats in result', async () => {
    const pool = createMockPool({ totalCount: 5, idleCount: 2, waitingCount: 1 });
    const result = await checkDbHealth(pool);

    expect(result.pool).toEqual({
      totalCount: 5,
      idleCount: 2,
      waitingCount: 1,
      activeCount: 3,
    });
  });
});
