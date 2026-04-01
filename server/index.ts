// Sentry must be initialized before all other imports
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    // Do not send PHI or sensitive session data to Sentry
    beforeSend(event: any) {
      // Strip any cookies or session info from the event
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
      }
      return event;
    },
  });
  console.log("✓ Sentry error tracking initialized");
}

// Prevent unhandled promise rejections from crashing the process
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(reason);
  }
});

import express, { type Request, Response, NextFunction } from "express";
import crypto from "crypto";
import cors from "cors";
import rateLimit, { type Store } from "express-rate-limit";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./static";
import { requestTimeout } from "./middleware/requestTimeout";
import { requestSanitizer } from "./middleware/sanitize";
import { globalErrorHandler } from "./middleware/errorHandler";
import { apiVersionMiddleware, apiVersionRewrite } from "./middleware/apiVersion";
import { seedDatabase } from "./seeds";
import { startScheduler } from "./scheduler";
import { initRedisClient } from "./services/redisClient";
import { RedisStore } from "rate-limit-redis";
import { swaggerSpec } from "./swagger";

// =============================================================================
// SECURITY: Production environment validation
// =============================================================================
const isProduction = process.env.NODE_ENV === 'production';
const isRenderDemo = !!process.env.RENDER;
const isDemoMode = isRenderDemo;

// For Render demo, provide defaults for non-critical demo environment
if (isDemoMode && !process.env.PHI_ENCRYPTION_KEY) {
  // Demo key - only for demo with fake data, never for real PHI
  process.env.PHI_ENCRYPTION_KEY = '0'.repeat(64);
  console.warn('⚠️  Using demo PHI encryption key - NOT FOR REAL DATA');
}

if (isDemoMode && !process.env.SESSION_SECRET) {
  // Demo session secret - only for demo, generates consistent key per deployment
  process.env.SESSION_SECRET = 'demo-session-secret-' + crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  Using auto-generated session secret - NOT FOR PRODUCTION DATA');
}

if (isProduction && !isDemoMode) {
  const requiredEnvVars = [
    'DATABASE_URL',
    'SESSION_SECRET',
    'PHI_ENCRYPTION_KEY',
    'ALLOWED_ORIGINS',
    'SENTRY_DSN',
  ];

  const missingVars = requiredEnvVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    console.error('FATAL: Missing required environment variables for production:');
    missingVars.forEach(v => console.error(`  - ${v}`));
    process.exit(1);
  }

  // Validate PHI encryption key format (should be 64 hex chars for 32-byte key)
  const phiKey = process.env.PHI_ENCRYPTION_KEY!;
  if (phiKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(phiKey)) {
    console.error('FATAL: PHI_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }

  // Validate session secret is strong enough
  if (process.env.SESSION_SECRET!.length < 32) {
    console.error('FATAL: SESSION_SECRET must be at least 32 characters');
    process.exit(1);
  }

  // Warn if Redis is not configured — rate limiting will be per-instance only
  if (!process.env.REDIS_URL) {
    console.warn('⚠️  REDIS_URL not set: rate limiting is per-instance (not distributed across ECS tasks)');
    console.warn('   Each ECS task will have independent rate limit counters.');
    console.warn('   Set REDIS_URL to enable distributed rate limiting.');
  }

  console.log('✓ Production security checks passed');
}

const app = express();

// Request ID middleware for distributed tracing
app.use((req: Request, res: Response, next: NextFunction) => {
  // Use existing request ID from header (for distributed systems) or generate new one
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomBytes(16).toString('hex');
  (req as any).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

// Security: CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
const isDev = process.env.NODE_ENV === 'development';

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    // In development, allow localhost
    if (isDev && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return callback(null, true);
    }

    // Allow Render domains (same-origin requests from deployed app)
    if (isRenderDemo && origin?.includes('.onrender.com')) {
      return callback(null, true);
    }

    // In production, check against allowed origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // If no explicit origins set and we're in demo mode, allow
    if (isDemoMode && allowedOrigins.length === 0) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['X-API-Version', 'X-API-Deprecation', 'X-API-Sunset', 'X-Request-Id'],
}));

// Security: HTTPS enforcement in production
if (isProduction) {
  // HSTS header - tell browsers to only use HTTPS for 1 year
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    next();
  });

  // Redirect HTTP to HTTPS (when behind a proxy that sets x-forwarded-proto)
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] === 'http') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// Security: Additional headers
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Disable legacy XSS filter — CSP is the modern replacement
  res.setHeader('X-XSS-Protection', '0');
  // Referrer policy for PHI protection
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Permissions-Policy: disable unused APIs; allow camera/mic for telehealth
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  // Cross-Origin isolation headers
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  // Content Security Policy - prevents XSS and data injection attacks
  // Note: 'unsafe-inline' for styles needed for some UI libraries; review for stricter CSP
  const cspDirectives: string[] = [];
  if (isDemoMode) {
    // Demo mode: permissive CSP for easier testing
    cspDirectives.push(
      "default-src 'self' https: wss:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "font-src 'self' https: data:",
      "img-src 'self' data: https: blob:",
      "connect-src 'self' https: wss:",
      "frame-src 'self' https:",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    );
  } else {
    cspDirectives.push(
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https: blob:",
      "connect-src 'self' https://api.stripe.com https://api.openai.com https://*.ingest.sentry.io wss:",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    );
  }

  // In development, use report-only CSP so it doesn't block during dev
  const cspHeaderName = isDev
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';
  res.setHeader(cspHeaderName, cspDirectives.join('; '));

  next();
});

// Security: Rate limiting (configurable via environment variables)
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'); // 15 minutes default
const RATE_LIMIT_MAX_GENERAL = parseInt(process.env.RATE_LIMIT_MAX_GENERAL || '1000');
const RATE_LIMIT_MAX_AUTH = parseInt(process.env.RATE_LIMIT_MAX_AUTH || '20');
const RATE_LIMIT_MAX_API = parseInt(process.env.RATE_LIMIT_MAX_API || '100');
const API_RATE_LIMIT_WINDOW_MS = parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000'); // 1 minute default

// Initialize Redis-backed rate limit stores if REDIS_URL is configured.
// Each limiter needs its own RedisStore instance (express-rate-limit requirement).
// Falls back to the default in-memory store when Redis is unavailable.
const redisClient = initRedisClient();
let useRedis = false;

function makeRedisStore(prefix: string): Store | undefined {
  if (!redisClient) return undefined;
  try {
    return new RedisStore({
      sendCommand: (...args: string[]) =>
        redisClient.call(args[0], ...args.slice(1)) as any,
      prefix,
    });
  } catch {
    return undefined;
  }
}

if (redisClient) {
  useRedis = true;
  console.log('✓ Redis-backed rate limiting enabled (distributed)');
} else {
  console.log('ℹ  Using in-memory rate limiting (set REDIS_URL for distributed rate limiting)');
}

const generalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_GENERAL,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...(useRedis ? { store: makeRedisStore('rl:gen:') } : {}),
});

const authLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_AUTH,
  message: { error: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...(useRedis ? { store: makeRedisStore('rl:auth:') } : {}),
});

const apiLimiter = rateLimit({
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_API,
  message: { error: 'Too many API requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...(useRedis ? { store: makeRedisStore('rl:api:') } : {}),
});

// Apply rate limiters
app.use('/api/login', authLimiter);
app.use('/api/mfa', authLimiter);
app.use('/api/patient-portal/request-login', authLimiter);
app.use('/api/oon-predict', apiLimiter);
app.use('/api/ai', apiLimiter);
app.use('/api/public/book', apiLimiter);
app.use(generalLimiter);

// Stripe webhook needs raw body for signature verification - must be before JSON parser
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

// Body parsing with size limits (for all other routes)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// Request sanitization: strip null bytes, truncate oversized fields
app.use(requestSanitizer());

// Request timeout middleware (skips multipart/file uploads)
app.use(requestTimeout());

// API versioning: extract version from URL prefix or Accept header, set response headers
app.use(apiVersionMiddleware);
// API versioning: rewrite /api/v1/... URLs to /api/... so existing routers handle both
app.use(apiVersionRewrite);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize database with seed data
  await seedDatabase();
  
  const server = await registerRoutes(app);

  // Swagger UI — only in non-production to avoid exposing API surface
  if (process.env.NODE_ENV !== 'production') {
    // Dynamic import to avoid bundling swagger-ui-express in production
    const swaggerUi = await import('swagger-ui-express');
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'TherapyBill AI API Docs',
      customCss: '.swagger-ui .topbar { display: none }',
    }));
    // Also serve the raw spec as JSON
    app.get('/api-docs.json', (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });
    log('Swagger UI available at /api-docs');
  }

  // Sentry error handler — must be AFTER all routes but BEFORE other error handlers
  if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
  }

  // Global error handler — must be AFTER all routes (and after Sentry)
  app.use(globalErrorHandler);

  // Setup static file serving or vite dev server
  // In production: always use static file serving
  // In development: dynamically load vite for HMR
  if (process.env.NODE_ENV === "development") {
    // Use Function constructor to completely hide the import from static analysis
    // This prevents esbuild from including vite in the bundle
    const loadVite = new Function('return import("./vite.js")');
    const viteModule = await loadVite();
    await viteModule.setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  const isDev = process.env.NODE_ENV === 'development';

  // reusePort causes issues on many platforms - just use standard options
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);

    // Start the scheduler for daily reports
    startScheduler();
  });
})();

