/**
 * MFA Enforcement Middleware for PHI Access
 *
 * HIPAA Security Rule 45 CFR 164.312(d) requires covered entities to implement
 * procedures to verify that a person seeking access to electronic protected
 * health information (ePHI) is the one claimed.
 *
 * This middleware enforces Multi-Factor Authentication for:
 * - Admin users accessing any sensitive operation
 * - Any user accessing Protected Health Information (PHI)
 * - Data export operations
 * - User management and administrative functions
 *
 * MFA VERIFICATION REQUIREMENTS:
 * - MFA must be enabled on the user's account (mfaEnabled: true)
 * - MFA must be verified within the current session (mfaVerifiedAt timestamp)
 * - Verification expires after MFA_SESSION_TIMEOUT (default: 15 minutes)
 */

import type { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import logger from '../services/logger';

// MFA session timeout in milliseconds (15 minutes for HIPAA compliance)
const MFA_SESSION_TIMEOUT = 15 * 60 * 1000;

// Extend Express session type to include MFA verification
declare module 'express-session' {
  interface SessionData {
    mfaVerifiedAt?: number;
    mfaUserId?: string;
  }
}

// Route patterns that require MFA for all authenticated users
const PHI_ROUTE_PATTERNS = [
  /^\/api\/patients/,
  /^\/api\/soap-notes/,
  /^\/api\/sessions/,
  /^\/api\/claims/,
  /^\/api\/insurance/,
  /^\/api\/eligibility/,
  /^\/api\/patient-consents/,
  /^\/api\/patient-rights/,
  /^\/api\/ai\/(generate-soap|transcribe)/,
  /^\/api\/voice/,
  /^\/api\/appeals/,
  /^\/api\/treatment-plans/,
  /^\/api\/assessments/,
];

// Export route patterns require MFA
const EXPORT_ROUTE_PATTERNS = [
  /\/export/,
  /^\/api\/export-training-data/,
  /^\/api\/patients\/.*\/documents/,
  /^\/api\/patients\/.*\/statements/,
];

// Admin-only routes that require MFA
const ADMIN_ROUTE_PATTERNS = [
  /^\/api\/admin/,
  /^\/api\/users/,
  /^\/api\/invites/,
  /^\/api\/setup/,
  /^\/api\/baa/,
  /^\/api\/breach/,
  /^\/api\/hard-delete/,
];

/**
 * Check if a route path requires MFA enforcement
 */
export function requiresMfaEnforcement(path: string, userRole?: string): boolean {
  // Admin users always require MFA for sensitive operations
  if (userRole === 'admin') {
    // Check if it's a sensitive route for admins
    const isSensitiveRoute = [
      ...PHI_ROUTE_PATTERNS,
      ...EXPORT_ROUTE_PATTERNS,
      ...ADMIN_ROUTE_PATTERNS,
    ].some(pattern => pattern.test(path));

    if (isSensitiveRoute) return true;
  }

  // All users require MFA for PHI access
  if (PHI_ROUTE_PATTERNS.some(pattern => pattern.test(path))) {
    return true;
  }

  // All users require MFA for exports
  if (EXPORT_ROUTE_PATTERNS.some(pattern => pattern.test(path))) {
    return true;
  }

  // Admin-only routes always require MFA
  if (ADMIN_ROUTE_PATTERNS.some(pattern => pattern.test(path))) {
    return true;
  }

  return false;
}

/**
 * Check if MFA has been verified within the session timeout period
 */
export function isMfaSessionValid(session: any, userId: string): boolean {
  if (!session?.mfaVerifiedAt || !session?.mfaUserId) {
    return false;
  }

  // Ensure MFA was verified for this specific user
  if (session.mfaUserId !== userId) {
    return false;
  }

  const now = Date.now();
  const elapsed = now - session.mfaVerifiedAt;

  return elapsed < MFA_SESSION_TIMEOUT;
}

/**
 * Set MFA verification status in session
 * Call this after successful MFA verification
 */
export function setMfaVerified(session: any, userId: string): void {
  session.mfaVerifiedAt = Date.now();
  session.mfaUserId = userId;
}

/**
 * Clear MFA verification from session
 * Call this on logout or session invalidation
 */
export function clearMfaVerification(session: any): void {
  delete session.mfaVerifiedAt;
  delete session.mfaUserId;
}

/**
 * Get remaining MFA session time in milliseconds
 */
export function getMfaSessionTimeRemaining(session: any): number {
  if (!session?.mfaVerifiedAt) {
    return 0;
  }
  const elapsed = Date.now() - session.mfaVerifiedAt;
  return Math.max(0, MFA_SESSION_TIMEOUT - elapsed);
}

/**
 * MFA Required Middleware
 *
 * Enforces MFA verification for sensitive operations.
 * Returns 403 if MFA is not enabled or not recently verified.
 *
 * Usage:
 *   app.get('/api/patients', isAuthenticated, mfaRequired, handler);
 *
 * Or apply to all PHI routes:
 *   app.use('/api/patients', isAuthenticated, mfaRequired);
 */
export const mfaRequired = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const userId = user?.claims?.sub;
    const session = (req as any).session;

    if (!userId) {
      return res.status(401).json({
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    // Fetch user from database to check MFA status
    const dbUser = await storage.getUser(userId);

    if (!dbUser) {
      logger.warn('MFA check failed: User not found', { userId });
      return res.status(401).json({
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Check if MFA is enabled on the account
    if (!dbUser.mfaEnabled) {
      logger.warn('MFA enforcement failed: MFA not enabled', {
        userId,
        path: req.path,
        userRole: dbUser.role
      });
      return res.status(403).json({
        message: 'Multi-Factor Authentication is required for this operation. Please enable MFA in your security settings.',
        code: 'MFA_NOT_ENABLED',
        requiresSetup: true
      });
    }

    // Check if MFA has been verified recently in this session
    if (!isMfaSessionValid(session, userId)) {
      const timeRemaining = getMfaSessionTimeRemaining(session);

      logger.info('MFA verification required', {
        userId,
        path: req.path,
        sessionExpired: timeRemaining === 0,
        userRole: dbUser.role
      });

      return res.status(403).json({
        message: 'MFA verification required. Please complete MFA challenge to continue.',
        code: 'MFA_VERIFICATION_REQUIRED',
        requiresChallenge: true
      });
    }

    // MFA is valid, proceed
    logger.debug('MFA verification passed', {
      userId,
      path: req.path,
      timeRemaining: getMfaSessionTimeRemaining(session)
    });

    next();
  } catch (error) {
    logger.error('MFA middleware error', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      message: 'Failed to verify MFA status',
      code: 'MFA_CHECK_FAILED'
    });
  }
};

/**
 * Conditional MFA Middleware
 *
 * Only enforces MFA for routes that match sensitive patterns.
 * Use this for applying MFA across a router or set of routes.
 *
 * Usage:
 *   app.use('/api', isAuthenticated, conditionalMfaRequired);
 */
export const conditionalMfaRequired = async (req: Request, res: Response, next: NextFunction) => {
  const userRole = (req as any).userRole;
  const path = req.path;

  // Check if this route requires MFA
  if (!requiresMfaEnforcement(path, userRole)) {
    return next();
  }

  // Apply MFA check
  return mfaRequired(req, res, next);
};

/**
 * MFA Required for Admin Operations
 *
 * Specifically checks for admin role AND MFA verification.
 * Use for sensitive admin-only operations.
 */
export const adminMfaRequired = async (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;

  if (!userId) {
    return res.status(401).json({
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  const dbUser = await storage.getUser(userId);

  if (!dbUser || dbUser.role !== 'admin') {
    return res.status(403).json({
      message: 'Admin access required',
      code: 'ADMIN_REQUIRED'
    });
  }

  // Apply MFA check for admin
  return mfaRequired(req, res, next);
};

/**
 * Route patterns requiring MFA (exported for documentation and testing)
 */
export const MFA_PROTECTED_ROUTES = {
  phi: PHI_ROUTE_PATTERNS.map(p => p.toString()),
  exports: EXPORT_ROUTE_PATTERNS.map(p => p.toString()),
  admin: ADMIN_ROUTE_PATTERNS.map(p => p.toString()),
};

/**
 * Configuration constants (exported for testing)
 */
export const MFA_CONFIG = {
  sessionTimeout: MFA_SESSION_TIMEOUT,
  sessionTimeoutMinutes: MFA_SESSION_TIMEOUT / 60000,
};
