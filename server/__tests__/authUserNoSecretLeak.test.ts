/**
 * GET /api/auth/user is polled on every authenticated page load (see
 * client/src/hooks/useAuth.ts). It used to build its response with
 * `{ ...user, mfaRequired, mfaChallengeRequired }` — spreading the raw DB
 * row, which shipped passwordHash, mfaSecret (a TOTP seed - and not even
 * encrypted at rest despite the schema comment claiming otherwise),
 * mfaBackupCodes, and password/email verification tokens to the browser on
 * every single request. Locking in an explicit allowlist instead.
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

beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { claims: { sub: 'user-1' } };
    req.session = {};
    next();
  });
  app.use('/api', authRouter);
});

const FULL_DB_ROW = {
  id: 'user-1',
  email: 'daniel@therapybillai.com',
  firstName: 'Daniel',
  lastName: 'K',
  profileImageUrl: null,
  role: 'admin',
  practiceId: 1,
  mfaEnabled: true,
  mfaSecret: 'JBSWY3DPEHPK3PXP',
  mfaBackupCodes: ['hashed-code-1', 'hashed-code-2'],
  passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$somesaltsomesalt$somehashsomehash',
  emailVerified: true,
  emailVerificationToken: null,
  emailVerificationExpires: null,
  passwordResetToken: null,
  passwordResetExpires: null,
  failedLoginAttempts: 0,
  lockoutUntil: null,
  ssoProvider: null,
  ssoExternalId: null,
};

describe('GET /api/auth/user — no sensitive fields leak', () => {
  it('never returns passwordHash, mfaSecret, or mfaBackupCodes', async () => {
    mockStorage.getUser.mockResolvedValue(FULL_DB_ROW);
    const res = await request(app).get('/api/auth/user');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('mfaSecret');
    expect(res.body).not.toHaveProperty('mfaBackupCodes');
    expect(res.body).not.toHaveProperty('emailVerificationToken');
    expect(res.body).not.toHaveProperty('passwordResetToken');
    expect(JSON.stringify(res.body)).not.toContain('JBSWY3DPEHPK3PXP');
    expect(JSON.stringify(res.body)).not.toContain('argon2id');
  });

  it('still returns the safe fields the client actually needs', async () => {
    mockStorage.getUser.mockResolvedValue(FULL_DB_ROW);
    const res = await request(app).get('/api/auth/user');
    expect(res.body).toMatchObject({
      id: 'user-1',
      email: 'daniel@therapybillai.com',
      firstName: 'Daniel',
      lastName: 'K',
      role: 'admin',
      practiceId: 1,
    });
  });

  it('marks the platform-admin allowlisted email as isPlatformAdmin', async () => {
    mockStorage.getUser.mockResolvedValue({ ...FULL_DB_ROW, email: 'daniel@therapybillai.com' });
    const res = await request(app).get('/api/auth/user');
    expect(res.body.isPlatformAdmin).toBe(true);
  });

  it('does not mark an ordinary practice admin as isPlatformAdmin', async () => {
    mockStorage.getUser.mockResolvedValue({ ...FULL_DB_ROW, email: 'someone-else@example.com' });
    const res = await request(app).get('/api/auth/user');
    expect(res.body.isPlatformAdmin).toBe(false);
  });
});
