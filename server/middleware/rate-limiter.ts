/**
 * Rate Limiting Middleware
 *
 * Provides distributed rate limiting with Redis backend and in-memory fallback.
 *
 * Architecture:
 * - When Redis is available and ready, uses Redis for distributed rate limiting
 * - When Redis is unavailable, seamlessly falls back to in-memory Map storage
 * - Checks Redis availability on each request for automatic failover
 * - Uses atomic INCR + EXPIRE operations to prevent race conditions
 *
 * Security considerations:
 * - Rate limits help prevent brute force attacks on auth endpoints
 * - API rate limits protect against abuse and DoS
 * - Different tiers for different endpoint sensitivity levels
 * - Distributed rate limiting prevents bypassing limits across multiple servers
 */

import type { Request, Response, NextFunction } from 'express';
import logger from '../services/logger';
import { getRedisClient, isRedisReady } from '../services/redisClient';

/**
 * Configuration for a rate limiter
 */
interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Human-readable description for logging */
  description?: string;
  /** Custom key generator function (defaults to IP-based for auth, user-based for API) */
  keyGenerator?: (req: Request) => string;
  /** Custom message to return when rate limited */
  message?: string;
  /** Skip rate limiting for certain requests */
  skip?: (req: Request) => boolean;
}

/**
 * Stores request counts per key (in-memory fallback)
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * In-memory store for rate limit data (fallback when Redis unavailable)
 * Key format: `${limiterName}:${identifier}`
 */
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Cleanup interval handle for memory management
 */
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start cleanup interval to prevent memory leaks
 * Removes expired entries every minute
 */
function startCleanupInterval(): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    rateLimitStore.forEach((entry, key) => {
      if (entry.resetAt <= now) {
        rateLimitStore.delete(key);
        cleaned++;
      }
    });

    if (cleaned > 0) {
      logger.debug('Rate limiter cleanup', { entriesRemoved: cleaned, remaining: rateLimitStore.size });
    }
  }, 60000); // Clean up every minute
}

/**
 * Stop cleanup interval (useful for testing)
 */
export function stopCleanupInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Clear all rate limit data (useful for testing)
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}

/**
 * Get client IP address from request
 * Handles proxy headers appropriately
 */
function getClientIp(req: Request): string {
  // Trust X-Forwarded-For if behind a proxy (configured in Express trust proxy)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',');
    return ips[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Get user ID from authenticated request
 */
function getUserId(req: Request): string | null {
  const user = (req as any).user;
  return user?.claims?.sub || user?.id || null;
}

/**
 * Default key generator for authentication endpoints (IP-based)
 */
function authKeyGenerator(req: Request): string {
  return getClientIp(req);
}

/**
 * Default key generator for API endpoints (user-based, falls back to IP)
 */
function apiKeyGenerator(req: Request): string {
  const userId = getUserId(req);
  if (userId) {
    return `user:${userId}`;
  }
  return `ip:${getClientIp(req)}`;
}

/**
 * Rate limit using Redis (distributed)
 * Returns { count, resetAt } or null if Redis operation fails
 */
async function rateLimitWithRedis(
  redisKey: string,
  maxRequests: number,
  windowMs: number
): Promise<{ count: number; resetAt: number } | null> {
  const redis = getRedisClient();
  if (!redis || !isRedisReady()) {
    return null;
  }

  try {
    const now = Date.now();
    const resetAt = now + windowMs;
    const ttlSeconds = Math.ceil(windowMs / 1000);

    // Use pipeline for atomic operations
    const pipeline = redis.pipeline();
    pipeline.incr(redisKey);
    pipeline.ttl(redisKey);

    const results = await pipeline.exec();

    if (!results) {
      return null;
    }

    // results is an array of [error, result] tuples
    const [incrErr, incrResult] = results[0];
    const [ttlErr, ttlResult] = results[1];

    if (incrErr || ttlErr) {
      logger.warn('Redis rate limit operation error', {
        incrErr: incrErr?.message,
        ttlErr: ttlErr?.message
      });
      return null;
    }

    const count = incrResult as number;
    const currentTtl = ttlResult as number;

    // If TTL is -1, the key exists but has no expiration (shouldn't happen, but handle it)
    // If TTL is -2, the key doesn't exist (shouldn't happen after INCR, but handle it)
    // If this is the first increment or TTL is missing, set the expiration
    if (count === 1 || currentTtl === -1 || currentTtl === -2) {
      await redis.expire(redisKey, ttlSeconds);
    }

    // Calculate actual reset time based on TTL
    const actualResetAt = currentTtl > 0 ? now + (currentTtl * 1000) : resetAt;

    return { count, resetAt: actualResetAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Redis rate limit error, falling back to in-memory', { error: message });
    return null;
  }
}

/**
 * Rate limit using in-memory store (fallback)
 */
function rateLimitInMemory(
  key: string,
  maxRequests: number,
  windowMs: number
): { count: number; resetAt: number } {
  const now = Date.now();
  let entry = rateLimitStore.get(key);

  // Create new entry or reset if window expired
  if (!entry || entry.resetAt <= now) {
    entry = {
      count: 1,
      resetAt: now + windowMs,
    };
    rateLimitStore.set(key, entry);
  } else {
    // Increment count
    entry.count++;
  }

  return { count: entry.count, resetAt: entry.resetAt };
}

/**
 * Creates a rate limiting middleware with the specified configuration
 *
 * @param name - Unique name for this rate limiter (used in logging and store keys)
 * @param config - Rate limit configuration
 * @returns Express middleware function
 *
 * @example
 * // Create a limiter for login attempts
 * const loginLimiter = createRateLimiter('login', {
 *   maxRequests: 5,
 *   windowMs: 15 * 60 * 1000, // 15 minutes
 *   message: 'Too many login attempts, please try again later'
 * });
 */
export function createRateLimiter(name: string, config: RateLimitConfig) {
  // Start cleanup interval on first limiter creation (for in-memory fallback)
  startCleanupInterval();

  const {
    maxRequests,
    windowMs,
    description = name,
    keyGenerator = authKeyGenerator,
    message = 'Too many requests, please try again later',
    skip,
  } = config;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Check if request should skip rate limiting
    if (skip && skip(req)) {
      return next();
    }

    const identifier = keyGenerator(req);
    const now = Date.now();

    // Redis key format: rl:{limiterName}:{identifier}
    const redisKey = `rl:${name}:${identifier}`;
    // In-memory key format: {limiterName}:{identifier}
    const memoryKey = `${name}:${identifier}`;

    let count: number;
    let resetAt: number;
    let usingRedis = false;

    // Try Redis first if available
    const redisResult = await rateLimitWithRedis(redisKey, maxRequests, windowMs);

    if (redisResult) {
      // Successfully used Redis
      count = redisResult.count;
      resetAt = redisResult.resetAt;
      usingRedis = true;
    } else {
      // Fall back to in-memory
      const memoryResult = rateLimitInMemory(memoryKey, maxRequests, windowMs);
      count = memoryResult.count;
      resetAt = memoryResult.resetAt;
      usingRedis = false;
    }

    // Calculate remaining requests and time
    const remaining = Math.max(0, maxRequests - count);
    const resetSeconds = Math.ceil((resetAt - now) / 1000);

    // Set rate limit headers (following draft IETF standard)
    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000).toString());

    // Check if rate limit exceeded
    if (count > maxRequests) {
      logger.warn('Rate limit exceeded', {
        limiter: name,
        description,
        key: memoryKey.replace(/user:.*/, 'user:[REDACTED]'), // Don't log user IDs
        count,
        limit: maxRequests,
        resetInSeconds: resetSeconds,
        path: req.path,
        method: req.method,
        backend: usingRedis ? 'redis' : 'memory',
      });

      res.setHeader('Retry-After', resetSeconds.toString());
      res.status(429).json({
        message,
        error: 'RATE_LIMIT_EXCEEDED',
        retryAfter: resetSeconds,
      });
      return;
    }

    next();
  };
}

// =============================================================================
// Pre-configured Rate Limiters
// =============================================================================

/**
 * Rate limiter for authentication endpoints
 *
 * Strict limits to prevent brute force attacks:
 * - 5 attempts per 15 minutes per IP address
 *
 * Apply to: /api/login, /api/dev-user, /api/mfa/challenge
 */
export const authLimiter = createRateLimiter('auth', {
  maxRequests: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  description: 'Authentication rate limiter',
  keyGenerator: authKeyGenerator,
  message: 'Too many authentication attempts. Please try again in 15 minutes.',
});

/**
 * Rate limiter for general API requests
 *
 * Moderate limits for normal API usage:
 * - 100 requests per minute per user (or per IP if not authenticated)
 *
 * Apply to: General API endpoints that need protection from abuse
 * Example routes: /api/patients, /api/claims, /api/sessions
 */
export const apiLimiter = createRateLimiter('api', {
  maxRequests: 100,
  windowMs: 60 * 1000, // 1 minute
  description: 'General API rate limiter',
  keyGenerator: apiKeyGenerator,
  message: 'Too many requests. Please slow down.',
});

/**
 * Rate limiter for file upload endpoints
 *
 * Stricter limits due to resource-intensive operations:
 * - 10 uploads per hour per user
 *
 * Apply to: File upload endpoints
 * Example routes: /api/upload, /api/patients/:id/documents, /api/insurance/parse-plan-document
 */
export const uploadLimiter = createRateLimiter('upload', {
  maxRequests: 10,
  windowMs: 60 * 60 * 1000, // 1 hour
  description: 'File upload rate limiter',
  keyGenerator: apiKeyGenerator,
  message: 'Too many file uploads. Please try again later.',
});

/**
 * Rate limiter for data export endpoints
 *
 * Very strict limits due to high resource usage and data sensitivity:
 * - 5 exports per hour per user
 *
 * Apply to: Data export endpoints
 * Example routes: /api/export, /api/patients/:id/export, /api/claims/export
 */
export const exportLimiter = createRateLimiter('export', {
  maxRequests: 5,
  windowMs: 60 * 60 * 1000, // 1 hour
  description: 'Data export rate limiter',
  keyGenerator: apiKeyGenerator,
  message: 'Too many export requests. Please try again later.',
});

/**
 * Rate limiter for password reset requests
 *
 * Very strict limits to prevent enumeration and spam:
 * - 3 password reset requests per hour per IP address
 *
 * Apply to: /api/auth/forgot-password
 */
export const passwordResetLimiter = createRateLimiter('password-reset', {
  maxRequests: 3,
  windowMs: 60 * 60 * 1000, // 1 hour
  description: 'Password reset rate limiter',
  keyGenerator: authKeyGenerator,
  message: 'Too many password reset requests. Please try again in an hour.',
});

/**
 * Rate limiter for account registration
 *
 * Moderate limits to prevent spam registrations:
 * - 5 registration attempts per hour per IP address
 *
 * Apply to: /api/auth/register
 */
export const registrationLimiter = createRateLimiter('registration', {
  maxRequests: 5,
  windowMs: 60 * 60 * 1000, // 1 hour
  description: 'Registration rate limiter',
  keyGenerator: authKeyGenerator,
  message: 'Too many registration attempts. Please try again later.',
});

// =============================================================================
// Type Exports
// =============================================================================

export type { RateLimitConfig, RateLimitEntry };
