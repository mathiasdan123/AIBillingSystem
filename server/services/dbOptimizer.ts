/**
 * Database query optimization utilities:
 * - Connection pool monitoring with capacity warnings
 * - Slow query performance logging (>500ms)
 * - Database health check for /api/health endpoint
 */

import { logger } from './logger';

// ---------------------------------------------------------------------------
// Connection Pool Monitor
// ---------------------------------------------------------------------------

interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  activeCount: number;
}

/**
 * Reads current pool statistics from a node-postgres (pg) Pool instance.
 * Falls back to zeros if the pool doesn't expose the expected properties.
 */
export function getPoolStats(pool: any): PoolStats {
  const totalCount: number = typeof pool?.totalCount === 'number' ? pool.totalCount : 0;
  const idleCount: number = typeof pool?.idleCount === 'number' ? pool.idleCount : 0;
  const waitingCount: number = typeof pool?.waitingCount === 'number' ? pool.waitingCount : 0;
  const activeCount = totalCount - idleCount;

  return { totalCount, idleCount, waitingCount, activeCount };
}

const DEFAULT_POOL_MAX = 10; // pg default max connections
const CAPACITY_WARN_THRESHOLD = 0.8; // warn at 80%

/**
 * Starts a periodic check of connection pool utilisation.
 * Logs a warning when pool is near capacity and an error when requests are
 * queued waiting for a connection.
 *
 * Returns a cleanup function that stops the interval.
 */
export function startPoolMonitor(
  pool: any,
  intervalMs = 30_000,
  maxConnections = DEFAULT_POOL_MAX,
): () => void {
  const timer = setInterval(() => {
    const stats = getPoolStats(pool);

    if (stats.waitingCount > 0) {
      logger.error('Connection pool exhausted - queries are waiting', {
        ...stats,
        maxConnections,
      });
    } else if (stats.activeCount >= maxConnections * CAPACITY_WARN_THRESHOLD) {
      logger.warn('Connection pool nearing capacity', {
        ...stats,
        maxConnections,
        utilizationPct: Math.round((stats.activeCount / maxConnections) * 100),
      });
    }
  }, intervalMs);

  // Allow the Node process to exit even if the timer is still running
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    (timer as NodeJS.Timeout).unref();
  }

  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// Slow Query Logger
// ---------------------------------------------------------------------------

const SLOW_QUERY_THRESHOLD_MS = 500;

/**
 * Wraps a pool's `query` method so that every query is timed. Queries that
 * take longer than `thresholdMs` (default 500 ms) are logged as warnings.
 *
 * This is a non-invasive monkey-patch: the original `query` is preserved and
 * called transparently, so callers see no difference.
 */
export function enableSlowQueryLogging(
  pool: any,
  thresholdMs = SLOW_QUERY_THRESHOLD_MS,
): void {
  if (!pool || typeof pool.query !== 'function') {
    logger.warn('Cannot enable slow query logging: pool.query is not a function');
    return;
  }

  // Guard against double-patching
  if ((pool as any).__slowQueryLoggingEnabled) {
    return;
  }

  const originalQuery = pool.query.bind(pool);

  pool.query = async function patchedQuery(...args: any[]) {
    const start = Date.now();
    try {
      const result = await originalQuery(...args);
      const duration = Date.now() - start;
      if (duration > thresholdMs) {
        const queryText = typeof args[0] === 'string'
          ? args[0].slice(0, 200)
          : typeof args[0]?.text === 'string'
            ? args[0].text.slice(0, 200)
            : '[unknown]';
        logger.warn('Slow database query detected', {
          durationMs: duration,
          thresholdMs,
          query: queryText,
        });
      }
      return result;
    } catch (err) {
      const duration = Date.now() - start;
      if (duration > thresholdMs) {
        logger.warn('Slow database query detected (failed)', {
          durationMs: duration,
          thresholdMs,
        });
      }
      throw err;
    }
  };

  (pool as any).__slowQueryLoggingEnabled = true;
}

// ---------------------------------------------------------------------------
// Database Health Check
// ---------------------------------------------------------------------------

export interface DbHealthResult {
  status: 'healthy' | 'unhealthy';
  latencyMs: number;
  pool: PoolStats;
  error?: string;
}

/**
 * Performs a lightweight health check against the database by running
 * `SELECT 1` and returns pool statistics alongside the result.
 */
export async function checkDbHealth(pool: any): Promise<DbHealthResult> {
  const stats = getPoolStats(pool);
  const start = Date.now();

  try {
    await pool.query('SELECT 1');
    const latencyMs = Date.now() - start;
    return { status: 'healthy', latencyMs, pool: stats };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    return {
      status: 'unhealthy',
      latencyMs,
      pool: stats,
      error: err?.message ?? 'Unknown database error',
    };
  }
}
