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
    // Fail closed: a missing practice context is a deny for non-admins.
    if (req.userRole !== 'admin' && (!req.userPracticeId || req.userPracticeId !== practiceId)) {
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

    // PHI decryption: this endpoint reads patients via raw SQL, bypassing the
    // storage layer that normally decrypts — without this, the widget renders
    // raw {"ciphertext":...} blobs for names/emails/phones.
    const { decryptField } = await import('../services/phiEncryptionService');
    const decrypted = list.map((p: any) => ({
      ...p,
      firstName: decryptField(p.firstName) ?? p.firstName,
      lastName: decryptField(p.lastName) ?? p.lastName,
      email: decryptField(p.email) ?? p.email,
      phone: decryptField(p.phone) ?? p.phone,
    }));

    res.json({
      count: decrypted.length,
      patients: decrypted,
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

    // Tenant isolation. This route returned the WHOLE practice row for any id
    // to any authenticated user, and getPractice DECRYPTS taxId and
    // stediApiKey — so a user at one practice could read another practice's
    // EIN and its live clearinghouse credential, and file claims as them.
    const callerPracticeId = req.authorizedPracticeId ?? req.userPracticeId ?? null;
    if (!req.isPlatformAdmin && practiceId !== callerPracticeId) {
      return res.status(404).json({ message: "Practice not found" });
    }

    const practice = await storage.getPractice(practiceId);
    if (!practice) {
      return res.status(404).json({ message: "Practice not found" });
    }

    // A live API key has no business in a browser even for your own practice.
    // The UI only needs to know whether one is configured, so send that.
    const { stediApiKey, ownerSignature, ...safePractice } = practice as any;
    res.json({
      ...safePractice,
      stediApiKeySet: Boolean(stediApiKey),
    });
  } catch (error) {
    logger.error("Error fetching practice", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch practice" });
  }
});

// Columns that must NEVER be set through this general-purpose PATCH. They gate
// PHI exposure / tenant identity, so they only change via dedicated guarded
// routes (mcpPhiEnabled + mcpRequiresConfirmation → PATCH /:id/mcp-settings)
// or server-side provisioning (isDemo). Without this, any authenticated user
// could flip the MCP PHI kill-switch — or mark their practice isDemo, which
// also bypasses the kill-switch — through this unprivileged endpoint.
const PROTECTED_PRACTICE_FIELDS = new Set([
  'mcpPhiEnabled',
  'mcpRequiresConfirmation',
  'isDemo',
]);

// Update practice settings
router.patch('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = parseInt(req.params.id);
    if (isNaN(practiceId)) {
      return res.status(400).json({ message: 'Invalid practice ID' });
    }
    // Tenant isolation: a user may only edit their OWN practice. Fail closed
    // when practice context is missing.
    if (!req.userPracticeId || req.userPracticeId !== practiceId) {
      return res.status(403).json({ message: 'Cannot modify another practice' });
    }

    const updates = req.body;

    // Date columns (e.g. practices.license_expiration) that Postgres will
    // reject if the client sends "". Normalize "" → null on these so the
    // user leaving a date input blank means "clear the value", not an error.
    const DATE_FIELDS = new Set(['licenseExpiration']);

    const cleanUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      // Privileged flags never travel through this endpoint (see above).
      if (PROTECTED_PRACTICE_FIELDS.has(key)) continue;
      // Date-typed field with empty string → clear to NULL.
      if (DATE_FIELDS.has(key) && value === '') {
        cleanUpdates[key] = null;
        continue;
      }
      // Non-date field with explicit null → drop (preserve original behavior).
      if (value === null && !DATE_FIELDS.has(key)) continue;
      // Guard: never re-persist a taxId that's already an encrypted blob (the
      // client read it back from a legacy double-encrypted row). storage would
      // encrypt it AGAIN. Skip it — taxId only changes when a fresh plaintext
      // value is entered.
      if (key === 'taxId' && typeof value === 'string' && value.includes('ciphertext')) continue;
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

/**
 * PATCH /api/practices/:id/mcp-settings — toggle the MCP connector switches.
 *
 * Dedicated, admin-guarded endpoint (the generic PATCH /:id above is only
 * isAuthenticated). These two flags gate PHI exposure and mutation consent
 * over the MCP/Claude Desktop surface, so flipping them is admin-only and
 * scoped to the caller's own practice — never another practice's.
 *
 *   mcpPhiEnabled          — allow containsPhi tools to return data
 *   mcpRequiresConfirmation — require a server-side confirm on MCP mutations
 */
router.patch('/:id/mcp-settings', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = parseInt(req.params.id);
    if (isNaN(practiceId)) {
      return res.status(400).json({ message: 'Invalid practice ID' });
    }
    if (req.userRole !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }
    // Fail closed: only an admin acting on their OWN practice may flip these.
    if (!req.userPracticeId || req.userPracticeId !== practiceId) {
      return res.status(403).json({ message: 'Cannot modify another practice' });
    }

    const updates: Record<string, boolean> = {};
    if (typeof req.body?.mcpPhiEnabled === 'boolean') {
      updates.mcpPhiEnabled = req.body.mcpPhiEnabled;
    }
    if (typeof req.body?.mcpRequiresConfirmation === 'boolean') {
      updates.mcpRequiresConfirmation = req.body.mcpRequiresConfirmation;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No MCP settings provided' });
    }

    const practice = await storage.updatePractice(practiceId, updates as any);
    if (!practice) {
      return res.status(404).json({ message: 'Practice not found' });
    }

    logger.info('MCP settings updated', {
      practiceId,
      userId: req.user?.claims?.sub,
      ...updates,
    });

    res.json({
      mcpPhiEnabled: practice.mcpPhiEnabled,
      mcpRequiresConfirmation: practice.mcpRequiresConfirmation,
    });
  } catch (error) {
    logger.error('Error updating MCP settings', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update MCP settings' });
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
