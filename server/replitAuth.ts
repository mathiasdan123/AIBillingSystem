import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

// Allow local development without Replit auth
// SECURITY: Multiple safeguards to prevent dev mode in production
const isLocalDev =
  process.env.NODE_ENV === 'development' &&
  !process.env.REPLIT_DOMAINS &&
  !process.env.PRODUCTION &&
  !process.env.RAILWAY_ENVIRONMENT &&
  !process.env.VERCEL_ENV &&
  !process.env.HEROKU_APP_NAME &&
  !process.env.AWS_LAMBDA_FUNCTION_NAME;

// Railway demo mode - use simple session auth instead of Replit OAuth
const isRailwayDemo = !!process.env.RAILWAY_ENVIRONMENT;

// Log warning if dev mode is active
if (isLocalDev) {
  console.warn('⚠️  WARNING: Running in local development mode with mock authentication');
  console.warn('⚠️  This should NEVER appear in production logs');
}

if (isRailwayDemo) {
  console.log('🚂 Running on Railway - using demo authentication mode');
}

// Only require REPLIT_DOMAINS when on Replit (not local dev, not Railway)
if (!isLocalDev && !isRailwayDemo && !process.env.REPLIT_DOMAINS) {
  throw new Error("Environment variable REPLIT_DOMAINS not provided");
}

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const isProduction = process.env.NODE_ENV === 'production';
  // HIPAA: 30 minute idle timeout in production, 1 week in dev
  const sessionTtl = isProduction ? 30 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;

  // Use memory store for development to avoid PostgreSQL session store issues
  if (process.env.NODE_ENV === 'development') {
    return session({
      secret: process.env.SESSION_SECRET!,
      resave: false,
      saveUninitialized: false,
      rolling: true, // Reset timer on activity
      name: 'therapybill.sid',
      cookie: {
        httpOnly: false,
        secure: false,
        maxAge: sessionTtl,
        sameSite: 'lax',
      },
    });
  }

  // Use PostgreSQL store for production
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
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
      // CSRF Protection: 'lax' provides protection while allowing OAuth redirects
      // - Cookies not sent on cross-site POST requests (blocks CSRF attacks)
      // - Cookies sent on top-level navigations (allows OAuth callback)
      // - Additional protection via OAuth state parameter validation
      sameSite: 'lax',
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(
  claims: any,
) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Local development mode or Railway demo - bypass Replit OAuth
  if (isLocalDev || isRailwayDemo) {
    console.log(isRailwayDemo ? 'Running on Railway - using demo auth' : 'Running in local development mode - using mock auth');

    passport.serializeUser((user: Express.User, cb) => {
      cb(null, user);
    });
    passport.deserializeUser((user: Express.User, cb) => {
      cb(null, user);
    });

    // Mock login for dev/demo - automatically log in as admin
    app.get("/api/login", async (req, res) => {
      const devUser = {
        claims: {
          sub: 'demo-user-123',
          email: 'admin@demo.therapybill',
          first_name: 'Demo',
          last_name: 'Admin',
        },
        access_token: 'demo-token',
        expires_at: Math.floor(Date.now() / 1000) + 86400, // 24 hours
      };

      // Upsert the demo user in storage with admin role
      await storage.upsertUser({
        id: 'demo-user-123',
        email: 'admin@demo.therapybill',
        firstName: 'Demo',
        lastName: 'Admin',
        profileImageUrl: null,
      });
      // Update role to admin for full access
      await storage.updateUserRole('demo-user-123', 'admin');

      req.login(devUser, (err) => {
        if (err) {
          console.error('Demo login error:', err);
          return res.status(500).json({ error: 'Login failed' });
        }
        res.redirect('/');
      });
    });

    app.get("/api/callback", (req, res) => {
      res.redirect('/');
    });

    app.get("/api/logout", (req, res) => {
      req.logout(() => {
        res.redirect('/');
      });
    });

    return;
  }

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  for (const domain of process.env
    .REPLIT_DOMAINS!.split(",")) {
    const strategy = new Strategy(
      {
        name: `replitauth:${domain}`,
        config,
        scope: "openid email profile offline_access",
        callbackURL: `https://${domain}/api/callback`,
      },
      verify,
    );
    passport.use(strategy);
  }

  passport.serializeUser((user: Express.User, cb) => {
    console.log('Serializing user:', user);
    cb(null, user);
  });
  passport.deserializeUser((user: Express.User, cb) => {
    console.log('Deserializing user:', user);
    cb(null, user);
  });

  app.get("/api/login", (req, res, next) => {
    console.log('Login attempt for hostname:', req.hostname);
    console.log('Session ID:', req.sessionID);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
      state: req.sessionID, // Use session ID as state
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    passport.authenticate(`replitauth:${req.hostname}`, (err: any, user: any, info: any) => {
      if (err) {
        console.error('Auth error:', err);
        return res.redirect("/api/login");
      }
      if (!user) {
        console.error('No user returned:', info);
        return res.redirect("/api/login");
      }

      req.logIn(user, (err: any) => {
        if (err) {
          console.error('Login error:', err);
          return res.redirect("/api/login");
        }
        console.log('User logged in successfully:', user.claims?.sub);
        return res.redirect("/");
      });
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  console.log('Auth check - isAuthenticated:', req.isAuthenticated());
  console.log('Auth check - user:', user);
  console.log('Auth check - session:', (req as any).session);

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

  // For development/demo user, skip token expiration checks
  if (user.claims?.sub === 'dev-user-123' || user.claims?.sub === 'demo-user-123') {
    console.log('Development/demo user authenticated');
    // Set practice ID for dev/demo user (admin has access to all)
    (req as any).userPracticeId = 1;
    (req as any).userRole = 'admin';
    return next();
  }

  if (!user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
