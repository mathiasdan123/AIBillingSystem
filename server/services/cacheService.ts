/**
 * Cache Service
 *
 * Provides a caching layer that uses Redis when available, falling back to an
 * in-memory Map with TTL-based expiry and LRU eviction.
 *
 * All cache keys are namespaced by practiceId to prevent data leakage between
 * practices. Global (non-practice-specific) keys use the "global" namespace.
 *
 * Usage:
 *   import { cache } from './cacheService';
 *
 *   // Cache-aside pattern (preferred):
 *   const data = await cache.wrap('practice:1:dashboard', 300, () => fetchDashboard(1));
 *
 *   // Manual get/set:
 *   await cache.set('practice:1:claims-by-status', data, 300);
 *   const cached = await cache.get<ClaimsData>('practice:1:claims-by-status');
 *
 *   // Invalidation:
 *   await cache.del('practice:1:dashboard');
 *   await cache.delPattern('practice:1:analytics:*');
 */

import { getRedisClient, isRedisReady } from './redisClient';
import logger from './logger';

// ---------------------------------------------------------------------------
// In-memory LRU cache with TTL
// ---------------------------------------------------------------------------

interface MemoryCacheEntry {
  value: string; // JSON-serialized
  expiresAt: number; // epoch ms
  timer: ReturnType<typeof setTimeout>;
}

const MAX_MEMORY_ENTRIES = 1000;

class MemoryCache {
  private store = new Map<string, MemoryCacheEntry>();
  /** Track insertion order for LRU eviction. Most-recently-used at the end. */
  private accessOrder: string[] = [];

  get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.del(key);
      return null;
    }
    // Move to end of access order (mark as recently used)
    this.touchAccessOrder(key);
    return entry.value;
  }

  set(key: string, value: string, ttlSeconds: number): void {
    // Remove existing entry if present
    this.del(key);
    // Evict LRU entries if at capacity
    while (this.store.size >= MAX_MEMORY_ENTRIES) {
      this.evictLRU();
    }
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const timer = setTimeout(() => {
      this.del(key);
    }, ttlSeconds * 1000);
    // Prevent timer from keeping the process alive
    if (timer.unref) timer.unref();

    this.store.set(key, { value, expiresAt, timer });
    this.accessOrder.push(key);
  }

  del(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.store.delete(key);
    this.removeFromAccessOrder(key);
    return true;
  }

  delPattern(pattern: string): number {
    // Convert simple glob pattern (e.g. "practice:1:*") to a test function
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
    );
    let deleted = 0;
    const keys = Array.from(this.store.keys());
    for (const key of keys) {
      if (regex.test(key)) {
        this.del(key);
        deleted++;
      }
    }
    return deleted;
  }

  clear(): void {
    const entries = Array.from(this.store.values());
    for (const entry of entries) {
      clearTimeout(entry.timer);
    }
    this.store.clear();
    this.accessOrder = [];
  }

  get size(): number {
    return this.store.size;
  }

  private touchAccessOrder(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
  }

  private evictLRU(): void {
    if (this.accessOrder.length === 0) return;
    const oldest = this.accessOrder[0];
    this.del(oldest);
  }
}

// ---------------------------------------------------------------------------
// CacheService — public API
// ---------------------------------------------------------------------------

class CacheService {
  private memoryCache = new MemoryCache();

  /**
   * Retrieve a cached value by key.
   * Returns null if not found or expired.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      // Try Redis first
      if (isRedisReady()) {
        const redis = getRedisClient()!;
        const raw = await redis.get(key);
        if (raw !== null) {
          return JSON.parse(raw) as T;
        }
        return null;
      }

      // Fall back to memory
      const raw = this.memoryCache.get(key);
      if (raw !== null) {
        return JSON.parse(raw) as T;
      }
      return null;
    } catch (err) {
      logger.warn('Cache get error', { key, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  /**
   * Store a value in the cache with a TTL in seconds.
   */
  async set(key: string, value: any, ttlSeconds: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);

      if (isRedisReady()) {
        const redis = getRedisClient()!;
        await redis.set(key, serialized, 'EX', ttlSeconds);
        return;
      }

      this.memoryCache.set(key, serialized, ttlSeconds);
    } catch (err) {
      logger.warn('Cache set error', { key, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Delete a single cache key.
   */
  async del(key: string): Promise<void> {
    try {
      if (isRedisReady()) {
        const redis = getRedisClient()!;
        await redis.del(key);
        return;
      }

      this.memoryCache.del(key);
    } catch (err) {
      logger.warn('Cache del error', { key, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Delete all keys matching a glob pattern (e.g. "practice:1:*").
   * For Redis, uses SCAN to avoid blocking. For memory, iterates the Map.
   */
  async delPattern(pattern: string): Promise<void> {
    try {
      if (isRedisReady()) {
        const redis = getRedisClient()!;
        let cursor = '0';
        do {
          const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
          cursor = nextCursor;
          if (keys.length > 0) {
            await redis.del(...keys);
          }
        } while (cursor !== '0');
        return;
      }

      this.memoryCache.delPattern(pattern);
    } catch (err) {
      logger.warn('Cache delPattern error', { pattern, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Cache-aside pattern: return cached value if it exists, otherwise call the
   * provided function, cache the result, and return it.
   */
  async wrap<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    const result = await fn();
    // Don't cache null/undefined results
    if (result !== null && result !== undefined) {
      await this.set(key, result, ttlSeconds);
    }
    return result;
  }

  /**
   * Clear the entire cache (both Redis namespace and memory).
   */
  async clear(): Promise<void> {
    try {
      if (isRedisReady()) {
        const redis = getRedisClient()!;
        // Only clear our app keys, not the entire Redis instance
        await this.delPattern('practice:*');
        await this.delPattern('global:*');
      }
      this.memoryCache.clear();
      logger.info('Cache cleared');
    } catch (err) {
      logger.warn('Cache clear error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Get cache stats for monitoring.
   */
  getStats(): { backend: string; memoryEntries: number } {
    return {
      backend: isRedisReady() ? 'redis' : 'memory',
      memoryEntries: this.memoryCache.size,
    };
  }
}

// ---------------------------------------------------------------------------
// Cache key helpers — enforce consistent namespacing
// ---------------------------------------------------------------------------

export const CacheKeys = {
  // Analytics (5-minute TTL)
  dashboard: (practiceId: number) => `practice:${practiceId}:analytics:dashboard`,
  claimsByStatus: (practiceId: number) => `practice:${practiceId}:analytics:claims-by-status`,
  denialReasons: (practiceId: number) => `practice:${practiceId}:analytics:denial-reasons`,
  collectionRate: (practiceId: number) => `practice:${practiceId}:analytics:collection-rate`,
  cleanClaimsRate: (practiceId: number) => `practice:${practiceId}:analytics:clean-claims-rate`,
  arAging: (practiceId: number) => `practice:${practiceId}:analytics:ar-aging`,
  patientArAging: (practiceId: number) => `practice:${practiceId}:analytics:patient-ar-aging`,
  therapistProductivity: (practiceId: number, hash: string) =>
    `practice:${practiceId}:analytics:therapist-productivity:${hash}`,
  therapistProductivityTrends: (practiceId: number, hash: string) =>
    `practice:${practiceId}:analytics:therapist-productivity-trends:${hash}`,
  revenue: (practiceId: number, timeRange: string) =>
    `practice:${practiceId}:analytics:revenue:${timeRange}`,
  revenueForecast: (practiceId: number, months: number) =>
    `practice:${practiceId}:analytics:revenue-forecast:${months}`,
  capacity: (practiceId: number, hash: string) =>
    `practice:${practiceId}:analytics:capacity:${hash}`,
  cancellations: (practiceId: number, hash: string) =>
    `practice:${practiceId}:analytics:cancellations:${hash}`,
  referrals: (practiceId: number) => `practice:${practiceId}:analytics:referrals`,

  // Code lookups (1-hour TTL)
  cptCodes: () => `global:cpt-codes`,
  icd10Codes: () => `global:icd10-codes`,
  payers: () => `global:payers`,

  // Practice settings (10-minute TTL)
  practiceInfo: (practiceId: number) => `practice:${practiceId}:info`,
  telehealthSettings: (practiceId: number) => `practice:${practiceId}:telehealth-settings`,

  // Invalidation patterns
  analyticsPattern: (practiceId: number) => `practice:${practiceId}:analytics:*`,
  practicePattern: (practiceId: number) => `practice:${practiceId}:*`,
} as const;

// TTL constants in seconds
export const CacheTTL = {
  ANALYTICS: 5 * 60,       // 5 minutes
  CODE_LOOKUPS: 60 * 60,   // 1 hour
  PRACTICE_SETTINGS: 10 * 60, // 10 minutes
} as const;

/** Singleton cache instance */
export const cache = new CacheService();
