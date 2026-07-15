import { describe, it, expect, vi, beforeEach } from 'vitest';

// oauth-provider imports PgOauthStateStore, whose module pulls in the real db.
// These tests inject a FakeStore, so stub the db module out entirely.
vi.mock('../../db', () => ({
  dbReady: Promise.resolve(),
  db: {},
}));

// authenticateKey hits the DB; mock it. Valid key = 'tbai_valid'.
vi.mock('../auth', () => ({
  authenticateKey: vi.fn(async (key: string) => {
    if (key === 'tbai_valid') {
      return { practiceId: 1, userId: '1', role: 'admin', apiKey: key };
    }
    throw new Error('Invalid API key');
  }),
}));

vi.mock('../../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { TherapyBillOAuthProvider } from '../oauth-provider';
import type { OauthStateStore, OauthStateKind } from '../oauth-state-store';

/**
 * In-memory OauthStateStore with the same semantics as the Postgres one
 * (TTL, atomic take). Shared between two provider instances in these tests to
 * simulate two ECS tasks sharing the database.
 */
class FakeStore implements OauthStateStore {
  private rows = new Map<string, { kind: OauthStateKind; payload: any; expiresAt: number }>();

  async put(kind: OauthStateKind, key: string, payload: unknown, ttlMs: number) {
    // JSON round-trip mirrors the encrypt/decrypt round-trip in Postgres
    this.rows.set(key, {
      kind,
      payload: JSON.parse(JSON.stringify(payload)),
      expiresAt: Date.now() + ttlMs,
    });
  }

  async get(kind: OauthStateKind, key: string) {
    const row = this.rows.get(key);
    if (!row || row.kind !== kind || row.expiresAt <= Date.now()) return undefined;
    return row.payload;
  }

  async take(kind: OauthStateKind, key: string) {
    const payload = await this.get(kind, key);
    if (payload === undefined) return undefined;
    this.rows.delete(key);
    return payload;
  }

  async cleanup() {
    const now = Date.now();
    for (const [k, v] of this.rows) {
      if (v.expiresAt <= now) this.rows.delete(k);
    }
  }
}

function mockRes() {
  return {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
  } as any;
}

const CLIENT_META = {
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  client_name: 'Claude',
} as any;

const AUTH_PARAMS = {
  redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  codeChallenge: 'challenge-abc',
  state: 'xyz',
  scopes: ['mcp:tools'],
} as any;

/** Pull the pending session id out of the rendered authorize page HTML. */
function sessionIdFromAuthorizePage(res: any): string {
  const html: string = res.send.mock.calls[0][0];
  const match = html.match(/session_id: '([0-9a-f-]+)'/);
  expect(match).toBeTruthy();
  return match![1];
}

describe('TherapyBillOAuthProvider (Postgres-backed state)', () => {
  let store: FakeStore;
  let taskA: TherapyBillOAuthProvider;
  let taskB: TherapyBillOAuthProvider;

  beforeEach(() => {
    store = new FakeStore();
    // Two provider instances sharing one store = two ECS tasks sharing the DB
    taskA = new TherapyBillOAuthProvider(store);
    taskB = new TherapyBillOAuthProvider(store);
  });

  it('resolves a client registered on another task', async () => {
    const client = await taskA.clientsStore.registerClient(CLIENT_META);
    const found = await taskB.clientsStore.getClient(client.client_id);
    expect(found?.client_id).toBe(client.client_id);
    expect(found?.client_name).toBe('Claude');
  });

  it('completes the full authorize -> code -> token flow across tasks', async () => {
    const client = await taskA.clientsStore.registerClient(CLIENT_META);

    // /authorize handled by task A
    const res = mockRes();
    await taskA.authorize(client, AUTH_PARAMS, res);
    const sessionId = sessionIdFromAuthorizePage(res);

    // /authorize/callback lands on task B
    const outcome = await taskB.completeAuthorization(sessionId, 'tbai_valid');
    expect('redirectUrl' in outcome).toBe(true);
    const redirect = new URL((outcome as any).redirectUrl);
    const code = redirect.searchParams.get('code')!;
    expect(code).toBeTruthy();
    expect(redirect.searchParams.get('state')).toBe('xyz');

    // PKCE challenge lookup + /token exchange land back on task A
    const challenge = await taskA.challengeForAuthorizationCode(client, code);
    expect(challenge).toBe('challenge-abc');

    const tokens = await taskA.exchangeAuthorizationCode(client, code);
    expect(tokens.access_token).toBe('tbai_valid');
    expect(tokens.token_type).toBe('bearer');
  });

  it('rejects an invalid API key without consuming the session (user can retry)', async () => {
    const client = await taskA.clientsStore.registerClient(CLIENT_META);
    const res = mockRes();
    await taskA.authorize(client, AUTH_PARAMS, res);
    const sessionId = sessionIdFromAuthorizePage(res);

    const bad = await taskB.completeAuthorization(sessionId, 'tbai_wrong');
    expect('error' in bad).toBe(true);

    // Same session still works with the corrected key
    const good = await taskB.completeAuthorization(sessionId, 'tbai_valid');
    expect('redirectUrl' in good).toBe(true);
  });

  it('auth codes are one-time use, even across tasks', async () => {
    const client = await taskA.clientsStore.registerClient(CLIENT_META);
    const res = mockRes();
    await taskA.authorize(client, AUTH_PARAMS, res);
    const sessionId = sessionIdFromAuthorizePage(res);
    const outcome: any = await taskA.completeAuthorization(sessionId, 'tbai_valid');
    const code = new URL(outcome.redirectUrl).searchParams.get('code')!;

    await taskA.exchangeAuthorizationCode(client, code);
    await expect(taskB.exchangeAuthorizationCode(client, code)).rejects.toThrow(
      'Invalid authorization code',
    );
  });

  it('refuses to exchange a code issued to a different client', async () => {
    const clientA = await taskA.clientsStore.registerClient(CLIENT_META);
    const clientB = await taskA.clientsStore.registerClient({
      ...CLIENT_META,
      client_name: 'Impostor',
    });

    const res = mockRes();
    await taskA.authorize(clientA, AUTH_PARAMS, res);
    const sessionId = sessionIdFromAuthorizePage(res);
    const outcome: any = await taskA.completeAuthorization(sessionId, 'tbai_valid');
    const code = new URL(outcome.redirectUrl).searchParams.get('code')!;

    await expect(taskB.exchangeAuthorizationCode(clientB, code)).rejects.toThrow(
      'not issued to this client',
    );
  });

  it('rejects expired pending sessions', async () => {
    const outcome = await taskA.completeAuthorization('nonexistent-session', 'tbai_valid');
    expect('error' in outcome).toBe(true);
  });

  it('verifyAccessToken validates the API key against the DB on any task', async () => {
    const info = await taskB.verifyAccessToken('tbai_valid');
    expect(info.clientId).toBe('direct_1');
    await expect(taskB.verifyAccessToken('tbai_wrong')).rejects.toThrow('Invalid or expired token');
  });
});
