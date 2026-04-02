/**
 * MFA Setup Required Middleware
 *
 * Enforces that users must have MFA enabled before accessing PHI routes.
 * This is a HIPAA requirement: all users accessing ePHI must have MFA configured.
 *
 * To skip MFA enforcement (e.g., for local development), set the explicit
 * environment variable SKIP_MFA_ENFORCEMENT=true.
 *
 * Apply this middleware BEFORE the mfaRequired middleware in the chain:
 *   isAuthenticated -> mfaSetupRequired -> mfaRequired -> handler
 */

import type { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import logger from '../services/logger';

export const mfaSetupRequired = async (req: Request, res: Response, next: NextFunction) => {
  // Skip MFA setup enforcement only with explicit opt-out (not just NODE_ENV)
  if (process.env.SKIP_MFA_ENFORCEMENT === 'true') {
    return next();
  }

  try {
    const user = (req as any).user;
    const userId = user?.claims?.sub;

    if (!userId) {
      return res.status(401).json({
        message: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    const dbUser = await storage.getUser(userId);

    if (!dbUser) {
      logger.warn('MFA setup check failed: User not found', { userId });
      return res.status(401).json({
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    if (dbUser.mfaEnabled) {
      return next();
    }

    logger.warn('MFA setup required: user has not enabled MFA', {
      userId,
      path: req.path,
      userRole: dbUser.role,
    });

    return res.status(403).json({
      error: 'MFA setup required',
      code: 'MFA_SETUP_REQUIRED',
      message:
        'Multi-factor authentication must be enabled before accessing patient data. Please set up MFA in your account settings.',
    });
  } catch (error) {
    logger.error('MFA setup required middleware error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      message: 'Failed to verify MFA setup status',
      code: 'MFA_CHECK_FAILED',
    });
  }
};
