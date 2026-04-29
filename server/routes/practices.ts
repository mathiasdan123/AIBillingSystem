/**
 * Practice Management Routes
 *
 * Handles:
 * - GET /api/practices/:id - Get practice by ID
 * - PATCH /api/practices/:id - Update practice settings
 * - GET /api/practices/:id/public-info - Get public practice info (for consent forms)
 */

import { Router } from 'express';
import { sql, eq, and } from 'drizzle-orm';
import { storage } from '../storage';
import { db } from '../db';
import { patients, patientPlanDocuments, eligibilityChecks } from '@shared/schema';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

const router = Router();

/**
 * Patients who have insurance on file but no parsed plan documents
 * uploaded yet. Powers the practice-dashboard "missing uploads" widget —
 * practice can see at a glance which patients are leaving Phase 0
 * enrichment value on the table.
 *
 * A patient appears in this list when:
 *   - their record is in this practice
 *   - they have an insurance carrier set (i.e. not pure self-pay)
 *   - they have NO row in patient_plan_documents (any status)
 *
 * Sorted with eligibility-verified patients first (those are the
 * highest-leverage to chase — they're real billed patients).
 */
router.get('/:id/patients-missing-plan-documents', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = parseInt(req.params.id);
    if (isNaN(practiceId)) {
      return res.status(400).json({ message: 'Invalid practice ID' });
    }
    if (req.userPracticeId && req.userPracticeId !== practiceId && req.userRole !== 'admin') {
      return res.status(403).json({ message: 'Cannot view another practice' });
    }
    if (!['admin', 'billing', 'therapist'].includes(req.userRole || '')) {
      return res.status(403).json({ message: 'Staff role required' });
    }

    const rows = await db.execute(sql`
      SELECT
        p.id,
        p.first_name AS "firstName",
        p.last_name AS "lastName",
        p.insurance_provider AS "insuranceProvider",
        p.email,
        p.phone,
        EXISTS (
          SELECT 1 FROM ${eligibilityChecks} e
          WHERE e.patient_id = p.id
        ) AS "hasEligibilityCheck"
      FROM ${patients} p
      WHERE p.practice_id = ${practiceId}
        AND p.deleted_at IS NULL
        AND p.insurance_provider IS NOT NULL
        AND p.insurance_provider <> ''
        AND NOT EXISTS (
          SELECT 1 FROM ${patientPlanDocuments} d
          WHERE d.patient_id = p.id
        )
      ORDER BY "hasEligibilityCheck" DESC, p.last_name, p.first_name
      LIMIT 200
    `);

    const list = (rows as any).rows ?? rows ?? [];
    res.json({
      count: list.length,
      patients: list,
    });
  } catch (err: any) {
    logger.error('Failed to list patients missing plan documents', { error: err?.message });
    res.status(500).json({ message: 'Failed to fetch list' });
  }
});

// Get practice by ID
router.get('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = parseInt(req.params.id);
    const practice = await storage.getPractice(practiceId);
    if (!practice) {
      return res.status(404).json({ message: "Practice not found" });
    }
    res.json(practice);
  } catch (error) {
    logger.error("Error fetching practice", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch practice" });
  }
});

// Update practice settings
router.patch('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = parseInt(req.params.id);
    const updates = req.body;

    // Date columns (e.g. practices.license_expiration) that Postgres will
    // reject if the client sends "". Normalize "" → null on these so the
    // user leaving a date input blank means "clear the value", not an error.
    const DATE_FIELDS = new Set(['licenseExpiration']);

    const cleanUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      // Date-typed field with empty string → clear to NULL.
      if (DATE_FIELDS.has(key) && value === '') {
        cleanUpdates[key] = null;
        continue;
      }
      // Non-date field with explicit null → drop (preserve original behavior).
      if (value === null && !DATE_FIELDS.has(key)) continue;
      cleanUpdates[key] = value;
    }

    const practice = await storage.updatePractice(practiceId, cleanUpdates);
    if (!practice) {
      return res.status(404).json({ message: "Practice not found" });
    }
    res.json(practice);
  } catch (error) {
    logger.error("Error updating practice", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to update practice" });
  }
});

// Get practice info for consent forms (public - needed for intake)
router.get('/:id/public-info', async (req: any, res) => {
  try {
    const practice = await storage.getPractice(parseInt(req.params.id));
    if (!practice) {
      return res.status(404).json({ message: 'Practice not found' });
    }

    // Return only public info needed for consent forms
    res.json({
      id: practice.id,
      name: practice.name,
      address: practice.address,
      phone: practice.phone,
      email: practice.email,
      npi: practice.npi,
      brandLogoUrl: practice.brandLogoUrl,
      brandPrimaryColor: practice.brandPrimaryColor,
      brandPrivacyPolicyUrl: practice.brandPrivacyPolicyUrl,
    });
  } catch (error) {
    logger.error('Error fetching practice info', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch practice info' });
  }
});

export default router;
