/**
 * Practice Payer Mapping routes (Phase 2 — onboarding review & confirm).
 *
 * Lets a practice turn the raw insurance names on its patients into verified
 * Stedi payer IDs, with a human review step. The resolver (Phase 1,
 * services/payerMappingService) does the matching; these endpoints expose it:
 *
 *   GET  /api/payer-mapping          — current resolved/confirmed mappings
 *   POST /api/payer-mapping/scan     — gather distinct patient payer names +
 *                                      resolve each (persists drafts), return them
 *   GET  /api/payer-mapping/search   — live Stedi payer search for the override picker
 *   PUT  /api/payer-mapping/:id      — confirm/override a mapping (sets a verified
 *                                      payer ID, status=confirmed) + seed enrollment rows
 *
 * Reads (GET) require an authenticated, practice-scoped session. The mutating
 * routes (POST /scan, PUT /:id) additionally require admin + recent MFA
 * (adminMfaRequired) — they change payer routing and trigger live Stedi calls.
 */

import { Router, type Response } from 'express';
import { isAuthenticated } from '../replitAuth';
import { adminMfaRequired } from '../middleware/mfa-required';
import logger from '../services/logger';
import { db } from '../db';
import { practicePayerMap, patients, payerEnrollments } from '@shared/schema';
import { and, eq } from 'drizzle-orm';
import { resolveDistinctPayers } from '../services/payerMappingService';
import { searchPayers } from '../services/stediService';

const router = Router();

const getPracticeId = (req: any): number | null =>
  req.authorizedPracticeId ?? req.userPracticeId ?? null;

const NO_PRACTICE = { message: 'No practice context for this user' };

// Caps on POST /scan to bound live Stedi calls: a scan can resolve at most this
// many distinct payers, and the caller-supplied `payerNames` array (and each
// entry) is bounded so a request can't fan out into thousands of live searches.
const MAX_SCAN_PAYERS = 100;
const MAX_EXTRA_NAMES = 50;
const MAX_NAME_LEN = 200;

// Stedi's per-transaction support is a flat map of known keys → status strings.
// Sanitize untrusted body JSON down to that shape before persisting to jsonb so
// a client can't stuff arbitrary/oversized blobs into the routing table.
const SUPPORT_KEYS = [
  'eligibilityCheck',
  'professionalClaimSubmission',
  'claimStatus',
  'claimPayment',
] as const;
function sanitizeTransactionSupport(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const k of SUPPORT_KEYS) {
    const val = (v as Record<string, unknown>)[k];
    if (typeof val === 'string') out[k] = val.slice(0, 40);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// GET /api/payer-mapping — list this practice's mappings.
router.get('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) return res.status(400).json(NO_PRACTICE);
    const rows = await db
      .select()
      .from(practicePayerMap)
      .where(eq(practicePayerMap.practiceId, practiceId))
      .orderBy(practicePayerMap.rawName);
    res.json({ mappings: rows });
  } catch (error) {
    logger.error('Failed to list payer mappings', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to list payer mappings' });
  }
});

// POST /api/payer-mapping/scan — collect distinct patient payer names (plus any
// extra names in the body) and resolve each. Persists drafts into the map.
router.post('/scan', isAuthenticated, adminMfaRequired, async (req: any, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) return res.status(400).json(NO_PRACTICE);

    const distinct = await db
      .selectDistinct({ name: patients.insuranceProvider })
      .from(patients)
      .where(eq(patients.practiceId, practiceId));

    const fromPatients = distinct
      .map((r: { name: string | null }) => r.name)
      .filter((n: string | null): n is string => !!n && n.trim() !== '');

    // Caller-supplied extra names are attacker-controllable, so bound the array
    // length and each entry before they fan out into live Stedi searches.
    const extra = (Array.isArray(req.body?.payerNames) ? req.body.payerNames : [])
      .filter((x: unknown): x is string => typeof x === 'string')
      .slice(0, MAX_EXTRA_NAMES)
      .map((s: string) => s.slice(0, MAX_NAME_LEN));

    const allNames = [...fromPatients, ...extra];
    const truncated = allNames.length > MAX_SCAN_PAYERS;
    const names = truncated ? allNames.slice(0, MAX_SCAN_PAYERS) : allNames;
    if (truncated) {
      logger.warn('Payer mapping scan truncated', {
        practiceId,
        total: allNames.length,
        cap: MAX_SCAN_PAYERS,
      });
    }

    const resolved = await resolveDistinctPayers(practiceId, names);

    const matched = resolved.filter((r) => r.resolved.stediPayerId).length;
    logger.info('Payer mapping scan', {
      practiceId,
      distinctPayers: resolved.length,
      matched,
    });

    res.json({
      scannedFromPatients: fromPatients.length,
      distinctPayers: resolved.length,
      matched,
      needsReview: resolved.length - matched,
      truncated,
      mappings: resolved,
    });
  } catch (error) {
    logger.error('Payer mapping scan failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Payer mapping scan failed' });
  }
});

// GET /api/payer-mapping/search?q= — live Stedi payer search for the override picker.
router.get('/search', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) return res.status(400).json(NO_PRACTICE);
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ message: 'q query param required' });
    const results = await searchPayers(q, { practiceId, pageSize: 10 });
    res.json({ results });
  } catch (error) {
    logger.error('Payer mapping search failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(502).json({ message: 'Payer search failed' });
  }
});

// PUT /api/payer-mapping/:id — confirm or override a mapping. Sets a verified
// payer ID + status=confirmed, then seeds not_enrolled payerEnrollments rows so
// the payer shows up on the enrollment tracker.
router.put('/:id', isAuthenticated, adminMfaRequired, async (req: any, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) return res.status(400).json(NO_PRACTICE);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid mapping id' });

    const b = req.body || {};
    // Scope check: the row must belong to the caller's practice.
    const [row] = await db
      .select()
      .from(practicePayerMap)
      .where(and(eq(practicePayerMap.id, id), eq(practicePayerMap.practiceId, practiceId)))
      .limit(1);
    if (!row) return res.status(404).json({ message: 'Mapping not found' });

    const stediPayerId =
      typeof b.stediPayerId === 'string' && b.stediPayerId.trim()
        ? b.stediPayerId.trim()
        : row.stediPayerId;
    const displayName =
      typeof b.displayName === 'string' && b.displayName.trim()
        ? b.displayName.trim()
        : row.displayName;

    const sanitizedSupport = sanitizeTransactionSupport(b.transactionSupport);
    const [updated] = await db
      .update(practicePayerMap)
      .set({
        stediPayerId,
        displayName,
        transactionSupport: sanitizedSupport ?? row.transactionSupport,
        status: 'confirmed',
        source: 'manual',
        confidence: '1.00',
        reviewedBy: req.user?.claims?.sub ?? null,
        updatedAt: new Date(),
      })
      .where(eq(practicePayerMap.id, id))
      .returning();

    // Seed enrollment-tracker rows (guarded: only insert the ones not already
    // present, since the payerEnrollments unique index isn't a DB constraint).
    if (updated.stediPayerId) {
      const payerName = updated.displayName || updated.rawName;
      const existing = await db
        .select({ transactionType: payerEnrollments.transactionType })
        .from(payerEnrollments)
        .where(
          and(
            eq(payerEnrollments.practiceId, practiceId),
            eq(payerEnrollments.payerName, payerName),
          ),
        );
      const have = new Set(existing.map((e: { transactionType: string }) => e.transactionType));
      const toAdd = (['eligibility', 'claims', 'era'] as const).filter((tt) => !have.has(tt));
      if (toAdd.length > 0) {
        await db.insert(payerEnrollments).values(
          toAdd.map((tt) => ({
            practiceId,
            payerName,
            payerId: updated.stediPayerId,
            transactionType: tt,
            status: 'not_enrolled' as const,
          })),
        );
      }
    }

    res.json({ ok: true, mapping: updated });
  } catch (error) {
    logger.error('Failed to confirm payer mapping', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to confirm payer mapping' });
  }
});

export default router;
