/**
 * Rate limits for the two MCP surfaces served at the site root, outside the
 * `/api` general limiter (CodeQL #134 / #135).
 *
 * Built with express-rate-limit, exactly like the app-level limiters in
 * server/index.ts (same headers, same fail-open store policy, same Redis
 * store when REDIS_URL is set), rather than the route-level createRateLimiter
 * factory. Two reasons:
 *   1. Consistency with how the app-level limiters are configured, which is
 *      what the audit asked for.
 *   2. CodeQL's "Missing rate limiting" query recognises express-rate-limit
 *      middleware; it cannot see a hand-rolled limiter, so the alerts would
 *      stay open even with the custom factory in place.
 *
 * Keying: client IP via req.ip, which honours `trust proxy` (1 hop, the ALB).
 * The caller is not identified until after the lookups these limiters protect,
 * so IP is the only key available here.
 */
import rateLimit, { type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { initRedisClient } from '../services/redisClient';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

/**
 * POST /authorize/callback accepts an MCP API key to complete a Claude Desktop
 * connector authorization: an online brute-force surface for API keys. Its own
 * budget rather than the login limiter's, for the same reason the MFA
 * challenge has one: one surface's failures must not lock the other. 10 per
 * 15 minutes is generous for a person pasting a key and useless against a
 * 256-bit key.
 */
export const MCP_OAUTH_CALLBACK_MAX = parseInt(process.env.RATE_LIMIT_MAX_MCP_OAUTH_CALLBACK || '10', 10);

/**
 * Every /mcp request runs bearer-token verification and an API-key hash
 * lookup in the database before any JSON-RPC work, authenticated or not. A
 * legitimate MCP client issues human-paced tool calls, a handful a minute;
 * 120/min leaves ample room for bursts while bounding an anonymous probe to
 * two lookups a second. Raise with RATE_LIMIT_MAX_MCP_TRANSPORT_PER_MIN if a
 * real integration needs more (symptom: 429 with Retry-After on /mcp).
 */
export const MCP_TRANSPORT_MAX_PER_MIN = parseInt(process.env.RATE_LIMIT_MAX_MCP_TRANSPORT_PER_MIN || '120', 10);

// initRedisClient() is idempotent: the first caller (index.ts or this module,
// whichever loads first) creates the connection and later callers reuse it.
// Each limiter needs its own store instance (express-rate-limit requirement).
function makeRedisStore(prefix: string): Store | undefined {
  const redisClient = initRedisClient();
  if (!redisClient) return undefined;
  try {
    return new RedisStore({
      sendCommand: (...args: string[]) => redisClient.call(args[0], ...args.slice(1)) as any,
      prefix,
    });
  } catch {
    return undefined;
  }
}

function withStore(prefix: string) {
  const store = makeRedisStore(prefix);
  return store ? { store } : {};
}

export const mcpOAuthCallbackLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  limit: MCP_OAUTH_CALLBACK_MAX,
  message: { error: 'Too many authorization attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  // A Redis store failure must never fail the request (see index.ts).
  passOnStoreError: true,
  ...withStore('rl:mcp-oauth-callback:'),
});

export const mcpTransportLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  limit: MCP_TRANSPORT_MAX_PER_MIN,
  message: { error: 'Too many MCP requests from this address. Please slow down and retry in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  ...withStore('rl:mcp-transport:'),
});
