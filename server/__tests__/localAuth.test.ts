import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mock storage — use vi.hoisted so the object is available when vi.mock hoists
// ---------------------------------------------------------------------------
const mockStorage = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
  getUser: vi.fn(),
  getSsoConfigByPractice: vi.fn(),
  incrementFailedLoginAttempts: vi.fn(),
  setLockout: vi.fn(),
  resetFailedLoginAttempts: vi.fn(),
  updateLastLoginAt: vi.fn(),
  createUserWithPassword: vi.fn(),
  getUserByPasswordResetToken: vi.fn(),
  clearPasswordResetToken: vi.fn(),
  updatePasswordHash: vi.fn(),
  clearAllUserSessions: vi.fn(),
  getUserByEmailVerificationToken: vi.fn(),
  verifyEmail: vi.fn(),
  setEmailVerificationToken: vi.fn(),
  setPasswordResetToken: vi.fn(),
  getInviteByToken: vi.fn(),
  updateInviteStatus: vi.fn(),
  updateUserMfa: vi.fn(),
}));

vi.mock('../storage', () => ({ storage: mockStorage }));

// ---------------------------------------------------------------------------
// Mock email services (avoid real sends)
// ---------------------------------------------------------------------------
vi.mock('../email', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendEmailVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendSecurityAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/emailService', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../services/emailTemplates', () => ({
  passwordReset: vi.fn().mockReturnValue({
    subject: 'Reset your password',
    html: '<p>Reset link</p>',
    text: 'Reset link',
  }),
}));

// ---------------------------------------------------------------------------
// Mock rate limiters (pass-through)
// ---------------------------------------------------------------------------
vi.mock('../middleware/rate-limiter', () => ({
  authLimiter: (_req: any, _res: any, next: any) => next(),
  passwordResetLimiter: (_req: any, _res: any, next: any) => next(),
  registrationLimiter: (_req: any, _res: any, next: any) => next(),
}));

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock passwordService
// ---------------------------------------------------------------------------
vi.mock('../services/passwordService', () => ({
  validatePassword: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  hashPassword: vi.fn().mockResolvedValue('hashed-password'),
  verifyPassword: vi.fn().mockResolvedValue(true),
  generateSecureToken: vi.fn().mockReturnValue('secure-token-abc'),
  isAccountLocked: vi.fn().mockReturnValue(false),
  shouldLockAccount: vi.fn().mockReturnValue(false),
  calculateLockoutExpiry: vi.fn().mockReturnValue(new Date(Date.now() + 30 * 60 * 1000)),
  calculateResetTokenExpiry: vi.fn().mockReturnValue(new Date(Date.now() + 60 * 60 * 1000)),
  calculateVerificationTokenExpiry: vi.fn().mockReturnValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
  isTokenExpired: vi.fn().mockReturnValue(false),
  getRemainingLockoutMinutes: vi.fn().mockReturnValue(25),
  PASSWORD_REQUIREMENTS: {
    lockoutDurationMs: 30 * 60 * 1000,
    resetTokenExpiryMs: 60 * 60 * 1000,
    verificationTokenExpiryMs: 24 * 60 * 60 * 1000,
  },
}));

// ---------------------------------------------------------------------------
// Build a minimal Express app with the localAuth router mounted at /api/auth
// We need passport, session, etc. to work so we wire them up with test stubs.
// ---------------------------------------------------------------------------

// Passport stubs
vi.mock('passport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('passport')>();
  return {
    default: {
      ...actual,
      use: vi.fn(),
      authenticate: vi.fn(),
      initialize: () => (_req: any, _res: any, next: any) => next(),
      session: () => (_req: any, _res: any, next: any) => next(),
      serializeUser: vi.fn(),
      deserializeUser: vi.fn(),
    },
  };
});

import passport from 'passport';
import localAuthRouter from '../routes/localAuth';

function buildApp(): Express {
  const app = express();
  app.use(express.json());

  // Minimal session-like middleware so req.session and req.login are available
  app.use((req: any, _res, next) => {
    req.session = req.session || {};
    req.session.regenerate = (cb: (err: any) => void) => cb(null);
    req.session.destroy = (cb: (err: any) => void) => cb(null);
    req.isAuthenticated = () => false;
    req.login = (user: any, cb: (err: any) => void) => {
      req.user = user;
      cb(null);
    };
    req.logout = (cb: (err: any) => void) => {
      req.user = undefined;
      cb(null);
    };
    next();
  });

  app.use('/api/auth', localAuthRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('localAuth Routes (/api/auth)', () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Restore default implementations that clearAllMocks() removes
    const ps = await import('../services/passwordService');
    (ps.validatePassword as any).mockReturnValue({ valid: true, errors: [] });
    (ps.hashPassword as any).mockResolvedValue('hashed-password');
    (ps.verifyPassword as any).mockResolvedValue(true);
    (ps.generateSecureToken as any).mockReturnValue('secure-token-abc');
    (ps.isAccountLocked as any).mockReturnValue(false);
    (ps.shouldLockAccount as any).mockReturnValue(false);
    (ps.isTokenExpired as any).mockReturnValue(false);
    (ps.getRemainingLockoutMinutes as any).mockReturnValue(25);
    app = buildApp();
  });

  // ---- POST /api/auth/register ----

  describe('POST /api/auth/register', () => {
    it('should return 400 when email is missing', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ password: 'SecurePass1!' })
        .expect(400);

      expect(res.body.message).toBe('Email and password are required');
    });

    it('should return 400 when password is missing', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'test@example.com' })
        .expect(400);

      expect(res.body.message).toBe('Email and password are required');
    });

    it('should return 400 when email is already taken', async () => {
      const { validatePassword } = await import('../services/passwordService');
      (validatePassword as any).mockReturnValue({ valid: true, errors: [] });
      mockStorage.getUserByEmail.mockResolvedValue({
        id: 'existing-user',
        email: 'taken@example.com',
      });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'taken@example.com', password: 'SecurePass1!' })
        .expect(400);

      expect(res.body.message).toBe('Unable to create account with this email');
    });

    it('should create user and return 201 on successful registration', async () => {
      const { validatePassword } = await import('../services/passwordService');
      (validatePassword as any).mockReturnValue({ valid: true, errors: [] });
      mockStorage.getUserByEmail.mockResolvedValue(undefined);
      mockStorage.createUserWithPassword.mockResolvedValue({
        id: 'new-user-1',
        email: 'newuser@example.com',
        firstName: 'New',
        lastName: 'User',
        emailVerified: false,
      });
      mockStorage.setEmailVerificationToken.mockResolvedValue(undefined);
      mockStorage.getInviteByToken.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'newuser@example.com', password: 'SecurePass1!', firstName: 'New', lastName: 'User' })
        .expect(201);

      expect(res.body.message).toBe('Account created successfully');
      expect(res.body.user.email).toBe('newuser@example.com');
      expect(mockStorage.createUserWithPassword).toHaveBeenCalledOnce();
    });

    it('should return 400 for invalid password', async () => {
      const { validatePassword } = await import('../services/passwordService');
      (validatePassword as any).mockReturnValue({ valid: false, errors: ['Too short'] });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'newuser@example.com', password: 'short' })
        .expect(400);

      expect(res.body.message).toBe('Password does not meet requirements');
      expect(res.body.errors).toContain('Too short');
    });
  });

  // ---- POST /api/auth/forgot-password ----

  describe('POST /api/auth/forgot-password', () => {
    it('should return 400 when email is not provided', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({})
        .expect(400);

      expect(res.body.message).toBe('Email is required');
    });

    it('should return 200 even when email does not exist (prevents enumeration)', async () => {
      mockStorage.getUserByEmail.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nobody@example.com' })
        .expect(200);

      expect(res.body.message).toMatch(/If an account exists/i);
      expect(mockStorage.setPasswordResetToken).not.toHaveBeenCalled();
    });

    it('should generate a reset token and return 200 when user exists', async () => {
      mockStorage.getUserByEmail.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        firstName: 'John',
      });
      mockStorage.setPasswordResetToken.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'user@example.com' })
        .expect(200);

      expect(res.body.message).toMatch(/If an account exists/i);
      expect(mockStorage.setPasswordResetToken).toHaveBeenCalledWith(
        'user-123',
        'secure-token-abc',
        expect.any(Date),
      );
    });
  });

  // ---- POST /api/auth/reset-password ----

  describe('POST /api/auth/reset-password', () => {
    it('should return 400 when token is missing', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ password: 'NewSecure1!' })
        .expect(400);

      expect(res.body.message).toBe('Token and password are required');
    });

    it('should return 400 when reset token is invalid', async () => {
      mockStorage.getUserByPasswordResetToken.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'bad-token', password: 'NewSecure1!' })
        .expect(400);

      expect(res.body.message).toBe('Invalid or expired reset token');
    });

    it('should reset password and return 200 for valid token', async () => {
      const { isTokenExpired } = await import('../services/passwordService');
      (isTokenExpired as any).mockReturnValue(false);

      mockStorage.getUserByPasswordResetToken.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000),
      });
      mockStorage.updatePasswordHash.mockResolvedValue(undefined);
      mockStorage.clearPasswordResetToken.mockResolvedValue(undefined);
      mockStorage.resetFailedLoginAttempts.mockResolvedValue(undefined);
      mockStorage.clearAllUserSessions.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'valid-token', password: 'NewSecure1!' })
        .expect(200);

      expect(res.body.message).toMatch(/Password reset successfully/i);
      expect(mockStorage.updatePasswordHash).toHaveBeenCalledWith('user-123', 'hashed-password');
    });

    it('should return 400 when reset token has expired', async () => {
      const { isTokenExpired } = await import('../services/passwordService');
      (isTokenExpired as any).mockReturnValue(true);

      mockStorage.getUserByPasswordResetToken.mockResolvedValue({
        id: 'user-123',
        passwordResetExpires: new Date(Date.now() - 1000),
      });
      mockStorage.clearPasswordResetToken.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'expired-token', password: 'NewSecure1!' })
        .expect(400);

      expect(res.body.message).toBe('Reset token has expired');
    });
  });

  // ---- POST /api/auth/verify-email ----

  describe('POST /api/auth/verify-email', () => {
    it('should return 400 when token is missing', async () => {
      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({})
        .expect(400);

      expect(res.body.message).toBe('Verification token is required');
    });

    it('should return 400 for invalid verification token', async () => {
      mockStorage.getUserByEmailVerificationToken.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'bad-token' })
        .expect(400);

      expect(res.body.message).toBe('Invalid verification token');
    });

    it('should verify email and return 200 for valid token', async () => {
      const { isTokenExpired } = await import('../services/passwordService');
      (isTokenExpired as any).mockReturnValue(false);

      mockStorage.getUserByEmailVerificationToken.mockResolvedValue({
        id: 'user-123',
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      mockStorage.verifyEmail.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'valid-verify-token' })
        .expect(200);

      expect(res.body.message).toBe('Email verified successfully');
      expect(mockStorage.verifyEmail).toHaveBeenCalledWith('user-123');
    });
  });

  // ---- GET /api/auth/user ----

  describe('GET /api/auth/user', () => {
    it('should return 401 when not authenticated', async () => {
      // App has req.isAuthenticated = () => false by default
      const res = await request(app)
        .get('/api/auth/user')
        .expect(401);

      expect(res.body.message).toBe('Not authenticated');
    });

    it('should return current user when authenticated', async () => {
      const dbUser = {
        id: 'user-123',
        email: 'user@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        role: 'therapist',
        practiceId: 1,
        emailVerified: true,
        mfaEnabled: false,
        profileImageUrl: null,
      };

      // Build an app that marks the user as authenticated
      const authenticatedApp = express();
      authenticatedApp.use(express.json());
      authenticatedApp.use((req: any, _res, next) => {
        req.session = {};
        req.isAuthenticated = () => true;
        req.user = { claims: { sub: 'user-123' } };
        req.login = (u: any, cb: any) => cb(null);
        req.logout = (cb: any) => cb(null);
        next();
      });
      authenticatedApp.use('/api/auth', localAuthRouter);

      mockStorage.getUser.mockResolvedValue(dbUser);

      const res = await request(authenticatedApp)
        .get('/api/auth/user')
        .expect(200);

      expect(res.body.id).toBe('user-123');
      expect(res.body.email).toBe('user@example.com');
    });
  });

  // ---- POST /api/auth/logout ----

  describe('POST /api/auth/logout', () => {
    it('should log out and clear session cookies', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .expect(200);

      expect(res.body.message).toBe('Logged out successfully');
    });
  });
});
