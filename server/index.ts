import express, { type Request, Response, NextFunction } from "express";
import crypto from "crypto";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { seedDatabase } from "./seeds";
import { startScheduler } from "./scheduler";

// =============================================================================
// SECURITY: Production environment validation
// =============================================================================
const isProduction = process.env.NODE_ENV === 'production';
const isRailwayDemo = !!process.env.RAILWAY_ENVIRONMENT;

// For Railway demo, provide defaults for non-critical demo environment
if (isRailwayDemo && !process.env.PHI_ENCRYPTION_KEY) {
  // Demo key - only for demo with fake data, never for real PHI
  process.env.PHI_ENCRYPTION_KEY = '0'.repeat(64);
  console.warn('⚠️  Using demo PHI encryption key - NOT FOR REAL DATA');
}

if (isProduction && !isRailwayDemo) {
  const requiredEnvVars = [
    'DATABASE_URL',
    'SESSION_SECRET',
    'PHI_ENCRYPTION_KEY',
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

    // Allow Railway domains (same-origin requests from deployed app)
    if (isRailwayDemo && origin?.includes('.railway.app')) {
      return callback(null, true);
    }

    // In production, check against allowed origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // If no explicit origins set and we're in demo mode, allow
    if (isRailwayDemo && allowedOrigins.length === 0) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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
  // XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Referrer policy for PHI protection
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Content Security Policy - prevents XSS and data injection attacks
  // Note: 'unsafe-inline' for styles needed for some UI libraries; review for stricter CSP
  // For Railway demo, we use a more permissive CSP
  if (isRailwayDemo) {
    // Demo mode: permissive CSP for easier testing
    res.setHeader('Content-Security-Policy', [
      "default-src 'self' https: wss:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "font-src 'self' https: data:",
      "img-src 'self' data: https: blob:",
      "connect-src 'self' https: wss:",
      "frame-src 'self' https:",
    ].join('; '));
  } else {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https: blob:",
      "connect-src 'self' https://api.stripe.com https://api.openai.com wss:",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '));
  }
  next();
});

// Security: Rate limiting (configurable via environment variables)
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'); // 15 minutes default
const RATE_LIMIT_MAX_GENERAL = parseInt(process.env.RATE_LIMIT_MAX_GENERAL || '1000');
const RATE_LIMIT_MAX_AUTH = parseInt(process.env.RATE_LIMIT_MAX_AUTH || '20');
const RATE_LIMIT_MAX_API = parseInt(process.env.RATE_LIMIT_MAX_API || '100');
const API_RATE_LIMIT_WINDOW_MS = parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000'); // 1 minute default

const generalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_GENERAL,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_AUTH,
  message: { error: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_API,
  message: { error: 'Too many API requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
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

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
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
