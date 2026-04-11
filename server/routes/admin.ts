/**
 * Admin Routes
 *
 * Handles:
 * - GET /api/admin/payer-integrations - List payer integrations
 * - POST /api/admin/payer-credentials - Save payer credentials
 * - POST /api/admin/payer-integrations/:name/health-check - Payer health check
 * - POST /api/admin/hard-delete-expired - Hard delete expired patients
 * - POST /api/admin/cache/clear - Clear application cache
 * - GET /api/admin/cache/stats - Cache statistics
 *
 * Mounted at /api so all paths include their full prefix.
 */

import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { StediAdapter } from '../payer-integrations/adapters/payers/StediAdapter';
import { triggerHardDeletionNow } from '../scheduler';
import { cache } from '../services/cacheService';
import logger from '../services/logger';

const router = Router();

// Helper to get authorized practiceId from request
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) {
    return req.authorizedPracticeId;
  }

  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;

  if (userRole === 'admin') {
    return requestedPracticeId || userPracticeId || 1;
  }

  if (!userPracticeId) {
    throw new Error('User not assigned to a practice. Contact administrator.');
  }

  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    logger.warn(`Practice access restricted: User requested practice ${requestedPracticeId} but assigned to ${userPracticeId}`);
    return userPracticeId;
  }

  return requestedPracticeId || userPracticeId;
};

// Middleware to check if user has admin or billing role
const isAdminOrBilling = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await storage.getUser(req.user.claims.sub);
    if (!user || (user.role !== 'admin' && user.role !== 'billing')) {
      return res.status(403).json({ message: "Access denied. Admin or billing role required." });
    }

    next();
  } catch (error) {
    logger.error("Error checking user role", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to verify permissions" });
  }
};

// Middleware to check if user has admin role
const isAdmin = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await storage.getUser(req.user.claims.sub);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    next();
  } catch (error) {
    logger.error("Error checking user role", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to verify permissions" });
  }
};

// Get payer integrations list
router.get('/admin/payer-integrations', isAuthenticated, isAdminOrBilling, async (req, res) => {
  try {
    const creds = await storage.getAllPayerCredentialsList();
    res.json(creds);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch payer integrations' });
  }
});

// Save payer credentials
router.post('/admin/payer-credentials', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { payerName, apiKey } = req.body;
    await storage.upsertPayerCredentials(practiceId, { payerName, apiKey });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Failed to save credentials' });
  }
});

// Payer health check
router.post('/admin/payer-integrations/:name/health-check', isAuthenticated, isAdminOrBilling, async (req, res) => {
  try {
    const { name } = req.params;
    if (name === 'stedi') {
      const creds = await storage.getPayerCredentials(1, 'stedi');
      if (!creds) return res.status(404).json({ message: 'No Stedi credentials found' });
      const adapter = new StediAdapter((creds.credentials as any).apiKey);
      const result = await adapter.healthCheck();
      await storage.updatePayerHealthStatus(creds.id, result.healthy ? 'healthy' : 'down');
      res.json(result);
    } else {
      res.status(404).json({ message: 'Unknown payer' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Health check failed' });
  }
});

// Hard delete expired patients
router.post('/admin/hard-delete-expired', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    logger.info('Manual hard deletion triggered', { userId: req.user?.claims?.sub });
    const result = await triggerHardDeletionNow();

    await storage.createAuditLog({
      userId: req.user?.claims?.sub || 'unknown',
      eventType: 'delete',
      eventCategory: 'data_retention',
      resourceType: 'system',
      resourceId: 'hard-deletion',
      details: { deletedCount: result.deletedCount, errors: result.errors },
      ipAddress: req.ip || '0.0.0.0',
    });

    res.json({
      message: `Hard deletion completed. ${result.deletedCount} patient(s) permanently removed.`,
      deletedCount: result.deletedCount,
      errors: result.errors,
    });
  } catch (error: any) {
    logger.error('Manual hard deletion failed', { error: error.message });
    res.status(500).json({ message: 'Hard deletion failed' });
  }
});

// ==================== CACHE MANAGEMENT ====================

router.post('/admin/cache/clear', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    await cache.clear();
    const stats = cache.getStats();
    logger.info('Cache cleared by admin', { userId: req.user?.claims?.sub });
    res.json({ message: 'Cache cleared successfully', stats });
  } catch (error) {
    logger.error('Error clearing cache', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to clear cache' });
  }
});

router.get('/admin/cache/stats', isAuthenticated, isAdmin, async (_req, res) => {
  try {
    const stats = cache.getStats();
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching cache stats', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch cache stats' });
  }
});

// POST /api/admin/reset-demo-data - Wipe all practice data and re-seed demo patients
// Protected by admin role + confirmation parameter to prevent accidental use
router.post('/admin/reset-demo-data', isAuthenticated, isAdminOrBilling, async (req: any, res: Response) => {
  try {
    const { confirm } = req.body;
    if (confirm !== 'RESET_ALL_DATA') {
      return res.status(400).json({
        message: 'Safety check failed. Send { "confirm": "RESET_ALL_DATA" } to proceed.',
      });
    }

    const practiceId = getAuthorizedPracticeId(req);
    const { getDb } = await import('../db');
    const db = await getDb();
    const { sql } = await import('drizzle-orm');

    logger.warn('Admin: resetting all demo data', {
      practiceId,
      userId: req.user?.claims?.sub,
    });

    // Delete in FK-safe order (children first)
    const tables = [
      'eligibility_checks',
      'eligibility_alerts',
      'claim_line_items',
      'claim_follow_ups',
      'claim_corrections',
      'claim_outcomes',
      'claim_status_checks',
      'appeal_outcomes',
      'appeals',
      'soap_note_goal_progress',
      'goal_progress_notes',
      'treatment_objectives',
      'treatment_interventions',
      'treatment_goals',
      'treatment_plans',
      'soap_note_drafts',
      'soap_notes',
      'treatment_sessions',
      'payment_plan_installments',
      'payment_plans',
      'payment_transactions',
      'payment_postings',
      'patient_payments',
      'payments',
      'invoices',
      'superbills',
      'time_entries',
      'remittance_line_items',
      'remittance_advice',
      'expenses',
      'message_notifications',
      'messages',
      'conversations',
      'patient_documents',
      'patient_statements',
      'patient_consents',
      'patient_assessments',
      'assessment_schedules',
      'survey_responses',
      'survey_assignments',
      'patient_portal_access',
      'patient_insurance_authorizations',
      'treatment_authorizations',
      'patient_plan_documents',
      'patient_plan_benefits',
      'patient_payment_methods',
      'patient_progress_notes',
      'referral_communications',
      'referrals',
      'appointment_requests',
      'online_bookings',
      'waitlist',
      'review_requests',
      'patient_feedback',
      'appointments',
      'claims',
      'insurances',
      'patients',
    ];

    let deleted = 0;
    for (const table of tables) {
      try {
        // Use sql.raw for table name (can't parameterize table names) but parameterize the value
        const result = await db.execute(
          sql`DELETE FROM ${sql.raw(table)} WHERE practice_id = ${practiceId}`
        );
        const count = (result as any).rowCount ?? (result as any).rows?.length ?? 0;
        if (count > 0) {
          logger.info(`Reset: deleted ${count} rows from ${table}`);
          deleted += count;
        }
      } catch (err: any) {
        // Some tables may not have practice_id — try patient_id FK instead
        try {
          const result2 = await db.execute(
            sql`DELETE FROM ${sql.raw(table)} WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = ${practiceId})`
          );
          const count2 = (result2 as any).rowCount ?? 0;
          if (count2 > 0) {
            logger.info(`Reset: deleted ${count2} rows from ${table} (via patient_id)`);
            deleted += count2;
          }
        } catch {
          logger.debug(`Reset: skipped ${table}: ${err.message}`);
        }
      }
    }

    // Re-seed demo patients
    const { seedDatabase } = await import('../seeds');
    await seedDatabase({ force: true });

    logger.warn('Admin: demo data reset complete', { practiceId, deletedRows: deleted });

    res.json({
      success: true,
      message: `Deleted ${deleted} rows across ${tables.length} tables and re-seeded demo data.`,
      deletedRows: deleted,
    });
  } catch (error) {
    logger.error('Failed to reset demo data', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to reset demo data' });
  }
});

export default router;
