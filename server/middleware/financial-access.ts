import type { Response, NextFunction } from 'express';
import { storage } from '../storage';
import logger from '../services/logger';

/**
 * Roles allowed to see practice financials: billed rates per CPT code,
 * contracted rates, claim charges, ERAs, revenue analytics.
 *
 * Therapist-role users are clinical: they review and approve codes (SOAP
 * flow), but what the practice charges per code/session is between the
 * practice owner and the billing staff. This mirrors the checks that already
 * existed piecemeal on /analytics/dashboard, /analytics/recovery-ledger and
 * /analytics/biller-cockpit.
 *
 * MCP tools and Blanche's server-side tools call the storage layer directly
 * (not these HTTP routes), so they are unaffected by this gate.
 */
export const FINANCIAL_ROLES = ['admin', 'billing'] as const;

export const requireFinancialRole = async (
  req: any,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.claims?.sub) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await storage.getUser(req.user.claims.sub);
    if (!user || !FINANCIAL_ROLES.includes(user.role as any)) {
      return res.status(403).json({
        message: 'Access denied. Admin or billing role required for financial data.',
      });
    }

    next();
  } catch (error) {
    logger.error('Error checking financial role', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to verify permissions' });
  }
};
