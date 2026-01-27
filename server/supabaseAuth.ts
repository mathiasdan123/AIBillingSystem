import { createClient } from '@supabase/supabase-js';
import type { Express, RequestHandler } from 'express';
import { storage } from './storage';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not configured. Auth will use dev mode.');
}

// Server-side Supabase client
export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || '',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Check if we're in local development mode without Supabase
const isLocalDevWithoutSupabase = process.env.NODE_ENV === 'development' && (!supabaseUrl || !supabaseAnonKey);

export async function setupAuth(app: Express) {
  // Local development mode - mock auth
  if (isLocalDevWithoutSupabase) {
    console.log('Running in local development mode - using mock auth');

    app.get('/api/login', async (req, res) => {
      res.redirect('/');
    });

    app.get('/api/logout', (req, res) => {
      res.redirect('/');
    });

    return;
  }

  // Supabase auth routes
  app.get('/api/login', (req, res) => {
    // Redirect to frontend login page (Supabase handles auth on client)
    res.redirect('/?login=true');
  });

  app.get('/api/logout', (req, res) => {
    res.redirect('/');
  });

  // Callback for OAuth providers (if needed)
  app.get('/api/auth/callback', async (req, res) => {
    const code = req.query.code as string;

    if (code) {
      try {
        await supabase.auth.exchangeCodeForSession(code);
      } catch (error) {
        console.error('Auth callback error:', error);
      }
    }

    res.redirect('/');
  });
}

// Middleware to verify Supabase JWT token
export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // Local dev mode - auto-authenticate as dev user
  if (isLocalDevWithoutSupabase) {
    // Create/update dev user in storage
    const devUser = {
      id: 'dev-user-123',
      email: 'admin@local.dev',
      firstName: 'Dev',
      lastName: 'Admin',
      profileImageUrl: null,
    };

    await storage.upsertUser(devUser);
    await storage.updateUserRole('dev-user-123', 'admin');

    // Attach user to request
    (req as any).user = {
      id: devUser.id,
      email: devUser.email,
    };

    return next();
  }

  // Get the authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized - No token provided' });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    // Verify the JWT with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.error('Token verification failed:', error);
      return res.status(401).json({ message: 'Unauthorized - Invalid token' });
    }

    // Upsert user in our database
    await storage.upsertUser({
      id: user.id,
      email: user.email || '',
      firstName: user.user_metadata?.first_name || user.user_metadata?.full_name?.split(' ')[0] || '',
      lastName: user.user_metadata?.last_name || user.user_metadata?.full_name?.split(' ').slice(1).join(' ') || '',
      profileImageUrl: user.user_metadata?.avatar_url || null,
    });

    // Attach user to request for use in route handlers
    (req as any).user = {
      id: user.id,
      email: user.email,
      claims: {
        sub: user.id,
        email: user.email,
      },
    };

    next();
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(401).json({ message: 'Unauthorized - Token verification failed' });
  }
};

// Get current user endpoint
export function setupUserEndpoint(app: Express) {
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.json(user);
    } catch (error) {
      console.error('Error fetching user:', error);
      res.status(500).json({ message: 'Failed to fetch user' });
    }
  });
}
