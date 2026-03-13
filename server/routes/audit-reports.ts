/**
 * Audit Report Routes
 *
 * Handles:
 * - GET /api/audit-reports/logs          - Paginated, filtered audit log listing
 * - GET /api/audit-reports/summary       - Aggregated counts by action/user/resource
 * - GET /api/audit-reports/user-activity - All actions by a specific user
 * - GET /api/audit-reports/phi-access    - PHI access events (HIPAA compliance)
 * - GET /api/audit-reports/export        - CSV/JSON export of audit logs
 * - GET /api/audit-reports/security      - Security events (failed logins, MFA, etc.)
 *
 * All endpoints require admin role.
 * Mounted at /api/audit-reports in routes.ts.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import {
  getAuditLogs,
  getAuditSummary,
  getUserActivityReport,
  getPhiAccessReport,
  exportAuditLog,
  getSecurityEvents,
} from '../services/auditReportService';
import logger from '../services/logger';

const router = Router();

// ── Admin guard middleware ──────────────────────────────────────────────

const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const userId = user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const dbUser = await storage.getUser(userId);
    if (!dbUser || dbUser.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }
    next();
  } catch (error) {
    logger.error('Error checking admin role in audit-reports', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to verify permissions' });
  }
};

// Helper to resolve practice id from the authenticated request
const getPracticeId = (req: Request): number | null => {
  return (req as any).authorizedPracticeId || (req as any).userPracticeId || null;
};

// Apply admin guard to all routes
router.use(requireAdmin);

// ── GET /logs ───────────────────────────────────────────────────────────

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) {
      return res.status(400).json({ message: 'Practice ID required' });
    }

    const filters = {
      userId: req.query.userId as string | undefined,
      action: req.query.action as string | undefined,
      resourceType: req.query.resourceType as string | undefined,
      dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
      dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
      ipAddress: req.query.ipAddress as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 50,
    };

    const result = await getAuditLogs(practiceId, filters);
    res.json(result);
  } catch (error) {
    logger.error('Error fetching audit logs', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to fetch audit logs' });
  }
});

// ── GET /summary ────────────────────────────────────────────────────────

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) {
      return res.status(400).json({ message: 'Practice ID required' });
    }

    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate are required' });
    }

    const result = await getAuditSummary(
      practiceId,
      new Date(startDate as string),
      new Date(endDate as string),
    );
    res.json(result);
  } catch (error) {
    logger.error('Error fetching audit summary', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to fetch audit summary' });
  }
});

// ── GET /user-activity ──────────────────────────────────────────────────

router.get('/user-activity', async (req: Request, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) {
      return res.status(400).json({ message: 'Practice ID required' });
    }

    const { userId, startDate, endDate } = req.query;
    if (!userId || !startDate || !endDate) {
      return res.status(400).json({ message: 'userId, startDate, and endDate are required' });
    }

    const result = await getUserActivityReport(
      userId as string,
      practiceId,
      new Date(startDate as string),
      new Date(endDate as string),
    );
    res.json(result);
  } catch (error) {
    logger.error('Error fetching user activity report', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to fetch user activity report' });
  }
});

// ── GET /phi-access ─────────────────────────────────────────────────────

router.get('/phi-access', async (req: Request, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) {
      return res.status(400).json({ message: 'Practice ID required' });
    }

    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate are required' });
    }

    const result = await getPhiAccessReport(
      practiceId,
      new Date(startDate as string),
      new Date(endDate as string),
    );
    res.json(result);
  } catch (error) {
    logger.error('Error fetching PHI access report', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to fetch PHI access report' });
  }
});

// ── GET /export ─────────────────────────────────────────────────────────

router.get('/export', async (req: Request, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) {
      return res.status(400).json({ message: 'Practice ID required' });
    }

    const format = (req.query.format as 'csv' | 'json') || 'csv';

    const filters = {
      userId: req.query.userId as string | undefined,
      action: req.query.action as string | undefined,
      resourceType: req.query.resourceType as string | undefined,
      dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
      dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
      ipAddress: req.query.ipAddress as string | undefined,
    };

    const result = await exportAuditLog(practiceId, filters, format);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=audit-log.csv');
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=audit-log.json');
    }

    res.send(result);
  } catch (error) {
    logger.error('Error exporting audit log', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to export audit log' });
  }
});

// ── GET /security ───────────────────────────────────────────────────────

router.get('/security', async (req: Request, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) {
      return res.status(400).json({ message: 'Practice ID required' });
    }

    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate are required' });
    }

    const result = await getSecurityEvents(
      practiceId,
      new Date(startDate as string),
      new Date(endDate as string),
    );
    res.json(result);
  } catch (error) {
    logger.error('Error fetching security events', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to fetch security events' });
  }
});

export default router;
