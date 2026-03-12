/**
 * Redis Client Service
 *
 * Provides a shared Redis client for use across the application (rate limiting,
 * caching, session storage, etc.).
 *
 * Design:
 * - Redis is OPTIONAL. If REDIS_URL is not set, no client is created.
 * - If Redis connection fails at runtime, consumers should fall back gracefully.
 * - The client is exported as a singleton for reuse.
 */

import Redis from 'ioredis';
import logger from './logger';

export type RedisClientType = InstanceType<typeof Redis>;

let redisClient: RedisClientType | null = null;
let redisReady = false;

/**
 * Initialize the Redis client if REDIS_URL is configured.
 * Safe to call multiple times -- only the first call creates a connection.
 */
export function initRedisClient(): RedisClientType | null {
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    logger.info('REDIS_URL not set -- using in-memory stores (not suitable for horizontal scaling)');
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      // Reconnect with exponential backoff, cap at 5 seconds
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      // Don't throw on connection errors -- we handle them via events
      lazyConnect: false,
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected');
    });

    redisClient.on('ready', () => {
      redisReady = true;
      logger.info('Redis client ready -- distributed rate limiting active');
    });

    redisClient.on('error', (err: Error) => {
      redisReady = false;
      logger.error('Redis client error', { error: err.message });
    });

    redisClient.on('close', () => {
      redisReady = false;
      logger.warn('Redis connection closed');
    });

    redisClient.on('reconnecting', () => {
      logger.info('Redis client reconnecting...');
    });

    return redisClient;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to create Redis client', { error: message });
    redisClient = null;
    return null;
  }
}

/**
 * Returns the current Redis client, or null if Redis is unavailable.
 */
export function getRedisClient(): RedisClientType | null {
  return redisClient;
}

/**
 * Returns true if the Redis client is connected and ready to accept commands.
 */
export function isRedisReady(): boolean {
  return redisReady && redisClient !== null;
}

/**
 * Gracefully shut down the Redis connection.
 */
export async function shutdownRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info('Redis client disconnected gracefully');
    } catch {
      // Force disconnect if quit fails
      redisClient.disconnect();
    }
    redisClient = null;
    redisReady = false;
  }
}
