/**
 * Tests for server/routes/auth.ts
 *
 * Covers:
 *  - GET  /api/auth/user
 *  - POST /api/invites
 *  - POST /api/demo-login
 *  - GET  /api/users   (admin-only)
 *  - POST /api/setup/make-admin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Storage mock — use vi.hoisted so the object is available when vi.mock hoists
// ---------------------------------------------------------------------------
const mockStorage = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAllUsers: vi.fn(),
  updateUserRole: vi.fn(),
  getInviteByEmail: vi.fn(),
  createInvite: vi.fn(),
  getInvitesByPractice: vi.fn(),
  getInviteByToken: vi.fn(),
  updateInviteStatus: vi.fn(),
  getAllPracticeIds: vi.fn(),
  getUserByEmail: vi.fn(),
  createUserWithPassword: vi.fn(),
  getTherapistsByPractice: vi.fn(),
  updateUser: vi.fn(),
  upsertUser: vi.fn(),
  updateUserMfa: vi.fn(),
}));

vi.mock('../storage', () => ({ storage: mockStorage }));

// ---------------------------------------------------------------------------
// Mocks for replitAuth (isAuthenticated)
// ---------------------------------------------------------------------------
let authenticatedUserId = 'admin-user-1';
let authenticatedUserRole = 'admin';

vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: authenticatedUserId } };
    req.userPracticeId = 1;
    req.userRole = authenticatedUserRole;
    next();
  },
  setupAuth: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock MFA and rate-limit middleware
// ---------------------------------------------------------------------------
vi.mock('../middleware/mfa-required', () => ({
  setMfaVerified: vi.fn(),
  clearMfaVerification: vi.fn(),
  isMfaSessionValid: vi.fn().mockReturnValue(true),
  getMfaSessionTimeRemaining: vi.fn().mockReturnValue(1_800_000),
  MFA_PROTECTED_ROUTES: [],
  MFA_CONFIG: { sessionTimeout: 1_800_000, sessionTimeoutMinutes: 30 },
}));

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
// Mock passwordService (used by /demo-login)
// ---------------------------------------------------------------------------
vi.mock('../services/passwordService', async () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed-pw'),
  verifyPassword: vi.fn().mockResolvedValue(true),
  validatePassword: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  generateSecureToken: vi.fn().mockReturnValue('tok-abc'),
  isAccountLocked: vi.fn().mockReturnValue(false),
  shouldLockAccount: vi.fn().mockReturnValue(false),
  calculateLockoutExpiry: vi.fn().mockReturnValue(new Date()),
  calculateResetTokenExpiry: vi.fn().mockReturnValue(new Date()),
  calculateVerificationTokenExpiry: vi.fn().mockReturnValue(new Date()),
  isTokenExpired: vi.fn().mockReturnValue(false),
  getRemainingLockoutMinutes: vi.fn().mockReturnValue(30),
  PASSWORD_REQUIREMENTS: { lockoutDurationMs: 1_800_000, resetTokenExpiryMs: 3_600_000, verificationTokenExpiryMs: 86_400_000 },
}));

// ---------------------------------------------------------------------------
// Import router under test AFTER all mocks are declared
// ---------------------------------------------------------------------------
import authRouter from '../routes/auth';

function buildApp(): Express {
  const app = express();
  app.use(express.json());

  // Minimal session / login stubs
  app.use((req: any, _res, next) => {
    req.session = req.session || {};
    req.isAuthenticated = () => true;
    req.login = (user: any, cb: (err: any) => void) => {
      req.user = user;
      cb(null);
    };
    req.logout = (cb: (err: any) => void) => cb(null);
    next();
  });

  app.use('/api', authRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth routes (server/routes/auth.ts)', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    authenticatedUserId = 'admin-user-1';
    authenticatedUserRole = 'admin';
    app = buildApp();
  });

  // ---- GET /api/auth/user ----

  describe('GET /api/auth/user', () => {
    it('should return the current authenticated user', async () => {
      mockStorage.getUser.mockResolvedValue({
        id: 'admin-user-1',
        email: 'admin@example.com',
        firstName: 'Admin',
        lastName: 'User',
        role: 'admin',
        practiceId: 1,
        mfaEnabled: true,
      });

      const res = await request(app)
        .get('/api/auth/user')
        .expect(200);

      expect(res.body.id).toBe('admin-user-1');
      expect(res.body.email).toBe('admin@example.com');
      expect(res.body.mfaRequired).toBe(false); // mfaEnabled = true → mfaRequired = false
    });

    it('should return mfaRequired=true when MFA is not enabled', async () => {
      mockStorage.getUser.mockResolvedValue({
        id: 'admin-user-1',
        email: 'admin@example.com',
        role: 'admin',
        mfaEnabled: false,
      });

      const res = await request(app)
        .get('/api/auth/user')
        .expect(200);

      expect(res.body.mfaRequired).toBe(true);
    });

    it('should return 404 when user record is not found', async () => {
      mockStorage.getUser.mockResolvedValue(undefined);

      const res = await request(app)
        .get('/api/auth/user')
        .expect(404);

      expect(res.body.message).toBe('User not found');
    });
  });

  // ---- GET /api/users (admin only) ----

  describe('GET /api/users', () => {
    it('should return user list for admin', async () => {
      mockStorage.getUser.mockResolvedValue({ id: 'admin-user-1', role: 'admin' });
      mockStorage.getAllUsers.mockResolvedValue([
        { id: 'u1', email: 'a@example.com', firstName: 'Alice', lastName: 'A', role: 'therapist', createdAt: new Date() },
        { id: 'u2', email: 'b@example.com', firstName: 'Bob', lastName: 'B', role: 'billing', createdAt: new Date() },
      ]);

      const res = await request(app)
        .get('/api/users')
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].id).toBe('u1');
      // Passwords/hashes must not be exposed
      expect(res.body[0].passwordHash).toBeUndefined();
    });

    it('should return 403 for non-admin users', async () => {
      authenticatedUserRole = 'therapist';
      app = buildApp();
      mockStorage.getUser.mockResolvedValue({ id: 'admin-user-1', role: 'therapist' });

      const res = await request(app)
        .get('/api/users')
        .expect(403);

      expect(res.body.message).toMatch(/Admin role required/i);
    });
  });

  // ---- POST /api/invites ----

  describe('POST /api/invites', () => {
    beforeEach(() => {
      // Admin user setup
      mockStorage.getUser.mockResolvedValue({ id: 'admin-user-1', role: 'admin' });
    });

    it('should create an invite for a new email', async () => {
      mockStorage.getAllUsers.mockResolvedValue([]);
      mockStorage.getInviteByEmail.mockResolvedValue(null);
      mockStorage.createInvite.mockResolvedValue({
        id: 1,
        email: 'newtherapist@example.com',
        role: 'therapist',
        token: 'invite-token-xyz',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        practiceId: 1,
      });

      const res = await request(app)
        .post('/api/invites')
        .send({ email: 'newtherapist@example.com', role: 'therapist', practiceId: 1 })
        .expect(200);

      expect(res.body.message).toBe('Invite created successfully');
      expect(res.body.invite.email).toBe('newtherapist@example.com');
      expect(res.body.invite.token).toBe('invite-token-xyz');
      expect(mockStorage.createInvite).toHaveBeenCalledOnce();
    });

    it('should return 400 when email is missing', async () => {
      const res = await request(app)
        .post('/api/invites')
        .send({ role: 'therapist', practiceId: 1 })
        .expect(400);

      expect(res.body.message).toBe('Email is required');
    });

    it('should return 400 for an invalid email format', async () => {
      const res = await request(app)
        .post('/api/invites')
        .send({ email: 'not-an-email', practiceId: 1 })
        .expect(400);

      expect(res.body.message).toBe('Please enter a valid email address');
    });

    it('should return 400 when practiceId is missing', async () => {
      const res = await request(app)
        .post('/api/invites')
        .send({ email: 'valid@example.com' })
        .expect(400);

      expect(res.body.message).toBe('Practice ID is required for invites');
    });

    it('should return 400 when user with email already exists', async () => {
      mockStorage.getAllUsers.mockResolvedValue([
        { id: 'existing-1', email: 'taken@example.com', role: 'therapist' },
      ]);

      const res = await request(app)
        .post('/api/invites')
        .send({ email: 'taken@example.com', practiceId: 1 })
        .expect(400);

      expect(res.body.message).toBe('A user with this email already exists');
    });

    it('should return 400 when invite has already been sent to the email', async () => {
      mockStorage.getAllUsers.mockResolvedValue([]);
      mockStorage.getInviteByEmail.mockResolvedValue({
        id: 99,
        email: 'pending@example.com',
        status: 'pending',
      });

      const res = await request(app)
        .post('/api/invites')
        .send({ email: 'pending@example.com', practiceId: 1 })
        .expect(400);

      expect(res.body.message).toBe('An invite has already been sent to this email');
    });

    it('should return 400 for invalid role value', async () => {
      const res = await request(app)
        .post('/api/invites')
        .send({ email: 'valid@example.com', role: 'superuser', practiceId: 1 })
        .expect(400);

      expect(res.body.message).toBe('Invalid role');
    });

    it('should return 403 for non-admin user trying to create invite', async () => {
      authenticatedUserRole = 'therapist';
      app = buildApp();
      mockStorage.getUser.mockResolvedValue({ id: 'admin-user-1', role: 'therapist' });

      const res = await request(app)
        .post('/api/invites')
        .send({ email: 'new@example.com', practiceId: 1 })
        .expect(403);

      expect(res.body.message).toMatch(/Admin role required/i);
    });
  });

  // ---- POST /api/demo-login ----

  describe('POST /api/demo-login', () => {
    it('should log in an existing demo user', async () => {
      const existingDemo = {
        id: 'demo-user-1',
        email: 'demo@therapybill.com',
        firstName: 'Demo',
        lastName: 'Admin',
        role: 'admin',
        practiceId: 1,
      };
      mockStorage.getUserByEmail.mockResolvedValue(existingDemo);

      const res = await request(app)
        .post('/api/demo-login')
        .send({ email: 'demo@therapybill.com' })
        .expect(200);

      expect(res.body.message).toBe('Demo login successful');
      expect(res.body.user.email).toBe('demo@therapybill.com');
    });

    it('should create and log in a demo user that does not yet exist', async () => {
      const createdUser = {
        id: 'demo-new-1',
        email: 'demo@therapybill.com',
        firstName: 'Demo',
        lastName: 'Admin',
        role: 'admin',
        practiceId: 1,
      };

      mockStorage.getUserByEmail.mockResolvedValue(undefined);
      mockStorage.getAllPracticeIds.mockResolvedValue([1]);
      mockStorage.createUserWithPassword.mockResolvedValue(createdUser);

      const res = await request(app)
        .post('/api/demo-login')
        .send({ email: 'demo@therapybill.com' })
        .expect(200);

      expect(res.body.message).toBe('Demo login successful');
      expect(mockStorage.createUserWithPassword).toHaveBeenCalledOnce();
    });

    it('should return 400 for an unrecognised demo email', async () => {
      const res = await request(app)
        .post('/api/demo-login')
        .send({ email: 'hacker@evil.com' })
        .expect(400);

      expect(res.body.message).toBe('Invalid demo account');
    });

    it('should use default demo email when none is provided', async () => {
      const existingDemo = {
        id: 'demo-user-1',
        email: 'demo@therapybill.com',
        firstName: 'Demo',
        lastName: 'Admin',
        role: 'admin',
        practiceId: 1,
      };
      mockStorage.getUserByEmail.mockResolvedValue(existingDemo);

      const res = await request(app)
        .post('/api/demo-login')
        .send({}) // no email → defaults to demo@therapybill.com
        .expect(200);

      expect(res.body.message).toBe('Demo login successful');
    });

    it('should fix role if demo user has wrong role', async () => {
      const wrongRoleUser = {
        id: 'demo-user-1',
        email: 'demo@therapybill.com',
        firstName: 'Demo',
        lastName: 'Admin',
        role: 'therapist', // wrong – should be admin
        practiceId: 1,
      };
      const correctedUser = { ...wrongRoleUser, role: 'admin' };

      mockStorage.getUserByEmail
        .mockResolvedValueOnce(wrongRoleUser)
        .mockResolvedValueOnce(correctedUser);
      mockStorage.updateUserRole.mockResolvedValue(correctedUser);

      const res = await request(app)
        .post('/api/demo-login')
        .send({ email: 'demo@therapybill.com' })
        .expect(200);

      expect(mockStorage.updateUserRole).toHaveBeenCalledWith('demo-user-1', 'admin');
      expect(res.body.user.role).toBe('admin');
    });
  });

  // ---- POST /api/setup/make-admin ----

  describe('POST /api/setup/make-admin', () => {
    it('should promote current user to admin when no admin exists', async () => {
      mockStorage.getAllUsers.mockResolvedValue([
        { id: 'admin-user-1', email: 'me@example.com', role: 'therapist' },
      ]);
      mockStorage.updateUserRole.mockResolvedValue({
        id: 'admin-user-1',
        email: 'me@example.com',
        role: 'admin',
      });

      const res = await request(app)
        .post('/api/setup/make-admin')
        .expect(200);

      expect(res.body.message).toBe('You are now an admin!');
      expect(mockStorage.updateUserRole).toHaveBeenCalledWith('admin-user-1', 'admin');
    });

    it('should return 400 when an admin already exists', async () => {
      mockStorage.getAllUsers.mockResolvedValue([
        { id: 'other-admin', email: 'boss@example.com', role: 'admin' },
      ]);

      const res = await request(app)
        .post('/api/setup/make-admin')
        .expect(400);

      expect(res.body.message).toMatch(/admin already exists/i);
    });
  });
});
