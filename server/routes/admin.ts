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
    const { db } = await import('../db');
    const { sql } = await import('drizzle-orm');

    logger.warn('Admin: resetting all demo data', {
      practiceId,
      userId: req.user?.claims?.sub,
    });

    // Delete using explicit cascading subqueries in FK-safe order
    const patientCheck = await db.execute(sql`SELECT COUNT(*) as count FROM patients WHERE practice_id = ${practiceId}`);
    logger.warn(`Reset: found ${JSON.stringify(patientCheck.rows)} patients for practice ${practiceId}`);

    let deleted = 0;
    const run = async (label: string, query: ReturnType<typeof sql>) => {
      try {
        const result = await db.execute(query);
        const count = (result as any).rowCount ?? 0;
        if (count > 0) {
          logger.warn(`Reset: deleted ${count} from ${label}`);
          deleted += count;
        }
      } catch (err: any) {
        logger.warn(`Reset: error on ${label}: ${err.message}`);
      }
    };

    // Tables with claim_id FK (must delete before claims)
    await run('claim_line_items', sql`DELETE FROM claim_line_items WHERE claim_id IN (SELECT id FROM claims WHERE practice_id = ${practiceId})`);
    await run('claim_follow_ups', sql`DELETE FROM claim_follow_ups WHERE claim_id IN (SELECT id FROM claims WHERE practice_id = ${practiceId})`);
    await run('claim_corrections', sql`DELETE FROM claim_corrections WHERE claim_id IN (SELECT id FROM claims WHERE practice_id = ${practiceId})`);
    await run('claim_outcomes', sql`DELETE FROM claim_outcomes WHERE claim_id IN (SELECT id FROM claims WHERE practice_id = ${practiceId})`);
    await run('claim_status_checks', sql`DELETE FROM claim_status_checks WHERE claim_id IN (SELECT id FROM claims WHERE practice_id = ${practiceId})`);
    await run('appeal_outcomes', sql`DELETE FROM appeal_outcomes WHERE appeal_id IN (SELECT id FROM appeals WHERE practice_id = ${practiceId})`);
    await run('appeals', sql`DELETE FROM appeals WHERE practice_id = ${practiceId}`);
    await run('payment_postings', sql`DELETE FROM payment_postings WHERE claim_id IN (SELECT id FROM claims WHERE practice_id = ${practiceId})`);
    await run('superbills', sql`DELETE FROM superbills WHERE practice_id = ${practiceId}`);

    // Tables with patient_id FK (must delete before patients)
    await run('eligibility_checks', sql`DELETE FROM eligibility_checks WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = ${practiceId})`);
    await run('eligibility_alerts', sql`DELETE FROM eligibility_alerts WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = ${practiceId})`);
    await run('soap_note_goal_progress', sql`DELETE FROM soap_note_goal_progress WHERE soap_note_id IN (SELECT id FROM soap_notes WHERE practice_id = ${practiceId})`);
    await run('soap_note_drafts', sql`DELETE FROM soap_note_drafts WHERE practice_id = ${practiceId}`);
    await run('soap_notes', sql`DELETE FROM soap_notes WHERE practice_id = ${practiceId}`);
    await run('treatment_sessions', sql`DELETE FROM treatment_sessions WHERE practice_id = ${practiceId}`);
    await run('goal_progress_notes', sql`DELETE FROM goal_progress_notes WHERE goal_id IN (SELECT id FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE practice_id = ${practiceId}))`);
    await run('treatment_objectives', sql`DELETE FROM treatment_objectives WHERE goal_id IN (SELECT id FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE practice_id = ${practiceId}))`);
    await run('treatment_interventions', sql`DELETE FROM treatment_interventions WHERE goal_id IN (SELECT id FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE practice_id = ${practiceId}))`);
    await run('treatment_goals', sql`DELETE FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE practice_id = ${practiceId})`);
    await run('treatment_plans', sql`DELETE FROM treatment_plans WHERE practice_id = ${practiceId}`);
    await run('payment_plan_installments', sql`DELETE FROM payment_plan_installments WHERE plan_id IN (SELECT id FROM payment_plans WHERE practice_id = ${practiceId})`);
    await run('payment_plans', sql`DELETE FROM payment_plans WHERE practice_id = ${practiceId}`);
    await run('payment_transactions', sql`DELETE FROM payment_transactions WHERE practice_id = ${practiceId}`);
    await run('patient_payments', sql`DELETE FROM patient_payments WHERE practice_id = ${practiceId}`);
    await run('payments', sql`DELETE FROM payments WHERE practice_id = ${practiceId}`);
    await run('invoices', sql`DELETE FROM invoices WHERE practice_id = ${practiceId}`);
    await run('time_entries', sql`DELETE FROM time_entries WHERE practice_id = ${practiceId}`);
    await run('remittance_line_items', sql`DELETE FROM remittance_line_items WHERE remittance_id IN (SELECT id FROM remittance_advice WHERE practice_id = ${practiceId})`);
    await run('remittance_advice', sql`DELETE FROM remittance_advice WHERE practice_id = ${practiceId}`);
    await run('expenses', sql`DELETE FROM expenses WHERE practice_id = ${practiceId}`);
    await run('message_notifications', sql`DELETE FROM message_notifications WHERE conversation_id IN (SELECT id FROM conversations WHERE practice_id = ${practiceId})`);
    await run('messages', sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE practice_id = ${practiceId})`);
    await run('conversations', sql`DELETE FROM conversations WHERE practice_id = ${practiceId}`);
    await run('patient_documents', sql`DELETE FROM patient_documents WHERE practice_id = ${practiceId}`);
    await run('patient_statements', sql`DELETE FROM patient_statements WHERE practice_id = ${practiceId}`);
    await run('patient_consents', sql`DELETE FROM patient_consents WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = ${practiceId})`);
    await run('patient_assessments', sql`DELETE FROM patient_assessments WHERE practice_id = ${practiceId}`);
    await run('assessment_schedules', sql`DELETE FROM assessment_schedules WHERE practice_id = ${practiceId}`);
    await run('survey_responses', sql`DELETE FROM survey_responses WHERE practice_id = ${practiceId}`);
    await run('survey_assignments', sql`DELETE FROM survey_assignments WHERE practice_id = ${practiceId}`);
    await run('patient_portal_access', sql`DELETE FROM patient_portal_access WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = ${practiceId})`);
    await run('patient_insurance_authorizations', sql`DELETE FROM patient_insurance_authorizations WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = ${practiceId})`);
    await run('treatment_authorizations', sql`DELETE FROM treatment_authorizations WHERE practice_id = ${practiceId}`);
    await run('patient_plan_documents', sql`DELETE FROM patient_plan_documents WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = ${practiceId})`);
    await run('patient_plan_benefits', sql`DELETE FROM patient_plan_benefits WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = ${practiceId})`);
    await run('patient_payment_methods', sql`DELETE FROM patient_payment_methods WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = ${practiceId})`);
    await run('patient_progress_notes', sql`DELETE FROM patient_progress_notes WHERE practice_id = ${practiceId}`);
    await run('referral_communications', sql`DELETE FROM referral_communications WHERE referral_id IN (SELECT id FROM referrals WHERE practice_id = ${practiceId})`);
    await run('referrals', sql`DELETE FROM referrals WHERE practice_id = ${practiceId}`);
    await run('appointment_requests', sql`DELETE FROM appointment_requests WHERE practice_id = ${practiceId}`);
    await run('online_bookings', sql`DELETE FROM online_bookings WHERE practice_id = ${practiceId}`);
    await run('waitlist', sql`DELETE FROM waitlist WHERE practice_id = ${practiceId}`);
    await run('review_requests', sql`DELETE FROM review_requests WHERE practice_id = ${practiceId}`);
    await run('patient_feedback', sql`DELETE FROM patient_feedback WHERE practice_id = ${practiceId}`);
    await run('appointments', sql`DELETE FROM appointments WHERE practice_id = ${practiceId}`);

    // Now safe to delete claims, insurances, patients
    await run('claims', sql`DELETE FROM claims WHERE practice_id = ${practiceId}`);
    await run('insurances', sql`DELETE FROM insurances WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = ${practiceId})`);
    await run('patients', sql`DELETE FROM patients WHERE practice_id = ${practiceId}`);

    // Re-seed demo patients
    const { seedDatabase } = await import('../seeds');
    await seedDatabase({ force: true });

    logger.warn('Admin: demo data reset complete', { practiceId, deletedRows: deleted });

    res.json({
      success: true,
      message: `Deleted ${deleted} rows and re-seeded demo data.`,
      deletedRows: deleted,
    });
  } catch (error) {
    logger.error('Failed to reset demo data', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to reset demo data' });
  }
});

export default router;
