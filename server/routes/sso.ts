/**
 * SSO (OIDC) Routes for Enterprise Customers
 *
 * Handles:
 * - GET  /api/sso/config            - Get SSO config for current user's practice (admin only)
 * - POST /api/sso/config            - Create/update SSO configuration (admin only)
 * - GET  /api/sso/check/:practiceId - Check if SSO is enabled for a practice (public)
 * - GET  /api/sso/check-domain      - Check if SSO is available for an email domain (public)
 * - GET  /api/sso/login/:practiceId - Initiate OIDC login flow (redirects to IdP)
 * - GET  /api/sso/callback/oidc     - Handle OIDC callback from IdP
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import * as oidc from 'openid-client';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { encryptField, decryptField } from '../services/phiEncryptionService';
import logger from '../services/logger';

const router = Router();

// ==================== OIDC Configuration Cache ====================

// Cache discovered OIDC configurations to avoid repeated network calls
const oidcConfigCache = new Map<number, { config: oidc.Configuration; expiresAt: number }>();
const OIDC_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Discover and cache an openid-client Configuration for a practice's SSO config.
 */
async function getOidcConfiguration(ssoConfig: {
  practiceId: number;
  issuerUrl: string | null;
  clientId: string | null;
  clientSecret: any;
}): Promise<oidc.Configuration> {
  const cached = oidcConfigCache.get(ssoConfig.practiceId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  if (!ssoConfig.issuerUrl || !ssoConfig.clientId) {
    throw new Error('SSO configuration is incomplete: issuer URL and client ID are required');
  }

  // Decrypt client secret if stored encrypted
  const rawSecret = ssoConfig.clientSecret
    ? decryptField(ssoConfig.clientSecret as any)
    : undefined;

  const issuerUrl = new URL(ssoConfig.issuerUrl);

  const config = await oidc.discovery(
    issuerUrl,
    ssoConfig.clientId,
    rawSecret
      ? { token_endpoint_auth_method: 'client_secret_post' }
      : undefined,
    rawSecret
      ? oidc.ClientSecretPost(rawSecret)
      : undefined,
  );

  oidcConfigCache.set(ssoConfig.practiceId, {
    config,
    expiresAt: Date.now() + OIDC_CACHE_TTL_MS,
  });

  return config;
}

// ==================== Middleware ====================

const isAdmin = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const user = await storage.getUser(req.user.claims.sub);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }
    next();
  } catch (error) {
    logger.error('Error checking admin role for SSO', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to verify permissions' });
  }
};

// ==================== SSO Config CRUD ====================

/**
 * GET /config
 * Retrieve SSO configuration for the current user's practice.
 */
router.get('/config', isAuthenticated, isAdmin, async (req: any, res: Response) => {
  try {
    const userId = req.user?.claims?.sub;
    const user = await storage.getUser(userId);
    if (!user?.practiceId) {
      return res.status(400).json({ message: 'User is not assigned to a practice' });
    }

    const config = await storage.getSsoConfigByPractice(user.practiceId);
    if (!config) {
      return res.json(null);
    }

    // Mask the client secret for display
    const hasSecret = !!config.clientSecret;
    res.json({
      ...config,
      clientSecret: hasSecret ? '****' : '',
    });
  } catch (error) {
    logger.error('Error fetching SSO config', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch SSO configuration' });
  }
});

/**
 * POST /config
 * Create or update SSO configuration for the current user's practice.
 */
router.post('/config', isAuthenticated, isAdmin, async (req: any, res: Response) => {
  try {
    const userId = req.user?.claims?.sub;
    const user = await storage.getUser(userId);
    if (!user?.practiceId) {
      return res.status(400).json({ message: 'User is not assigned to a practice' });
    }

    const {
      provider, protocol, clientId, clientSecret,
      issuerUrl, callbackUrl, metadataUrl, emailDomain,
      enabled, ssoEnforced,
    } = req.body;

    // Validate required fields
    if (!provider || !protocol) {
      return res.status(400).json({ message: 'Provider and protocol are required' });
    }

    const validProviders = ['okta', 'azure-ad', 'google', 'custom'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ message: `Provider must be one of: ${validProviders.join(', ')}` });
    }

    if (protocol === 'oidc' && (!clientId || !issuerUrl)) {
      return res.status(400).json({ message: 'Client ID and Issuer URL are required for OIDC' });
    }

    // Build config data
    const configData: any = {
      practiceId: user.practiceId,
      provider,
      protocol,
      clientId: clientId || null,
      issuerUrl: issuerUrl || null,
      callbackUrl: callbackUrl || null,
      metadataUrl: metadataUrl || null,
      emailDomain: emailDomain?.toLowerCase().trim() || null,
      enabled: enabled ?? false,
      ssoEnforced: ssoEnforced ?? false,
    };

    // Only update client secret if a new value was provided (not the masked placeholder)
    if (clientSecret && !clientSecret.startsWith('****')) {
      configData.clientSecret = encryptField(clientSecret);
    } else {
      // Preserve existing encrypted secret
      const existing = await storage.getSsoConfigByPractice(user.practiceId);
      if (existing) {
        configData.clientSecret = existing.clientSecret;
      }
    }

    const saved = await storage.upsertSsoConfig(configData);

    // Invalidate OIDC config cache for this practice
    oidcConfigCache.delete(user.practiceId);

    logger.info('SSO configuration updated', {
      practiceId: user.practiceId,
      provider,
      protocol,
      enabled: configData.enabled,
      ssoEnforced: configData.ssoEnforced,
      emailDomain: configData.emailDomain,
      userId,
    });

    res.json({
      ...saved,
      clientSecret: saved.clientSecret ? '****' : '',
    });
  } catch (error) {
    logger.error('Error saving SSO config', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to save SSO configuration' });
  }
});

// ==================== SSO Lookup (Public) ====================

/**
 * GET /check/:practiceId
 * Check if SSO is enabled for a practice.
 */
router.get('/check/:practiceId', async (req: Request, res: Response) => {
  try {
    const practiceId = parseInt(req.params.practiceId);
    if (isNaN(practiceId)) {
      return res.status(400).json({ message: 'Invalid practice ID' });
    }

    const config = await storage.getSsoConfigByPractice(practiceId);
    if (!config || !config.enabled) {
      return res.json({ ssoEnabled: false, provider: null, protocol: null });
    }

    res.json({
      ssoEnabled: true,
      provider: config.provider,
      protocol: config.protocol,
      ssoEnforced: config.ssoEnforced ?? false,
    });
  } catch (error) {
    logger.error('Error checking SSO status', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to check SSO status' });
  }
});

/**
 * GET /check-domain
 * Check if SSO is available for an email domain.
 * Query param: ?email=user@acme.com
 */
router.get('/check-domain', async (req: Request, res: Response) => {
  try {
    const email = req.query.email as string;
    if (!email || !email.includes('@')) {
      return res.json({ ssoEnabled: false });
    }

    const domain = email.split('@')[1].toLowerCase();
    const config = await storage.getSsoConfigByEmailDomain(domain);

    if (!config || !config.enabled) {
      return res.json({ ssoEnabled: false });
    }

    res.json({
      ssoEnabled: true,
      practiceId: config.practiceId,
      provider: config.provider,
      ssoEnforced: config.ssoEnforced ?? false,
    });
  } catch (error) {
    logger.error('Error checking SSO domain', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to check SSO status' });
  }
});

// ==================== OIDC Login Flow ====================

/**
 * GET /login/:practiceId
 * Initiate OIDC login flow. Redirects the user to the identity provider.
 */
router.get('/login/:practiceId', async (req: Request, res: Response) => {
  try {
    const practiceId = parseInt(req.params.practiceId);
    if (isNaN(practiceId)) {
      return res.status(400).json({ message: 'Invalid practice ID' });
    }

    const ssoConfig = await storage.getSsoConfigByPractice(practiceId);
    if (!ssoConfig || !ssoConfig.enabled || ssoConfig.protocol !== 'oidc') {
      return res.status(404).json({ message: 'SSO is not configured or not enabled for this practice' });
    }

    const oidcConfig = await getOidcConfiguration(ssoConfig);

    // Generate PKCE parameters for security
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();

    // Store OIDC session parameters for the callback
    const session = req.session as any;
    session.oidcState = state;
    session.oidcNonce = nonce;
    session.oidcCodeVerifier = codeVerifier;
    session.oidcPracticeId = practiceId;

    // Determine callback URL
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = ssoConfig.callbackUrl || `${baseUrl}/api/sso/callback/oidc`;

    // Build the authorization URL with PKCE
    const authUrl = oidc.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: redirectUri,
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    logger.info('Initiating OIDC SSO login', { practiceId, provider: ssoConfig.provider });
    res.redirect(authUrl.toString());
  } catch (error) {
    logger.error('Failed to initiate SSO login', { error: error instanceof Error ? error.message : String(error) });
    res.redirect('/?sso_error=configuration');
  }
});

/**
 * GET /callback/oidc
 * Handle OIDC callback from the identity provider.
 * Validates the authorization code via PKCE, fetches user info, and creates/links the user.
 */
router.get('/callback/oidc', async (req: Request, res: Response) => {
  try {
    const session = req.session as any;
    const { oidcState, oidcNonce, oidcCodeVerifier, oidcPracticeId } = session;

    if (!oidcState || !oidcCodeVerifier || !oidcPracticeId) {
      logger.warn('SSO callback: missing session state — session may have expired');
      return res.redirect('/?sso_error=session_expired');
    }

    const practiceId = oidcPracticeId;

    // Clean up OIDC session data immediately (prevents replay)
    delete session.oidcState;
    delete session.oidcNonce;
    delete session.oidcCodeVerifier;
    delete session.oidcPracticeId;

    const ssoConfig = await storage.getSsoConfigByPractice(practiceId);
    if (!ssoConfig || !ssoConfig.enabled || ssoConfig.protocol !== 'oidc') {
      return res.redirect('/?sso_error=configuration');
    }

    const oidcConfig = await getOidcConfiguration(ssoConfig);

    // Build the current URL for the token exchange
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = ssoConfig.callbackUrl || `${baseUrl}/api/sso/callback/oidc`;
    const currentUrl = new URL(
      `${redirectUri}?${new URLSearchParams(req.query as Record<string, string>).toString()}`
    );

    // Exchange authorization code for tokens using openid-client (validates PKCE, state, nonce)
    const tokenResponse = await oidc.authorizationCodeGrant(oidcConfig, currentUrl, {
      expectedState: oidcState,
      expectedNonce: oidcNonce,
      pkceCodeVerifier: oidcCodeVerifier,
    });

    // Extract user information from the ID token claims
    const claims = tokenResponse.claims();
    if (!claims) {
      logger.error('SSO callback: no ID token claims received');
      return res.redirect('/?sso_error=no_claims');
    }

    const externalId = claims.sub;
    const email = (claims.email as string)?.toLowerCase();
    const firstName = (claims.given_name as string) || (claims.name as string) || '';
    const lastName = (claims.family_name as string) || '';

    if (!email) {
      // Try fetching from userinfo endpoint
      try {
        const userinfo = await oidc.fetchUserInfo(
          oidcConfig,
          tokenResponse.access_token,
          externalId,
        );
        if (userinfo.email) {
          return await completeOidcLogin(req, res, {
            externalId,
            email: (userinfo.email as string).toLowerCase(),
            firstName: (userinfo.given_name as string) || firstName,
            lastName: (userinfo.family_name as string) || lastName,
            provider: ssoConfig.provider,
            practiceId,
          });
        }
      } catch (userinfoErr) {
        logger.warn('Failed to fetch userinfo', { error: userinfoErr instanceof Error ? userinfoErr.message : String(userinfoErr) });
      }

      logger.error('SSO callback: no email in claims or userinfo', { sub: externalId });
      return res.redirect('/?sso_error=no_email');
    }

    await completeOidcLogin(req, res, {
      externalId,
      email,
      firstName,
      lastName,
      provider: ssoConfig.provider,
      practiceId,
    });
  } catch (error) {
    logger.error('SSO callback error', { error: error instanceof Error ? error.message : String(error) });
    res.redirect('/?sso_error=callback_failed');
  }
});

/**
 * Complete the OIDC login: find or create user, create session, redirect.
 */
async function completeOidcLogin(
  req: Request,
  res: Response,
  params: {
    externalId: string;
    email: string;
    firstName: string;
    lastName: string;
    provider: string;
    practiceId: number;
  },
): Promise<void> {
  const { externalId, email, firstName, lastName, provider, practiceId } = params;

  // Find or create user
  let user = await storage.getUserBySsoExternalId(provider, externalId);

  if (!user) {
    // Check if a user with this email already exists
    user = await storage.getUserByEmail(email);

    if (user) {
      // Link the existing user to this SSO provider
      await storage.updateUser(user.id, {
        ssoProvider: provider,
        ssoExternalId: externalId,
        practiceId: user.practiceId || practiceId,
      } as any);
      user = await storage.getUser(user.id);
    } else {
      // Auto-provision a new user
      const { nanoid } = await import('nanoid');
      const userId = nanoid();
      user = await storage.upsertUser({
        id: userId,
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        practiceId,
        role: 'therapist',
        ssoProvider: provider,
        ssoExternalId: externalId,
        emailVerified: true, // SSO-verified emails are trusted
      } as any);

      logger.info('Auto-provisioned SSO user', { userId, email, provider, practiceId });
    }
  }

  if (!user) {
    logger.error('SSO: failed to find or create user', { email, externalId });
    res.redirect('/?sso_error=user_creation_failed');
    return;
  }

  // Update last login
  await storage.updateLastLoginAt(user.id);

  // Create session matching passport-local format
  const userSession = {
    claims: {
      sub: user.id,
      email: user.email,
      first_name: user.firstName,
      last_name: user.lastName,
    },
    expires_at: Math.floor(Date.now() / 1000) + 86400, // 24 hours
  };

  // Regenerate session for security (prevents session fixation)
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      logger.error('SSO session regeneration error', { error: regenErr });
      res.redirect('/?sso_error=session');
      return;
    }

    req.login(userSession as any, (loginErr) => {
      if (loginErr) {
        logger.error('SSO session login error', { error: loginErr });
        res.redirect('/?sso_error=session');
        return;
      }

      // SSO users bypass MFA since the IdP handles strong authentication
      (req.session as any).mfaVerifiedAt = Date.now();
      (req.session as any).mfaUserId = user!.id;

      logger.info('SSO login successful', {
        userId: user!.id,
        provider,
        practiceId,
      });

      res.redirect('/');
    });
  });
}

export default router;
