/**
 * Payer Enrollment Routes (Slice C)
 *
 * Exposes the payer enrollment status per practice. Each payer can have a
 * separate enrollment status for eligibility (270/271), claims (837P), and
 * ERAs (835). Practices need enrollment approval from each payer before
 * transactions will actually flow through for that payer.
 *
 * Endpoints:
 *   GET  /api/payer-enrollments        — list all payers + this practice's status per transaction type
 *   POST /api/payer-enrollments        — upsert enrollment (mark as requested, approved, rejected, or reset)
 *   PATCH /api/payer-enrollments/:id   — update notes / rejection reason
 */

import { Router, type Response } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import { db } from '../db';
import { payerEnrollments } from '@shared/schema';
import { and, eq } from 'drizzle-orm';

const router = Router();

const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  return req.userPracticeId ?? 1;
};

/**
 * Known-payer catalog. Source of truth for which payers appear on the
 * Payer Enrollments page. Mirrors the PAYER_IDS map in stediService +
 * a few additions we know Stedi supports but we haven't added to the
 * trading-partner map yet. Add to this list as new payers come online.
 *
 * `requiresEnrollment` flags per transaction type help the UI warn
 * practices which payers they'll need to sign forms for vs. which
 * payers let them submit immediately.
 */
const KNOWN_PAYERS: Array<{
  name: string;
  payerId: string;
  requiresEnrollment: { eligibility: boolean; claims: boolean; era: boolean };
}> = [
  { name: 'Aetna', payerId: '60054', requiresEnrollment: { eligibility: false, claims: false, era: true } },
  { name: 'Blue Cross Blue Shield', payerId: 'BCBS_FED', requiresEnrollment: { eligibility: false, claims: true, era: true } },
  { name: 'UnitedHealthcare', payerId: '87726', requiresEnrollment: { eligibility: false, claims: false, era: true } },
  { name: 'Cigna', payerId: '62308', requiresEnrollment: { eligibility: false, claims: true, era: true } },
  { name: 'Humana', payerId: '61101', requiresEnrollment: { eligibility: false, claims: true, era: true } },
  { name: 'Kaiser Permanente', payerId: '94135', requiresEnrollment: { eligibility: true, claims: true, era: true } },
  { name: 'Medicare', payerId: '00430', requiresEnrollment: { eligibility: true, claims: true, era: true } },
  { name: 'Medicaid', payerId: 'MEDICAID', requiresEnrollment: { eligibility: true, claims: true, era: true } },
  { name: 'Anthem BCBS', payerId: 'ANTHEM', requiresEnrollment: { eligibility: false, claims: true, era: true } },
  { name: 'Horizon BCBS NJ', payerId: 'HORIZON_NJ', requiresEnrollment: { eligibility: false, claims: true, era: true } },
  { name: 'TRICARE', payerId: 'TRICARE', requiresEnrollment: { eligibility: true, claims: true, era: true } },
];

const TRANSACTION_TYPES = ['eligibility', 'claims', 'era'] as const;
type TransactionType = (typeof TRANSACTION_TYPES)[number];

// GET /api/payer-enrollments — catalog + statuses merged
router.get('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);

    // Fetch all enrollment rows for this practice.
    const rows = await db
      .select()
      .from(payerEnrollments)
      .where(eq(payerEnrollments.practiceId, practiceId));

    // Index by (payerName, transactionType) for O(1) merge.
    const byKey = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      byKey.set(`${r.payerName}::${r.transactionType}`, r);
    }

    const payload = KNOWN_PAYERS.map((p) => ({
      name: p.name,
      payerId: p.payerId,
      enrollments: TRANSACTION_TYPES.map((tx) => {
        const row = byKey.get(`${p.name}::${tx}`);
        return {
          transactionType: tx,
          status: row?.status ?? 'not_enrolled',
          requiresEnrollment: p.requiresEnrollment[tx],
          requestedAt: row?.requestedAt ?? null,
          approvedAt: row?.approvedAt ?? null,
          rejectedAt: row?.rejectedAt ?? null,
          rejectionReason: row?.rejectionReason ?? null,
          notes: row?.notes ?? null,
          id: row?.id ?? null,
        };
      }),
    }));

    res.json(payload);
  } catch (error) {
    logger.error('Failed to fetch payer enrollments', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to fetch payer enrollments' });
  }
});

// POST /api/payer-enrollments — upsert by (practice, payerName, txType)
router.post('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { payerName, payerId, transactionType, status, notes, rejectionReason } = req.body || {};

    if (!payerName || typeof payerName !== 'string') {
      return res.status(400).json({ message: 'payerName is required' });
    }
    if (!TRANSACTION_TYPES.includes(transactionType)) {
      return res.status(400).json({ message: `transactionType must be one of: ${TRANSACTION_TYPES.join(', ')}` });
    }
    const validStatuses = ['not_enrolled', 'pending', 'enrolled', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${validStatuses.join(', ')}` });
    }

    // Timestamp fields based on status transition.
    const now = new Date();
    const statusStamps: Record<string, any> = {};
    if (status === 'pending') statusStamps.requestedAt = now;
    if (status === 'enrolled') statusStamps.approvedAt = now;
    if (status === 'rejected') statusStamps.rejectedAt = now;

    // Look for existing row.
    const [existing] = await db
      .select()
      .from(payerEnrollments)
      .where(
        and(
          eq(payerEnrollments.practiceId, practiceId),
          eq(payerEnrollments.payerName, payerName),
          eq(payerEnrollments.transactionType, transactionType)
        )
      )
      .limit(1);

    let row;
    if (existing) {
      const [updated] = await db
        .update(payerEnrollments)
        .set({
          status,
          payerId: payerId ?? existing.payerId,
          notes: notes ?? existing.notes,
          rejectionReason: rejectionReason ?? existing.rejectionReason,
          ...statusStamps,
          updatedAt: now,
        })
        .where(eq(payerEnrollments.id, existing.id))
        .returning();
      row = updated;
    } else {
      const [inserted] = await db
        .insert(payerEnrollments)
        .values({
          practiceId,
          payerName,
          payerId: payerId ?? null,
          transactionType,
          status,
          notes: notes ?? null,
          rejectionReason: rejectionReason ?? null,
          ...statusStamps,
        })
        .returning();
      row = inserted;
    }

    res.json(row);
  } catch (error) {
    logger.error('Failed to upsert payer enrollment', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to save enrollment' });
  }
});

export default router;
