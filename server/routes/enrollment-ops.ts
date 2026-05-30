/**
 * Enrollment Ops Overview (Phase 4 — multi-practice enrollment, 2026-05-30).
 *
 * Cross-practice readiness rollup for operators: one row per practice with
 * billing-identity completeness, Stedi provider-record presence, enrollment
 * authorization, and per-transaction enrollment status counts. This is the
 * scale-time companion to the single-practice /api/admin/stedi-readiness
 * snapshot — it answers "which of our practices can transact, and what's
 * blocking the rest?" in one call.
 *
 * Read-only. Mounted at /api/admin/enrollment-overview.
 */

import { Router, type Response } from 'express';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';
import logger from '../services/logger';
import { db } from '../db';
import { payerEnrollments } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { isValidNpi } from '../services/npiValidation';

const router = Router();

const TX = ['eligibility', 'claims', 'era'] as const;
const STATUSES = ['not_enrolled', 'pending', 'enrolled', 'rejected'] as const;

function emptyCounts(): Record<string, Record<string, number>> {
  const c: Record<string, Record<string, number>> = {};
  for (const t of TX) {
    c[t] = {};
    for (const s of STATUSES) c[t][s] = 0;
  }
  return c;
}

// GET /api/admin/enrollment-overview
router.get('/', isAuthenticated, async (_req: any, res: Response) => {
  try {
    const practiceIds = await storage.getAllPracticeIds();
    const practices = await Promise.all(
      practiceIds.map(async (id) => {
        const [p, enrollments] = await Promise.all([
          storage.getPractice(id),
          db.select().from(payerEnrollments).where(eq(payerEnrollments.practiceId, id)),
        ]);

        const counts = emptyCounts();
        for (const e of enrollments) {
          const tx = e.transactionType as string;
          const st = e.status as string;
          if (counts[tx] && counts[tx][st] !== undefined) counts[tx][st]++;
        }

        const hasStructuredAddr =
          !!(p?.addressStreet && p?.addressCity && p?.addressState && p?.addressZip);
        const blockers: string[] = [];
        if (!p?.npi) blockers.push('no NPI');
        else if (!isValidNpi(p.npi)) blockers.push('invalid NPI');
        if (!p?.taxId) blockers.push('no Tax ID');
        if (!hasStructuredAddr && !p?.address) blockers.push('no address');
        if (!p?.enrollmentAuthorizedAt) blockers.push('not authorized');
        if (!p?.stediProviderId) blockers.push('no Stedi provider record');

        return {
          practiceId: id,
          name: p?.name ?? null,
          npiPresent: !!p?.npi,
          npiValid: isValidNpi(p?.npi),
          taxIdPresent: !!p?.taxId,
          addressComplete: hasStructuredAddr || !!p?.address,
          authorized: !!p?.enrollmentAuthorizedAt,
          hasStediProvider: !!p?.stediProviderId,
          enrollmentReady: blockers.length === 0,
          blockers,
          counts,
        };
      }),
    );

    const summary = {
      totalPractices: practices.length,
      enrollmentReady: practices.filter((p) => p.enrollmentReady).length,
      withStediProvider: practices.filter((p) => p.hasStediProvider).length,
      authorized: practices.filter((p) => p.authorized).length,
    };

    res.json({ summary, practices });
  } catch (error) {
    logger.error('Failed to build enrollment overview', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to build enrollment overview' });
  }
});

export default router;
