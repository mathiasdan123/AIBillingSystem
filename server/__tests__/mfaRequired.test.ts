import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock storage
const mockStorage = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock('../storage', () => ({
  storage: mockStorage,
}));

// Mock logger
vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  requireMfaSetup,
  conditionalRequireMfaSetup,
  requiresMfaEnforcement,
  isMfaSessionValid,
  setMfaVerified,
  clearMfaVerification,
  getMfaSessionTimeRemaining,
  mfaRequired,
  adminMfaRequired,
  MFA_CONFIG,
} from '../middleware/mfa-required';

function createMockReq(overrides: any = {}): any {
  return {
    path: '/api/patients',
    originalUrl: '/api/patients',
    user: { claims: { sub: 'user-1' } },
    session: {},
    ...overrides,
  };
}

function createMockRes() {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

describe('MFA Required Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- requiresMfaEnforcement ----

  it('should require MFA for PHI routes', () => {
    expect(requiresMfaEnforcement('/api/patients')).toBe(true);
    expect(requiresMfaEnforcement('/api/patients/1')).toBe(true);
    expect(requiresMfaEnforcement('/api/soap-notes')).toBe(true);
    expect(requiresMfaEnforcement('/api/claims')).toBe(true);
  });

  it('should require MFA for export routes', () => {
    expect(requiresMfaEnforcement('/api/export-training-data')).toBe(true);
    expect(requiresMfaEnforcement('/api/patients/1/documents')).toBe(true);
    expect(requiresMfaEnforcement('/api/some/export')).toBe(true);
  });

  it('should require MFA for admin routes', () => {
    expect(requiresMfaEnforcement('/api/admin')).toBe(true);
    expect(requiresMfaEnforcement('/api/users')).toBe(true);
    expect(requiresMfaEnforcement('/api/breach')).toBe(true);
  });

  it('should NOT require MFA for non-sensitive routes', () => {
    expect(requiresMfaEnforcement('/api/health')).toBe(false);
    expect(requiresMfaEnforcement('/api/settings')).toBe(false);
    expect(requiresMfaEnforcement('/login')).toBe(false);
  });

  // ---- isMfaSessionValid ----

  it('should return false if session has no mfaVerifiedAt', () => {
    expect(isMfaSessionValid({}, 'user-1')).toBe(false);
    expect(isMfaSessionValid({ mfaVerifiedAt: Date.now() }, 'user-1')).toBe(false); // missing mfaUserId
  });

  it('should return false if mfaUserId does not match', () => {
    const session = { mfaVerifiedAt: Date.now(), mfaUserId: 'user-2' };
    expect(isMfaSessionValid(session, 'user-1')).toBe(false);
  });

  it('should return true if MFA was verified recently for the correct user', () => {
    const session = { mfaVerifiedAt: Date.now(), mfaUserId: 'user-1' };
    expect(isMfaSessionValid(session, 'user-1')).toBe(true);
  });

  it('should return false if MFA session has expired (>8 hours)', () => {
    const session = {
      mfaVerifiedAt: Date.now() - (9 * 60 * 60 * 1000), // 9 hours ago
      mfaUserId: 'user-1',
    };
    expect(isMfaSessionValid(session, 'user-1')).toBe(false);
  });

  // ---- setMfaVerified / clearMfaVerification ----

  it('should set and clear MFA verification on session', () => {
    const session: any = {};
    setMfaVerified(session, 'user-1');
    expect(session.mfaVerifiedAt).toBeDefined();
    expect(session.mfaUserId).toBe('user-1');

    clearMfaVerification(session);
    expect(session.mfaVerifiedAt).toBeUndefined();
    expect(session.mfaUserId).toBeUndefined();
  });

  // ---- getMfaSessionTimeRemaining ----

  it('should return 0 when no mfaVerifiedAt in session', () => {
    expect(getMfaSessionTimeRemaining({})).toBe(0);
  });

  it('should return positive time when session is still valid', () => {
    const session = { mfaVerifiedAt: Date.now() - (5 * 60 * 1000) }; // 5 min ago
    const remaining = getMfaSessionTimeRemaining(session);
    // Should be roughly 7h55m give or take (8h timeout - 5min elapsed)
    expect(remaining).toBeGreaterThan(7 * 60 * 60 * 1000);
    expect(remaining).toBeLessThanOrEqual(8 * 60 * 60 * 1000);
  });

  // ---- requireMfaSetup middleware ----

  it('should return 401 if no user ID is present', async () => {
    const req = createMockReq({ user: {} });
    const res = createMockRes();
    const next = vi.fn();
    await requireMfaSetup(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
  });

  it('should return 401 if user not found in database', async () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();
    mockStorage.getUser.mockResolvedValue(null);
    await requireMfaSetup(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should call next() if MFA is enabled on the user account', async () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();
    mockStorage.getUser.mockResolvedValue({ id: 'user-1', mfaEnabled: true, role: 'therapist' });
    await requireMfaSetup(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('should return 403 with MFA_REQUIRED if MFA is not enabled', async () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();
    mockStorage.getUser.mockResolvedValue({ id: 'user-1', mfaEnabled: false, role: 'therapist' });
    await requireMfaSetup(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'MFA_REQUIRED' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 500 if storage throws an error', async () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();
    mockStorage.getUser.mockRejectedValue(new Error('DB down'));
    await requireMfaSetup(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MFA_CHECK_FAILED' }));
  });

  // ---- conditionalRequireMfaSetup ----

  it('should skip MFA check for non-sensitive routes', async () => {
    const req = createMockReq({ originalUrl: '/api/health', path: '/api/health' });
    const res = createMockRes();
    const next = vi.fn();
    await conditionalRequireMfaSetup(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect(mockStorage.getUser).not.toHaveBeenCalled();
  });

  it('should enforce MFA setup for PHI routes via conditionalRequireMfaSetup', async () => {
    const req = createMockReq({ originalUrl: '/api/patients/1', path: '/api/patients/1' });
    const res = createMockRes();
    const next = vi.fn();
    mockStorage.getUser.mockResolvedValue({ id: 'user-1', mfaEnabled: false, role: 'therapist' });
    await conditionalRequireMfaSetup(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ---- adminMfaRequired ----

  it('should return 403 for non-admin users on admin MFA route', async () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();
    mockStorage.getUser.mockResolvedValue({ id: 'user-1', role: 'therapist', mfaEnabled: true });
    await adminMfaRequired(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ADMIN_REQUIRED' }));
  });

  it('should proceed to MFA check for admin users on admin MFA route', async () => {
    const req = createMockReq({
      session: { mfaVerifiedAt: Date.now(), mfaUserId: 'user-1' },
    });
    const res = createMockRes();
    const next = vi.fn();
    // adminMfaRequired calls getUser once, then mfaRequired calls it again
    mockStorage.getUser
      .mockResolvedValueOnce({ id: 'user-1', role: 'admin', mfaEnabled: true })
      .mockResolvedValueOnce({ id: 'user-1', role: 'admin', mfaEnabled: true });
    await adminMfaRequired(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  // ---- MFA_CONFIG ----

  it('should export correct MFA session timeout config', () => {
    expect(MFA_CONFIG.sessionTimeout).toBe(8 * 60 * 60 * 1000);
    expect(MFA_CONFIG.sessionTimeoutMinutes).toBe(480);
  });
});
