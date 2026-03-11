/**
 * Rate Limiting Middleware
 *
 * Provides in-memory rate limiting for different types of endpoints.
 *
 * NOTE: This implementation uses an in-memory store which works for single-server
 * deployments. For production with multiple server instances, consider using:
 * - Redis-based rate limiting (e.g., rate-limit-redis)
 * - A distributed cache like Memcached
 * - A dedicated rate limiting service
 *
 * Security considerations:
 * - Rate limits help prevent brute force attacks on auth endpoints
 * - API rate limits protect against abuse and DoS
 * - Different tiers for different endpoint sensitivity levels
 */

import type { Request, Response, NextFunction } from 'express';
import logger from '../services/logger';

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
 * Stores request counts per key
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * In-memory store for rate limit data
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
  // Start cleanup interval on first limiter creation
  startCleanupInterval();

  const {
    maxRequests,
    windowMs,
    description = name,
    keyGenerator = authKeyGenerator,
    message = 'Too many requests, please try again later',
    skip,
  } = config;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Check if request should skip rate limiting
    if (skip && skip(req)) {
      return next();
    }

    const key = `${name}:${keyGenerator(req)}`;
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

    // Calculate remaining requests and time
    const remaining = Math.max(0, maxRequests - entry.count);
    const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);

    // Set rate limit headers (following draft IETF standard)
    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000).toString());

    // Check if rate limit exceeded
    if (entry.count > maxRequests) {
      logger.warn('Rate limit exceeded', {
        limiter: name,
        description,
        key: key.replace(/user:.*/, 'user:[REDACTED]'), // Don't log user IDs
        count: entry.count,
        limit: maxRequests,
        resetInSeconds: resetSeconds,
        path: req.path,
        method: req.method,
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
