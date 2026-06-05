/**
 * Provider Profile + Enrollment Identity (Phases 1 & 2 — multi-practice
 * enrollment, 2026-05-30).
 *
 * Captures and validates the billing-provider identity every practice needs
 * before any live claim or ERA enrollment: legal name, NPI (validated +
 * NPPES-confirmed), Tax ID, structured billing address, billing contact,
 * taxonomy, provider type, and an explicit enrollment authorization (the
 * "you may submit enrollments on our behalf" signature).
 *
 * Phase 2 adds the Stedi provider-record create: once the profile is
 * complete + authorized, POST /stedi-provider creates the practice's
 * provider record in our Stedi account and stores the returned id.
 *
 * Routes (mounted at /api/provider-profile):
 *   GET  /                 — current profile + readiness flags (taxId masked)
 *   PUT  /                 — update profile fields (validates NPI)
 *   GET  /npi-lookup       — NPPES lookup for a candidate NPI (?npi=)
 *   POST /authorize        — record enrollment authorization (signer + timestamp)
 *   POST /stedi-provider   — Phase 2: create/refresh the Stedi provider record
 */

import { Router, type Response } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import { isValidNpi, lookupNpi } from '../services/npiValidation';
import { computeReadiness } from '../services/enrollmentReadiness';
import { encryptField, decryptField } from '../services/phiEncryptionService';
import { getStediApiKeyForPractice } from '../services/stediService';
import { createStediProvider } from '../services/stediEnrollmentService';
import { sanitizeExternalError } from '../services/errorSanitizer';

const router = Router();

// Resolve the caller's practice. Returns null when no practice context is
// present — callers MUST 400 rather than silently fall back to a real
// practice. (A `?? 1` default here would route identity edits and live
// enrollment submissions onto practice 1, the real billing entity.)
const getPracticeId = (req: any): number | null =>
  req.authorizedPracticeId ?? req.userPracticeId ?? null;

const NO_PRACTICE = { message: 'No practice context for this user' };

const US_STATE = /^[A-Za-z]{2}$/;
const ZIP = /^\d{5}(-\d{4})?$/;

// Readiness logic lives in services/enrollmentReadiness (pure, db-free,
// unit-tested). Re-exported here for any existing importers.
export { computeReadiness } from '../services/enrollmentReadiness';

function maskTaxId(decrypted: string | null): string | null {
  if (!decrypted) return null;
  const digits = decrypted.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `•••••${digits.slice(-4)}`;
}

// GET /api/provider-profile
router.get('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) return res.status(400).json(NO_PRACTICE);
    const p = await storage.getPractice(practiceId);
    if (!p) return res.status(404).json({ message: 'Practice not found' });

    const taxId = decryptField(p.taxId);
    res.json({
      name: p.name ?? null,
      npi: p.npi ?? null,
      npiType: p.npiType ?? null,
      taxIdMasked: maskTaxId(taxId),
      taxIdPresent: !!taxId,
      taxonomyCode: p.taxonomyCode ?? null,
      address: {
        street: p.addressStreet ?? null,
        city: p.addressCity ?? null,
        state: p.addressState ?? null,
        zip: p.addressZip ?? null,
        legacy: p.address ?? null,
      },
      billingContact: {
        name: p.billingContactName ?? null,
        email: p.billingContactEmail ?? null,
        phone: p.billingContactPhone ?? null,
      },
      enrollmentNotificationEmail: p.enrollmentNotificationEmail ?? null,
      owner: {
        name: p.ownerName ?? null,
        title: p.ownerTitle ?? null,
      },
      enrollmentAuthorizedAt: p.enrollmentAuthorizedAt ?? null,
      stediProviderId: p.stediProviderId ?? null,
      readiness: computeReadiness(p),
    });
  } catch (error) {
    logger.error('Failed to load provider profile', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to load provider profile' });
  }
});

// PUT /api/provider-profile
router.put('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) return res.status(400).json(NO_PRACTICE);
    const b = req.body || {};
    const update: Record<string, any> = {};

    if (typeof b.name === 'string' && b.name.trim()) update.name = b.name.trim();

    if (b.npi !== undefined) {
      const npi = String(b.npi).replace(/\D/g, '');
      if (npi && !isValidNpi(npi)) {
        return res.status(400).json({ message: 'Invalid NPI — failed checksum validation' });
      }
      update.npi = npi || null;
    }

    if (b.npiType !== undefined) {
      if (b.npiType && !['organization', 'individual'].includes(b.npiType)) {
        return res.status(400).json({ message: "npiType must be 'organization' or 'individual'" });
      }
      update.npiType = b.npiType || null;
    }

    if (b.taxId !== undefined) {
      const t = String(b.taxId).trim();
      // Ignore the masked placeholder coming back from the GET payload.
      if (t && !t.includes('•')) {
        const digits = t.replace(/\D/g, '');
        if (digits.length !== 9) {
          return res.status(400).json({ message: 'Tax ID (EIN/SSN) must be 9 digits' });
        }
        // practices.taxId is a varchar column, so store the encrypted field as a
        // JSON string (decryptField JSON-parses it back on read). encryptField
        // returns an object; assigning it raw throws on write to a text column.
        // (The sso/mcp encrypted-secret columns are jsonb, which is why they can
        // assign the object directly.)
        update.taxId = JSON.stringify(encryptField(digits));
      }
    }

    if (b.taxonomyCode !== undefined) update.taxonomyCode = b.taxonomyCode || null;

    if (b.address && typeof b.address === 'object') {
      const a = b.address;
      if (a.state && !US_STATE.test(a.state)) {
        return res.status(400).json({ message: 'State must be a 2-letter code' });
      }
      if (a.zip && !ZIP.test(a.zip)) {
        return res.status(400).json({ message: 'ZIP must be 5 or 9 digits' });
      }
      if (a.street !== undefined) update.addressStreet = a.street || null;
      if (a.city !== undefined) update.addressCity = a.city || null;
      if (a.state !== undefined) update.addressState = a.state ? a.state.toUpperCase() : null;
      if (a.zip !== undefined) update.addressZip = a.zip || null;
    }

    if (b.billingContact && typeof b.billingContact === 'object') {
      const c = b.billingContact;
      if (c.name !== undefined) update.billingContactName = c.name || null;
      if (c.email !== undefined) update.billingContactEmail = c.email || null;
      if (c.phone !== undefined) update.billingContactPhone = c.phone || null;
    }

    if (b.enrollmentNotificationEmail !== undefined) {
      update.enrollmentNotificationEmail = b.enrollmentNotificationEmail || null;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const updated = await storage.updatePractice(practiceId, update);
    logger.info('Provider profile updated', { practiceId, fields: Object.keys(update) });
    res.json({ ok: true, readiness: computeReadiness(updated) });
  } catch (error: any) {
    // Postgres unique violation on practices.npi (23505) — another practice
    // already registered this NPI. Surface a clear 409 instead of a 500.
    if (error?.code === '23505') {
      return res
        .status(409)
        .json({ message: 'That NPI is already registered to another practice.' });
    }
    logger.error('Failed to update provider profile', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to update provider profile' });
  }
});

// GET /api/provider-profile/npi-lookup?npi=...
router.get('/npi-lookup', isAuthenticated, async (req: any, res: Response) => {
  try {
    const npi = String(req.query.npi || '').replace(/\D/g, '');
    if (!npi) return res.status(400).json({ message: 'npi query param required' });
    const result = await lookupNpi(npi);
    res.json(result);
  } catch (error) {
    logger.error('NPI lookup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'NPI lookup failed' });
  }
});

// POST /api/provider-profile/authorize
router.post('/authorize', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) return res.status(400).json(NO_PRACTICE);
    const { ownerName, ownerTitle, ownerSignature } = req.body || {};
    if (!ownerName || !ownerSignature) {
      return res
        .status(400)
        .json({ message: 'ownerName and ownerSignature are required to authorize enrollment' });
    }
    const updated = await storage.updatePractice(practiceId, {
      ownerName: String(ownerName).trim(),
      ownerTitle: ownerTitle ? String(ownerTitle).trim() : undefined,
      ownerSignature: String(ownerSignature).trim(),
      enrollmentAuthorizedAt: new Date(),
    });
    logger.info('Enrollment authorization recorded', { practiceId, ownerName });
    res.json({ ok: true, enrollmentAuthorizedAt: updated.enrollmentAuthorizedAt });
  } catch (error) {
    logger.error('Failed to record enrollment authorization', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to record authorization' });
  }
});

// POST /api/provider-profile/stedi-provider  (Phase 2)
router.post('/stedi-provider', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) return res.status(400).json(NO_PRACTICE);
    const p = await storage.getPractice(practiceId);
    if (!p) return res.status(404).json({ message: 'Practice not found' });

    const readiness = computeReadiness(p);
    if (!readiness.complete) {
      return res.status(412).json({
        message: 'Provider profile incomplete — finish it before creating the Stedi provider record',
        missing: readiness.missing,
      });
    }

    const taxId = decryptField(p.taxId);
    if (!taxId) return res.status(400).json({ message: 'Tax ID missing or undecryptable' });

    const { apiKey } = await getStediApiKeyForPractice(practiceId);
    const street =
      [p.addressStreet, p.addressCity, p.addressState, p.addressZip].filter(Boolean).join(', ') ||
      p.address ||
      undefined;

    const result = await createStediProvider(apiKey, {
      displayName: p.name!,
      npi: p.npi!,
      taxId,
      contactName: p.billingContactName || p.ownerName || undefined,
      address: street,
      email: p.billingContactEmail || p.enrollmentNotificationEmail || undefined,
      phone: p.billingContactPhone || undefined,
    });

    if (!result.ok || !result.providerId) {
      // Log the raw Stedi response server-side only — it can echo provider
      // identifiers and shouldn't reach the browser.
      logger.warn('Stedi provider creation failed', {
        practiceId,
        error: result.error,
        raw: result.raw,
      });
      return res.status(502).json({
        message: 'Stedi provider creation failed',
        error: sanitizeExternalError(result.error),
      });
    }

    const updated = await storage.updatePractice(practiceId, {
      stediProviderId: result.providerId,
    });
    logger.info('Stedi provider record created', { practiceId, stediProviderId: result.providerId });
    res.json({
      ok: true,
      stediProviderId: updated.stediProviderId,
      readiness: computeReadiness(updated),
    });
  } catch (error) {
    logger.error('Failed to create Stedi provider record', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to create Stedi provider record' });
  }
});

export default router;
