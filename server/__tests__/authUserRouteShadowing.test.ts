/**
 * GET /api/auth/user must be served by server/routes/auth.ts -- in PRODUCTION
 * MOUNT ORDER -- not by anything mounted earlier.
 *
 * The bug this pins down (live from the 2026-03 local-auth migration until
 * 2026-11-03): setupAuth() mounts routes/localAuth.ts at /api/auth before
 * registerRoutes() mounts routes/auth.ts at /api. localAuth.ts carried its own
 * `GET /user` that returned raw `mfaEnabled` / `emailVerified` and never
 * `mfaRequired` / `mfaChallengeRequired` / `isPlatformAdmin`. Express's first
 * match won, so the carefully-tested handler in auth.ts (authRoutes.test.ts,
 * authUserMfaChallenge.test.ts, authUserNoSecretLeak.test.ts -- all of which
 * mount auth.ts ALONE) was never reachable in production.
 *
 * Consequence: useAuth()'s needsMfaSetup / needsMfaChallenge were always
 * false, so App.tsx never showed the MFA setup or challenge page; a user whose
 * MFA was unenrolled (or whose window lapsed) got a fully-rendered dashboard
 * whose every PHI request 403'd ("Failed to load patients", "0 patients"), and
 * queryClient.ts's refreshAuthForMfaGate() -- which reads the same flags from
 * the same endpoint -- could never rescue them. Every router-only test stayed
 * green the whole time.
 *
 * So this test mounts BOTH routers, in the same order production does, and
 * asserts on the contract the client actually consumes. Adding a `/user`
 * route back to localAuth.ts fails it immediately.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
    createAuditLog: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// auth.ts's handler is behind the real isAuthenticated; the session shim
// below supplies req.user, so just pass through.
vi.mock('../replitAuth', () => ({
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../middleware/rate-limiter', () => ({
  authLimiter: (_req: any, _res: any, next: any) => next(),
  passwordResetLimiter: (_req: any, _res: any, next: any) => next(),
  registrationLimiter: (_req: any, _res: any, next: any) => next(),
  mfaChallengeLimiter: (_req: any, _res: any, next: any) => next(),
  incrementGlobalFailedAuth: vi.fn().mockResolvedValue(undefined),
}));
// localAuth.ts pulls these in at import time; none are exercised here.
vi.mock('../email', () => ({
  sendPasswordResetEmail: vi.fn(),
  sendEmailVerificationEmail: vi.fn(),
  sendSecurityAlertEmail: vi.fn(),
}));
vi.mock('../services/emailService', () => ({ sendEmail: vi.fn() }));
vi.mock('../services/emailTemplates', () => ({ passwordReset: vi.fn() }));

import localAuthRouter from '../routes/localAuth';
import authRouter from '../routes/auth';

let app: Express;
let sessionState: any;

beforeEach(() => {
  vi.clearAllMocks();
  sessionState = {};
  app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.isAuthenticated = () => true;
    req.user = { claims: { sub: 'user-1' } };
    req.session = sessionState;
    next();
  });
  // PRODUCTION ORDER -- do not swap these. server/replitAuth.ts setupAuth()
  // mounts localAuth at /api/auth first; server/routes.ts registerRoutes()
  // mounts authRouter at /api afterwards.
  app.use('/api/auth', localAuthRouter);
  app.use('/api', authRouter);
});

describe('GET /api/auth/user with both auth routers mounted in production order', () => {
  it('reports mfaRequired: true for a user with MFA not enabled (the setup-gate signal)', async () => {
    mockStorage.getUser.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      role: 'admin',
      practiceId: 1,
      mfaEnabled: false,
    });

    const res = await request(app).get('/api/auth/user').expect(200);

    // The three fields the client gates on. If localAuth.ts ever regrows a
    // `/user` route, these come back undefined and this fails -- which is
    // the whole point.
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.mfaChallengeRequired).toBe(false);
    expect(res.body).toHaveProperty('isPlatformAdmin');
    // And the shadow's raw field is NOT the contract.
    expect(res.body).not.toHaveProperty('mfaEnabled');
  });

  it('reports mfaChallengeRequired: true for an enrolled user whose session has not verified', async () => {
    mockStorage.getUser.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      role: 'admin',
      practiceId: 1,
      mfaEnabled: true,
    });

    const res = await request(app).get('/api/auth/user').expect(200);
    expect(res.body.mfaRequired).toBe(false);
    expect(res.body.mfaChallengeRequired).toBe(true);
  });

  it('is served by exactly one handler (the response shape is auth.ts\'s allowlist, nothing else)', async () => {
    mockStorage.getUser.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'admin',
      practiceId: 1,
      profileImageUrl: null,
      mfaEnabled: false,
      // Fields the shadow used to leak / the allowlist must never ship:
      emailVerified: false,
      passwordHash: 'nope',
      mfaSecret: 'nope',
    });

    const res = await request(app).get('/api/auth/user').expect(200);
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'email',
        'firstName',
        'id',
        'isPlatformAdmin',
        'lastName',
        'mfaChallengeRequired',
        'mfaRequired',
        'practiceId',
        'profileImageUrl',
        'role',
      ].sort(),
    );
  });
});
