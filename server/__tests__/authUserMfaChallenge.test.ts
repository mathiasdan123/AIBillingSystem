/**
 * Regression test for the "continuously flashing session expired" bug:
 * GET /api/auth/user now reports mfaChallengeRequired (MFA enabled, but this
 * session hasn't passed a challenge) distinctly from mfaRequired (MFA not
 * enabled at all) — the client uses this to route to /mfa-challenge instead
 * of silently 403ing on every PHI query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: { getUser: vi.fn() },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../replitAuth', () => ({ isAuthenticated: (_req: any, _res: any, next: any) => next() }));
vi.mock('../middleware/rate-limiter', () => ({
  authLimiter: (_req: any, _res: any, next: any) => next(),
  mfaChallengeLimiter: (_req: any, _res: any, next: any) => next(),
}));

import authRouter from '../routes/auth';

let app: Express;
let sessionState: any;

beforeEach(() => {
  vi.clearAllMocks();
  sessionState = {};
  app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { claims: { sub: 'user-1' } };
    req.session = sessionState;
    next();
  });
  app.use('/api', authRouter);
});

describe('GET /api/auth/user — mfaChallengeRequired', () => {
  it('is false when MFA is not enabled at all (mfaRequired covers that case instead)', async () => {
    mockStorage.getUser.mockResolvedValue({ id: 'user-1', mfaEnabled: false });
    const res = await request(app).get('/api/auth/user');
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.mfaChallengeRequired).toBe(false);
  });

  it('is true right after a fresh login when MFA is enabled but this session never verified', async () => {
    mockStorage.getUser.mockResolvedValue({ id: 'user-1', mfaEnabled: true });
    sessionState = {}; // fresh session — no mfaVerifiedAt at all
    const res = await request(app).get('/api/auth/user');
    expect(res.body.mfaRequired).toBe(false);
    expect(res.body.mfaChallengeRequired).toBe(true);
  });

  it('is false once this session has a valid, unexpired MFA verification', async () => {
    mockStorage.getUser.mockResolvedValue({ id: 'user-1', mfaEnabled: true });
    sessionState.mfaVerifiedAt = Date.now();
    sessionState.mfaUserId = 'user-1';
    const res = await request(app).get('/api/auth/user');
    expect(res.body.mfaChallengeRequired).toBe(false);
  });

  it('is true again once the MFA session window has lapsed', async () => {
    mockStorage.getUser.mockResolvedValue({ id: 'user-1', mfaEnabled: true });
    sessionState.mfaVerifiedAt = Date.now() - 61 * 60 * 1000;
    sessionState.mfaUserId = 'user-1';
    const res = await request(app).get('/api/auth/user');
    expect(res.body.mfaChallengeRequired).toBe(true);
  });
});
