/**
 * MCP OAuth 2.1 Provider for Claude Desktop Connector Integration
 *
 * Implements the OAuthServerProvider interface from the MCP SDK so that
 * Claude Desktop's "Add custom connector" flow works via standard OAuth 2.1.
 *
 * Flow:
 *   1. Claude Desktop discovers endpoints via /.well-known/oauth-protected-resource/mcp
 *   2. Claude Desktop registers itself via POST /register (Dynamic Client Registration)
 *   3. Claude Desktop opens /authorize in a browser — user enters their TherapyBill API key
 *   4. User submits -> server validates key, issues auth code, redirects back to Claude Desktop
 *   5. Claude Desktop exchanges auth code for access token via POST /token
 *   6. Claude Desktop uses the access token as Bearer token on POST /mcp
 *
 * The access token IS the user's TherapyBill API key (validated at auth time).
 * This avoids maintaining a separate token store while keeping the OAuth flow standard.
 */

import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { authenticateKey } from './auth';
import logger from '../services/logger';

// ---------------------------------------------------------------------------
// In-memory client store for Dynamic Client Registration (DCR)
// ---------------------------------------------------------------------------

export class McpClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.clients.get(clientId);
  }

  async registerClient(
    clientMetadata: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
  ): Promise<OAuthClientInformationFull> {
    const clientId = `tbai_client_${randomUUID()}`;
    const full: OAuthClientInformationFull = {
      ...clientMetadata,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    } as OAuthClientInformationFull;
    this.clients.set(clientId, full);
    logger.info('MCP OAuth: registered client', { clientId, clientName: full.client_name });
    return full;
  }
}

// ---------------------------------------------------------------------------
// Authorization code store
// ---------------------------------------------------------------------------

interface AuthCodeEntry {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  apiKey: string; // The validated TherapyBill API key
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Access token store
// ---------------------------------------------------------------------------

interface TokenEntry {
  apiKey: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export class TherapyBillOAuthProvider implements OAuthServerProvider {
  clientsStore: McpClientsStore;

  /** code -> AuthCodeEntry (one-time use) */
  private codes = new Map<string, AuthCodeEntry>();

  /** accessToken -> TokenEntry */
  private tokens = new Map<string, TokenEntry>();

  /** Pending authorization sessions waiting for user to submit their API key */
  private pendingSessions = new Map<string, {
    client: OAuthClientInformationFull;
    params: AuthorizationParams;
    createdAt: number;
  }>();

  constructor() {
    this.clientsStore = new McpClientsStore();

    // Clean up expired entries every 10 minutes
    setInterval(() => this.cleanup(), 10 * 60 * 1000);
  }

  // -------------------------------------------------------------------------
  // authorize: render a page where the user enters their TherapyBill API key
  // -------------------------------------------------------------------------

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    // Create a pending session ID
    const sessionId = randomUUID();
    this.pendingSessions.set(sessionId, {
      client,
      params,
      createdAt: Date.now(),
    });

    // Render an HTML page where the user pastes their API key
    const html = this.renderAuthorizePage(sessionId, client.client_name);
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  }

  /**
   * Called by our custom POST /authorize/callback endpoint (see mcp-transport.ts).
   * Validates the API key, issues an auth code, and returns the redirect URL.
   */
  async completeAuthorization(
    sessionId: string,
    apiKey: string,
  ): Promise<{ redirectUrl: string } | { error: string }> {
    const session = this.pendingSessions.get(sessionId);
    if (!session) {
      return { error: 'Invalid or expired authorization session.' };
    }

    // Validate the API key against the database
    try {
      await authenticateKey(apiKey);
    } catch {
      return { error: 'Invalid API key. Please check your key and try again.' };
    }

    // Remove the pending session
    this.pendingSessions.delete(sessionId);

    // Issue authorization code
    const code = randomUUID();
    this.codes.set(code, {
      client: session.client,
      params: session.params,
      apiKey,
      createdAt: Date.now(),
    });

    // Build redirect URL with code and state
    const redirectUrl = new URL(session.params.redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (session.params.state !== undefined) {
      redirectUrl.searchParams.set('state', session.params.state);
    }

    logger.info('MCP OAuth: authorization completed', {
      clientId: session.client.client_id,
    });

    return { redirectUrl: redirectUrl.toString() };
  }

  // -------------------------------------------------------------------------
  // challengeForAuthorizationCode: return the PKCE code_challenge
  // -------------------------------------------------------------------------

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData) {
      throw new Error('Invalid authorization code');
    }
    return codeData.params.codeChallenge;
  }

  // -------------------------------------------------------------------------
  // exchangeAuthorizationCode: swap auth code for access token
  // -------------------------------------------------------------------------

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    _resource?: URL,
  ): Promise<OAuthTokens> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData) {
      throw new Error('Invalid authorization code');
    }

    if (codeData.client.client_id !== client.client_id) {
      throw new Error('Authorization code was not issued to this client');
    }

    // One-time use
    this.codes.delete(authorizationCode);

    // The access token is the validated API key itself.
    // This way, the MCP transport handler can authenticate with it directly.
    const accessToken = codeData.apiKey;
    const expiresIn = 365 * 24 * 3600; // 1 year — API keys don't expire by time

    this.tokens.set(accessToken, {
      apiKey: codeData.apiKey,
      clientId: client.client_id,
      scopes: codeData.params.scopes || [],
      expiresAt: Date.now() + expiresIn * 1000,
      resource: codeData.params.resource,
    });

    logger.info('MCP OAuth: token issued', { clientId: client.client_id });

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: expiresIn,
      scope: (codeData.params.scopes || []).join(' '),
    };
  }

  // -------------------------------------------------------------------------
  // exchangeRefreshToken: not needed — API keys are long-lived
  // -------------------------------------------------------------------------

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    _refreshToken: string,
    _scopes?: string[],
    _resource?: URL,
  ): Promise<OAuthTokens> {
    throw new Error('Refresh tokens are not supported. API keys are long-lived.');
  }

  // -------------------------------------------------------------------------
  // verifyAccessToken: validate the token (which is the API key)
  // -------------------------------------------------------------------------

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    // First check our token store
    const tokenData = this.tokens.get(token);
    if (tokenData) {
      if (tokenData.expiresAt < Date.now()) {
        this.tokens.delete(token);
        throw new Error('Token expired');
      }
      return {
        token,
        clientId: tokenData.clientId,
        scopes: tokenData.scopes,
        expiresAt: Math.floor(tokenData.expiresAt / 1000),
        resource: tokenData.resource,
      };
    }

    // Fall back to direct API key validation (for keys that were not
    // issued through the OAuth flow, e.g. direct Bearer token usage)
    try {
      const context = await authenticateKey(token);
      return {
        token,
        clientId: `direct_${context.practiceId}`,
        scopes: [],
        expiresAt: Math.floor((Date.now() + 365 * 24 * 3600 * 1000) / 1000),
      };
    } catch {
      throw new Error('Invalid or expired token');
    }
  }

  // -------------------------------------------------------------------------
  // revokeToken (optional)
  // -------------------------------------------------------------------------

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.tokens.delete(request.token);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private cleanup() {
    const now = Date.now();
    const codeMaxAge = 10 * 60 * 1000; // 10 minutes
    const sessionMaxAge = 15 * 60 * 1000; // 15 minutes

    this.codes.forEach((entry, code) => {
      if (now - entry.createdAt > codeMaxAge) {
        this.codes.delete(code);
      }
    });

    this.pendingSessions.forEach((session, id) => {
      if (now - session.createdAt > sessionMaxAge) {
        this.pendingSessions.delete(id);
      }
    });

    this.tokens.forEach((entry, token) => {
      if (entry.expiresAt < now) {
        this.tokens.delete(token);
      }
    });
  }

  private renderAuthorizePage(sessionId: string, clientName?: string): string {
    const displayName = clientName || 'Claude Desktop';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect ${displayName} to TherapyBill AI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8fafc;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 1rem;
    }
    .card {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -2px rgba(0,0,0,.1);
      padding: 2rem;
      max-width: 460px;
      width: 100%;
    }
    .logo { font-size: 1.5rem; font-weight: 700; color: #1e293b; margin-bottom: .25rem; }
    .subtitle { color: #64748b; font-size: .875rem; margin-bottom: 1.5rem; }
    label { display: block; font-weight: 500; font-size: .875rem; color: #334155; margin-bottom: .375rem; }
    input[type="password"] {
      width: 100%; padding: .625rem .75rem; border: 1px solid #cbd5e1; border-radius: 8px;
      font-size: .875rem; outline: none; transition: border-color .15s;
    }
    input[type="password"]:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.15); }
    .help { color: #64748b; font-size: .75rem; margin-top: .375rem; }
    button {
      width: 100%; margin-top: 1.25rem; padding: .625rem; background: #6366f1; color: white;
      border: none; border-radius: 8px; font-size: .875rem; font-weight: 500; cursor: pointer;
      transition: background .15s;
    }
    button:hover { background: #4f46e5; }
    button:disabled { background: #94a3b8; cursor: not-allowed; }
    .error { color: #dc2626; font-size: .8125rem; margin-top: .75rem; display: none; }
    .info {
      background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px;
      padding: .75rem; margin-bottom: 1.25rem; font-size: .8125rem; color: #0369a1;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">TherapyBill AI</div>
    <div class="subtitle">Connect ${displayName} to your practice</div>
    <div class="info">
      Enter your MCP API key to authorize access. You can generate one in
      <strong>Settings &rarr; MCP Integration</strong> in your TherapyBill dashboard.
    </div>
    <form id="authForm">
      <label for="apiKey">MCP API Key</label>
      <input type="password" id="apiKey" name="apiKey" placeholder="tbai_..." autocomplete="off" required />
      <div class="help">Starts with <code>tbai_</code>. Generated in your TherapyBill settings.</div>
      <div class="error" id="errorMsg"></div>
      <button type="submit" id="submitBtn">Authorize</button>
    </form>
  </div>
  <script>
    const form = document.getElementById('authForm');
    const btn = document.getElementById('submitBtn');
    const errEl = document.getElementById('errorMsg');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Authorizing...';

      try {
        const res = await fetch('/authorize/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: '${sessionId}',
            api_key: document.getElementById('apiKey').value.trim(),
          }),
        });
        const data = await res.json();
        if (data.redirect_url) {
          window.location.href = data.redirect_url;
        } else {
          errEl.textContent = data.error || 'Authorization failed.';
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Authorize';
        }
      } catch (err) {
        errEl.textContent = 'Network error. Please try again.';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Authorize';
      }
    });
  </script>
</body>
</html>`;
  }
}
