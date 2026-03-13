import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import localAuthRoutes from "./routes/localAuth";

// Detect environment for logging
const isLocalDev = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

// Clean connection string - remove unsupported parameters
function getCleanConnectionString(): string {
  const connStr = process.env.DATABASE_URL || '';
  // Remove channel_binding parameter (Neon-specific, not supported by connect-pg-simple)
  return connStr.replace(/[&?]channel_binding=[^&]*/g, '');
}

// Log environment info
if (isLocalDev) {
  console.log('Running in development mode with local authentication');
}
if (isProduction) {
  console.log('Running in production mode with local authentication');
}

export function getSession() {
  // HIPAA: 30 minute idle timeout in production, 1 week in dev
  const sessionTtl = isProduction ? 30 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;

  // Use memory store for development to avoid PostgreSQL session store issues
  if (isLocalDev) {
    return session({
      secret: process.env.SESSION_SECRET!,
      resave: false,
      saveUninitialized: false,
      rolling: true, // Reset timer on activity
      name: 'therapybill.sid',
      cookie: {
        httpOnly: true,
        secure: false, // Allow HTTP in development
        maxAge: sessionTtl,
        sameSite: 'lax',
      },
    });
  }

  // Use PostgreSQL store for production
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: getCleanConnectionString(),
    createTableIfMissing: true,
    ttl: sessionTtl / 1000, // connect-pg-simple expects seconds
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true, // HIPAA: Reset timer on activity
    name: 'therapybill.sid',
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
      // HIPAA: strict sameSite prevents CSRF; all auth is API-based so no cross-origin form posts needed
      sameSite: 'strict',
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Configure passport serialization
  passport.serializeUser((user: Express.User, cb) => {
    cb(null, user);
  });

  passport.deserializeUser((user: Express.User, cb) => {
    cb(null, user);
  });

  // Mount local authentication routes
  app.use('/api/auth', localAuthRoutes);

  // Legacy route compatibility - redirect old /api/login to new auth system
  app.get("/api/login", (_req, res) => {
    // Redirect to frontend login page
    res.redirect('/?login=true');
  });

  // Legacy route compatibility - redirect old /api/logout
  app.get("/api/logout", (req, res) => {
    // Clear MFA verification on logout
    if ((req as any).session) {
      delete (req as any).session.mfaVerifiedAt;
      delete (req as any).session.mfaUserId;
      delete (req as any).session.pendingMfaUserId;
    }

    req.logout((err) => {
      if (err) {
        console.error('Logout error:', err);
      }
      req.session?.destroy((destroyErr) => {
        if (destroyErr) {
          console.error('Session destroy error:', destroyErr);
        }
        res.clearCookie('therapybill.sid');
        res.redirect('/');
      });
    });
  });

  // Legacy callback route (not needed for local auth but kept for compatibility)
  app.get("/api/callback", (_req, res) => {
    res.redirect('/');
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Fetch user from storage to get practiceId and role for authorization
  const userId = user.claims?.sub;
  if (userId) {
    try {
      const dbUser = await storage.getUser(userId);
      if (dbUser) {
        // Attach user practice info for multi-tenancy authorization
        (req as any).userPracticeId = dbUser.practiceId;
        (req as any).userRole = dbUser.role;
      }
    } catch (error) {
      console.error('Error fetching user practice info:', error);
    }
  }

  // Check token expiration
  if (!user.expires_at) {
    return res.status(401).json({ message: "Session expired" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > user.expires_at) {
    return res.status(401).json({ message: "Session expired" });
  }

  return next();
};
