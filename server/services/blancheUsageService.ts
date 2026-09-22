/**
 * Per-practice daily usage accounting for Blanche.
 *
 * Production runs 2+ ECS tasks behind an ALB, so a per-process Map undercounts
 * by roughly the task count — a "100/day" starter plan actually allowed ~200.
 * This makes the counter Redis-backed (shared across the fleet) with the old
 * in-memory Map as the fallback when Redis is unconfigured or unhealthy —
 * exactly the degradation contract the HTTP rate limiter already documents
 * ("distributed" vs "per_instance" in /api/health).
 *
 * Counter key: blanche:usage:{practiceId}:{YYYY-MM-DD}, expiring after 48h so
 * yesterday's keys clean themselves up. Day rollover therefore matches the
 * old behavior (UTC date string).
 *
 * Failure posture: usage accounting must never take the assistant down. Every
 * Redis error falls back to the in-memory count for that call. A mid-day
 * failover restarts the fallback count from this task's memory — acceptable
 * drift, in the generous direction, for a limiter whose job is abuse
 * prevention rather than billing.
 */
import { getRedisClient, isRedisReady } from './redisClient';
import logger from './logger';

interface PracticeUsage {
  count: number;
  resetDate: string;
}

const memoryUsage = new Map<number, PracticeUsage>();
const KEY_TTL_SECONDS = 48 * 60 * 60;

function todayString(): string {
  return new Date().toISOString().split('T')[0];
}

function redisKey(practiceId: number, day: string): string {
  return `blanche:usage:${practiceId}:${day}`;
}

function memoryGet(practiceId: number, day: string): number {
  const usage = memoryUsage.get(practiceId);
  if (!usage || usage.resetDate !== day) return 0;
  return usage.count;
}

function memoryIncrement(practiceId: number, day: string): void {
  const usage = memoryUsage.get(practiceId);
  if (!usage || usage.resetDate !== day) {
    memoryUsage.set(practiceId, { count: 1, resetDate: day });
    return;
  }
  usage.count++;
}

/** Messages this practice has used today, fleet-wide when Redis is up. */
export async function getDailyUsage(practiceId: number): Promise<number> {
  const day = todayString();
  const redis = getRedisClient();
  if (redis !== null && isRedisReady()) {
    try {
      const raw = await redis.get(redisKey(practiceId, day));
      return raw ? parseInt(raw, 10) || 0 : 0;
    } catch (err) {
      logger.warn('Blanche usage read fell back to in-memory', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return memoryGet(practiceId, day);
}

/**
 * Count one assistant message. Also mirrored into the in-memory map so a
 * Redis outage mid-day degrades to this task's own view rather than zero.
 */
export async function incrementDailyUsage(practiceId: number): Promise<void> {
  const day = todayString();
  memoryIncrement(practiceId, day);
  const redis = getRedisClient();
  if (redis !== null && isRedisReady()) {
    try {
      const key = redisKey(practiceId, day);
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, KEY_TTL_SECONDS);
      }
    } catch (err) {
      logger.warn('Blanche usage increment fell back to in-memory', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Test hook — clears the fallback map. */
export function _resetMemoryUsage(): void {
  memoryUsage.clear();
}
