/**
 * SSO (SAML/OIDC) Routes for Enterprise Customers
 *
 * Handles:
 * - GET /api/sso/config — get SSO config for a practice (admin only)
 * - POST /api/sso/config — create/update SSO configuration (admin only)
 * - GET /api/sso/login/:practiceId — initiate SSO login (redirects to IdP)
 * - POST /api/sso/callback/oidc — OIDC callback handler
 * - POST /api/sso/callback/saml — SAML callback handler
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import * as crypto from 'crypto';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { encryptField, decryptField } from '../services/phiEncryptionService';
import logger from '../services/logger';
import { db } from '../db';
import { ssoConfigurations, users } from '../../shared/schema';
import { eq, and } from 'drizzle-orm';

const router = Router();

// ==================== Helpers ====================

// Admin check middleware
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

// Get the authorized practice ID from the request
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) {
    return req.authorizedPracticeId;
  }
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;
  if (userRole === 'admin') {
    return requestedPracticeId || userPracticeId || 1;
  }
  return userPracticeId || 1;
};

// ==================== SSO Config CRUD ====================

// GET /api/sso/config — retrieve SSO configuration for a practice
router.get('/config', isAuthenticated, isAdmin, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);

    const [config] = await db
      .select()
      .from(ssoConfigurations)
      .where(eq(ssoConfigurations.practiceId, practiceId));

    if (!config) {
      return res.json(null);
    }

    // Decrypt clientSecret for display (masked)
    const clientSecretDecrypted = config.clientSecret
      ? decryptField(config.clientSecret as any)
      : null;

    res.json({
      id: config.id,
      practiceId: config.practiceId,
      provider: config.provider,
      protocol: config.protocol,
      clientId: config.clientId,
      // Mask the client secret - only show last 4 chars
      clientSecret: clientSecretDecrypted
        ? '****' + clientSecretDecrypted.slice(-4)
        : null,
      issuerUrl: config.issuerUrl,
      callbackUrl: config.callbackUrl,
      metadataUrl: config.metadataUrl,
      enabled: config.enabled,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });
  } catch (error) {
    logger.error('Error fetching SSO config', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch SSO configuration' });
  }
});

// POST /api/sso/config — create or update SSO configuration
router.post('/config', isAuthenticated, isAdmin, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { provider, protocol, clientId, clientSecret, issuerUrl, callbackUrl, metadataUrl, enabled } = req.body;

    // Validate required fields
    if (!provider || !protocol) {
      return res.status(400).json({ message: 'Provider and protocol are required' });
    }

    const validProviders = ['okta', 'azure-ad', 'google', 'custom'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ message: `Provider must be one of: ${validProviders.join(', ')}` });
    }

    const validProtocols = ['saml', 'oidc'];
    if (!validProtocols.includes(protocol)) {
      return res.status(400).json({ message: `Protocol must be one of: ${validProtocols.join(', ')}` });
    }

    if (protocol === 'oidc' && (!clientId || !issuerUrl)) {
      return res.status(400).json({ message: 'Client ID and Issuer URL are required for OIDC' });
    }

    if (protocol === 'saml' && !metadataUrl && !issuerUrl) {
      return res.status(400).json({ message: 'Metadata URL or Issuer URL is required for SAML' });
    }

    // Encrypt the client secret
    const encryptedSecret = clientSecret ? encryptField(clientSecret) : undefined;

    // Check for existing config
    const [existing] = await db
      .select()
      .from(ssoConfigurations)
      .where(eq(ssoConfigurations.practiceId, practiceId));

    let result;
    if (existing) {
      // Update existing config
      const updateData: Record<string, any> = {
        provider,
        protocol,
        clientId: clientId || null,
        issuerUrl: issuerUrl || null,
        callbackUrl: callbackUrl || null,
        metadataUrl: metadataUrl || null,
        enabled: enabled ?? existing.enabled,
        updatedAt: new Date(),
      };
      // Only update secret if a new one was provided
      if (encryptedSecret !== undefined) {
        updateData.clientSecret = encryptedSecret;
      }
      [result] = await db
        .update(ssoConfigurations)
        .set(updateData)
        .where(eq(ssoConfigurations.id, existing.id))
        .returning();
    } else {
      // Create new config
      [result] = await db
        .insert(ssoConfigurations)
        .values({
          practiceId,
          provider,
          protocol,
          clientId: clientId || null,
          clientSecret: encryptedSecret || null,
          issuerUrl: issuerUrl || null,
          callbackUrl: callbackUrl || null,
          metadataUrl: metadataUrl || null,
          enabled: enabled ?? false,
        })
        .returning();
    }

    logger.info('SSO configuration saved', { practiceId, provider, protocol });

    res.json({
      id: result.id,
      practiceId: result.practiceId,
      provider: result.provider,
      protocol: result.protocol,
      clientId: result.clientId,
      clientSecret: clientSecret ? '****' + clientSecret.slice(-4) : null,
      issuerUrl: result.issuerUrl,
      callbackUrl: result.callbackUrl,
      metadataUrl: result.metadataUrl,
      enabled: result.enabled,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    logger.error('Error saving SSO config', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to save SSO configuration' });
  }
});

// ==================== SSO Login Flow ====================

// GET /api/sso/login/:practiceId — initiate SSO login
router.get('/login/:practiceId', async (req: Request, res: Response) => {
  try {
    const practiceId = parseInt(req.params.practiceId);
    if (isNaN(practiceId)) {
      return res.status(400).json({ message: 'Invalid practice ID' });
    }

    // Look up SSO config for this practice
    const [config] = await db
      .select()
      .from(ssoConfigurations)
      .where(and(
        eq(ssoConfigurations.practiceId, practiceId),
        eq(ssoConfigurations.enabled, true)
      ));

    if (!config) {
      return res.status(404).json({ message: 'SSO is not configured or not enabled for this practice' });
    }

    if (config.protocol === 'oidc') {
      return handleOidcLogin(req, res, config);
    } else if (config.protocol === 'saml') {
      return handleSamlLogin(req, res, config);
    }

    res.status(400).json({ message: 'Unsupported SSO protocol' });
  } catch (error) {
    logger.error('Error initiating SSO login', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to initiate SSO login' });
  }
});

// OIDC login handler
async function handleOidcLogin(req: Request, res: Response, config: any) {
  try {
    const { discovery } = await import('openid-client');

    const issuerUrl = new URL(config.issuerUrl);
    const clientId = config.clientId;
    const clientSecret = config.clientSecret ? decryptField(config.clientSecret) : undefined;

    // Build the callback URL
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const redirectUri = config.callbackUrl || `${baseUrl}/api/sso/callback/oidc`;

    // Generate state parameter for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    // Generate nonce for replay protection
    const nonce = crypto.randomBytes(16).toString('hex');

    // Store state, nonce, and practiceId in session for verification
    const session = req.session as any;
    session.ssoState = state;
    session.ssoNonce = nonce;
    session.ssoPracticeId = config.practiceId;

    // Discover the OpenID Provider configuration
    const oidcConfig = await discovery(issuerUrl, clientId, clientSecret || undefined);

    // Build authorization URL
    const authorizationUrl = new URL(oidcConfig.serverMetadata().authorization_endpoint as string);
    authorizationUrl.searchParams.set('client_id', clientId);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', 'openid email profile');
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('nonce', nonce);

    res.redirect(authorizationUrl.toString());
  } catch (error) {
    logger.error('OIDC login initiation failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to initiate OIDC login' });
  }
}

// SAML login handler
async function handleSamlLogin(req: Request, res: Response, config: any) {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const callbackUrl = config.callbackUrl || `${baseUrl}/api/sso/callback/saml`;

    // Generate a SAML AuthnRequest
    const requestId = '_' + crypto.randomBytes(16).toString('hex');
    const issueInstant = new Date().toISOString();

    // Store request ID and practice ID in session for validation
    const session = req.session as any;
    session.samlRequestId = requestId;
    session.ssoPracticeId = config.practiceId;

    const issuerUrl = config.issuerUrl || config.metadataUrl;

    // Build SAML AuthnRequest XML
    const authnRequest = [
      '<samlp:AuthnRequest',
      '  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
      '  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
      `  ID="${requestId}"`,
      '  Version="2.0"',
      `  IssueInstant="${issueInstant}"`,
      `  AssertionConsumerServiceURL="${callbackUrl}"`,
      '  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">',
      `  <saml:Issuer>${baseUrl}</saml:Issuer>`,
      '  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>',
      '</samlp:AuthnRequest>',
    ].join('\n');

    // Base64 encode and URL encode the request
    const encodedRequest = Buffer.from(authnRequest).toString('base64');

    // Redirect to IdP's SSO URL with the SAML request
    const ssoUrl = new URL(issuerUrl);
    ssoUrl.searchParams.set('SAMLRequest', encodedRequest);

    res.redirect(ssoUrl.toString());
  } catch (error) {
    logger.error('SAML login initiation failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to initiate SAML login' });
  }
}

// ==================== SSO Callbacks ====================

// POST /api/sso/callback/oidc — OIDC callback handler
router.post('/callback/oidc', async (req: Request, res: Response) => {
  try {
    const session = req.session as any;
    const { code, state } = req.body;

    // Verify state to prevent CSRF
    if (!state || state !== session.ssoState) {
      return res.status(400).json({ message: 'Invalid state parameter - possible CSRF attack' });
    }

    const practiceId = session.ssoPracticeId;
    if (!practiceId) {
      return res.status(400).json({ message: 'SSO session expired, please try again' });
    }

    // Look up SSO config
    const [config] = await db
      .select()
      .from(ssoConfigurations)
      .where(and(
        eq(ssoConfigurations.practiceId, practiceId),
        eq(ssoConfigurations.enabled, true)
      ));

    if (!config) {
      return res.status(404).json({ message: 'SSO configuration not found' });
    }

    const { discovery } = await import('openid-client');

    const issuerUrl = new URL(config.issuerUrl!);
    const clientId = config.clientId!;
    const clientSecret = config.clientSecret ? decryptField(config.clientSecret as any) : undefined;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const redirectUri = config.callbackUrl || `${baseUrl}/api/sso/callback/oidc`;

    // Discover OIDC provider
    const oidcConfig = await discovery(issuerUrl, clientId, clientSecret || undefined);

    // Exchange code for tokens
    const tokenEndpoint = oidcConfig.serverMetadata().token_endpoint;
    if (!tokenEndpoint) {
      return res.status(500).json({ message: 'Token endpoint not found in OIDC configuration' });
    }

    const tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      logger.error('OIDC token exchange failed', { status: tokenResponse.status, error: errorText });
      return res.status(400).json({ message: 'Failed to exchange authorization code' });
    }

    const tokens = await tokenResponse.json() as Record<string, any>;

    // Get user info from ID token or userinfo endpoint
    let userInfo: Record<string, any> = {};

    if (tokens.id_token) {
      // Decode the ID token (JWT) to get user claims
      const parts = tokens.id_token.split('.');
      if (parts.length === 3) {
        try {
          userInfo = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        } catch {
          logger.warn('Failed to decode ID token');
        }
      }
    }

    // If no email from id_token, try userinfo endpoint
    if (!userInfo.email && oidcConfig.serverMetadata().userinfo_endpoint) {
      const userinfoResponse = await fetch(oidcConfig.serverMetadata().userinfo_endpoint as string, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userinfoResponse.ok) {
        userInfo = await userinfoResponse.json() as Record<string, any>;
      }
    }

    if (!userInfo.email && !userInfo.sub) {
      return res.status(400).json({ message: 'Could not retrieve user information from SSO provider' });
    }

    // Create or link user
    const user = await findOrCreateSsoUser({
      email: userInfo.email,
      firstName: userInfo.given_name || userInfo.name?.split(' ')[0],
      lastName: userInfo.family_name || userInfo.name?.split(' ').slice(1).join(' '),
      ssoExternalId: userInfo.sub,
      ssoProvider: config.provider,
      practiceId,
    });

    // Create session
    await createSsoSession(req, user);

    // Clean up SSO session state
    delete session.ssoState;
    delete session.ssoNonce;
    delete session.ssoPracticeId;

    logger.info('OIDC SSO login successful', { userId: user.id, practiceId });

    // Redirect to the dashboard
    res.redirect('/');
  } catch (error) {
    logger.error('OIDC callback error', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'SSO authentication failed' });
  }
});

// Also handle GET for OIDC callback (some providers redirect with GET)
router.get('/callback/oidc', async (req: Request, res: Response) => {
  try {
    const session = req.session as any;
    const { code, state } = req.query;

    if (!state || state !== session.ssoState) {
      return res.status(400).json({ message: 'Invalid state parameter - possible CSRF attack' });
    }

    const practiceId = session.ssoPracticeId;
    if (!practiceId) {
      return res.status(400).json({ message: 'SSO session expired, please try again' });
    }

    const [config] = await db
      .select()
      .from(ssoConfigurations)
      .where(and(
        eq(ssoConfigurations.practiceId, practiceId),
        eq(ssoConfigurations.enabled, true)
      ));

    if (!config) {
      return res.status(404).json({ message: 'SSO configuration not found' });
    }

    const { discovery } = await import('openid-client');

    const issuerUrl = new URL(config.issuerUrl!);
    const clientId = config.clientId!;
    const clientSecret = config.clientSecret ? decryptField(config.clientSecret as any) : undefined;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const redirectUri = config.callbackUrl || `${baseUrl}/api/sso/callback/oidc`;

    const oidcConfig = await discovery(issuerUrl, clientId, clientSecret || undefined);

    const tokenEndpoint = oidcConfig.serverMetadata().token_endpoint;
    if (!tokenEndpoint) {
      return res.status(500).json({ message: 'Token endpoint not found' });
    }

    const tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri,
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      }),
    });

    if (!tokenResponse.ok) {
      return res.status(400).json({ message: 'Failed to exchange authorization code' });
    }

    const tokens = await tokenResponse.json() as Record<string, any>;
    let userInfo: Record<string, any> = {};

    if (tokens.id_token) {
      const parts = tokens.id_token.split('.');
      if (parts.length === 3) {
        try {
          userInfo = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        } catch {
          logger.warn('Failed to decode ID token');
        }
      }
    }

    if (!userInfo.email && oidcConfig.serverMetadata().userinfo_endpoint) {
      const userinfoResponse = await fetch(oidcConfig.serverMetadata().userinfo_endpoint as string, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userinfoResponse.ok) {
        userInfo = await userinfoResponse.json() as Record<string, any>;
      }
    }

    if (!userInfo.email && !userInfo.sub) {
      return res.status(400).json({ message: 'Could not retrieve user information from SSO provider' });
    }

    const user = await findOrCreateSsoUser({
      email: userInfo.email,
      firstName: userInfo.given_name || userInfo.name?.split(' ')[0],
      lastName: userInfo.family_name || userInfo.name?.split(' ').slice(1).join(' '),
      ssoExternalId: userInfo.sub,
      ssoProvider: config.provider,
      practiceId,
    });

    await createSsoSession(req, user);

    delete session.ssoState;
    delete session.ssoNonce;
    delete session.ssoPracticeId;

    logger.info('OIDC SSO login successful (GET)', { userId: user.id, practiceId });

    res.redirect('/');
  } catch (error) {
    logger.error('OIDC callback error (GET)', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'SSO authentication failed' });
  }
});

// POST /api/sso/callback/saml — SAML callback handler
router.post('/callback/saml', async (req: Request, res: Response) => {
  try {
    const session = req.session as any;
    const { SAMLResponse } = req.body;

    if (!SAMLResponse) {
      return res.status(400).json({ message: 'Missing SAML response' });
    }

    const practiceId = session.ssoPracticeId;
    if (!practiceId) {
      return res.status(400).json({ message: 'SSO session expired, please try again' });
    }

    // Decode the SAML response (Base64)
    const samlXml = Buffer.from(SAMLResponse, 'base64').toString('utf8');

    // TODO: Validate SAML signature for production use.
    // For now, we parse the assertion to extract user attributes.
    // In production, use a library like xml-crypto to verify the XML signature
    // against the IdP's public certificate.

    // Parse user attributes from SAML assertion using basic XML extraction
    const samlUser = parseSamlAssertion(samlXml);

    if (!samlUser.email && !samlUser.nameId) {
      return res.status(400).json({ message: 'Could not extract user information from SAML assertion' });
    }

    // Look up SSO config for the practice
    const [config] = await db
      .select()
      .from(ssoConfigurations)
      .where(and(
        eq(ssoConfigurations.practiceId, practiceId),
        eq(ssoConfigurations.enabled, true)
      ));

    if (!config) {
      return res.status(404).json({ message: 'SSO configuration not found' });
    }

    // Create or link user
    const user = await findOrCreateSsoUser({
      email: samlUser.email || samlUser.nameId || '',
      firstName: samlUser.firstName || undefined,
      lastName: samlUser.lastName || undefined,
      ssoExternalId: samlUser.nameId || samlUser.email || '',
      ssoProvider: config.provider,
      practiceId,
    });

    // Create session
    await createSsoSession(req, user);

    // Clean up SSO session state
    delete session.samlRequestId;
    delete session.ssoPracticeId;

    logger.info('SAML SSO login successful', { userId: user.id, practiceId });

    // Redirect to the dashboard
    res.redirect('/');
  } catch (error) {
    logger.error('SAML callback error', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'SSO authentication failed' });
  }
});

// ==================== SSO Lookup (Public) ====================

// GET /api/sso/check/:practiceId — check if SSO is enabled for a practice (public)
router.get('/check/:practiceId', async (req: Request, res: Response) => {
  try {
    const practiceId = parseInt(req.params.practiceId);
    if (isNaN(practiceId)) {
      return res.status(400).json({ message: 'Invalid practice ID' });
    }

    const [config] = await db
      .select({
        enabled: ssoConfigurations.enabled,
        provider: ssoConfigurations.provider,
        protocol: ssoConfigurations.protocol,
      })
      .from(ssoConfigurations)
      .where(and(
        eq(ssoConfigurations.practiceId, practiceId),
        eq(ssoConfigurations.enabled, true)
      ));

    res.json({
      ssoEnabled: !!config,
      provider: config?.provider || null,
      protocol: config?.protocol || null,
    });
  } catch (error) {
    logger.error('Error checking SSO status', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to check SSO status' });
  }
});

// ==================== Helper Functions ====================

/**
 * Parse a SAML assertion XML to extract user attributes.
 * This is a basic parser that extracts common attributes.
 * TODO: For production, use a proper XML parser with signature validation.
 */
function parseSamlAssertion(xml: string): {
  nameId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
} {
  const result = {
    nameId: null as string | null,
    email: null as string | null,
    firstName: null as string | null,
    lastName: null as string | null,
  };

  // Extract NameID
  const nameIdMatch = xml.match(/<(?:saml2?:)?NameID[^>]*>([^<]+)<\/(?:saml2?:)?NameID>/);
  if (nameIdMatch) {
    result.nameId = nameIdMatch[1].trim();
  }

  // Extract email from attributes
  const emailPatterns = [
    /Name="(?:http:\/\/schemas\.xmlsoap\.org\/ws\/2005\/05\/identity\/claims\/emailaddress|email|Email|mail)"[^>]*>\s*<(?:saml2?:)?AttributeValue[^>]*>([^<]+)/,
    /Name="(?:urn:oid:0\.9\.2342\.19200300\.100\.1\.3)"[^>]*>\s*<(?:saml2?:)?AttributeValue[^>]*>([^<]+)/,
  ];
  for (const pattern of emailPatterns) {
    const match = xml.match(pattern);
    if (match) {
      result.email = match[1].trim();
      break;
    }
  }

  // If no email found, try NameID if it looks like an email
  if (!result.email && result.nameId && result.nameId.includes('@')) {
    result.email = result.nameId;
  }

  // Extract first name
  const firstNamePatterns = [
    /Name="(?:http:\/\/schemas\.xmlsoap\.org\/ws\/2005\/05\/identity\/claims\/givenname|firstName|FirstName|givenName)"[^>]*>\s*<(?:saml2?:)?AttributeValue[^>]*>([^<]+)/,
    /Name="(?:urn:oid:2\.5\.4\.42)"[^>]*>\s*<(?:saml2?:)?AttributeValue[^>]*>([^<]+)/,
  ];
  for (const pattern of firstNamePatterns) {
    const match = xml.match(pattern);
    if (match) {
      result.firstName = match[1].trim();
      break;
    }
  }

  // Extract last name
  const lastNamePatterns = [
    /Name="(?:http:\/\/schemas\.xmlsoap\.org\/ws\/2005\/05\/identity\/claims\/surname|lastName|LastName|sn)"[^>]*>\s*<(?:saml2?:)?AttributeValue[^>]*>([^<]+)/,
    /Name="(?:urn:oid:2\.5\.4\.4)"[^>]*>\s*<(?:saml2?:)?AttributeValue[^>]*>([^<]+)/,
  ];
  for (const pattern of lastNamePatterns) {
    const match = xml.match(pattern);
    if (match) {
      result.lastName = match[1].trim();
      break;
    }
  }

  return result;
}

/**
 * Find an existing user by SSO external ID or email, or create a new one.
 * Auto-provisions users on first SSO login.
 */
async function findOrCreateSsoUser(params: {
  email: string;
  firstName?: string;
  lastName?: string;
  ssoExternalId: string;
  ssoProvider: string;
  practiceId: number;
}) {
  const { email, firstName, lastName, ssoExternalId, ssoProvider, practiceId } = params;

  // First, try to find by SSO external ID
  const allUsers = await storage.getAllUsers();
  let existingUser = allUsers.find(
    (u) => u.ssoExternalId === ssoExternalId && u.ssoProvider === ssoProvider
  );

  if (existingUser) {
    // Update last login
    await storage.updateLastLoginAt(existingUser.id);
    return existingUser;
  }

  // Try to find by email
  if (email) {
    existingUser = await storage.getUserByEmail(email.toLowerCase());
    if (existingUser) {
      // Link existing user to SSO
      await db
        .update(users)
        .set({
          ssoProvider,
          ssoExternalId,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingUser.id));
      await storage.updateLastLoginAt(existingUser.id);
      return { ...existingUser, ssoProvider, ssoExternalId };
    }
  }

  // Create a new user (auto-provision)
  const { nanoid } = await import('nanoid');
  const userId = nanoid();

  const newUser = await storage.upsertUser({
    id: userId,
    email: email?.toLowerCase(),
    firstName: firstName || null,
    lastName: lastName || null,
    practiceId,
    role: 'therapist', // Default role for SSO-provisioned users
  } as any);

  // Set SSO fields
  await db
    .update(users)
    .set({
      ssoProvider,
      ssoExternalId,
      emailVerified: true, // SSO-verified emails are trusted
    })
    .where(eq(users.id, userId));

  logger.info('Auto-provisioned SSO user', {
    userId,
    email,
    ssoProvider,
    practiceId,
  });

  return { ...newUser, ssoProvider, ssoExternalId };
}

/**
 * Create an authenticated session for an SSO user.
 * Mimics the session structure used by passport-local auth.
 */
async function createSsoSession(req: Request, user: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const sessionUser = {
      claims: {
        sub: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
      },
      // Set expiration to 24 hours from now (SSO sessions)
      expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    };

    req.login(sessionUser as any, (err) => {
      if (err) {
        logger.error('Failed to create SSO session', { error: err.message });
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

export default router;
