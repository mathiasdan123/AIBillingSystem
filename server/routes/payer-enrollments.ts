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
    let previousStatus: string | null = null;
    if (existing) {
      previousStatus = existing.status;
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

    // Status-change email — notify practice admins when something
    // material happened. We skip noise transitions (anything → not_enrolled,
    // pending → pending) and only send on the four transitions that
    // change practice operational state. Best-effort: a failure here
    // never breaks the API write.
    try {
      if (previousStatus !== status) {
        const interesting = new Set(['enrolled', 'rejected']);
        const becameInteresting = interesting.has(status);
        const noLongerInteresting = previousStatus && interesting.has(previousStatus) && !interesting.has(status);
        if (becameInteresting || noLongerInteresting) {
          const { storage } = await import('../storage');
          const [admins, practice] = await Promise.all([
            storage.getAdminsByPractice(practiceId),
            storage.getPractice(practiceId),
          ]);
          const recipients = (admins ?? [])
            .map((a: any) => a.email)
            .filter((e: any) => typeof e === 'string' && e.length > 0);
          if (recipients.length > 0) {
            const { sendEmail } = await import('../services/emailService');
            const txLabel = transactionType === 'eligibility'
              ? 'Eligibility (270/271)'
              : transactionType === 'claims'
                ? 'Claim Submission (837P)'
                : 'ERA / Remittance (835)';
            const subject = `${payerName} · ${txLabel} → ${status} · ${practice?.name ?? 'Practice'}`;
            const html = `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
                <div style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;padding:20px;border-radius:12px 12px 0 0;">
                  <h2 style="margin:0;">Payer enrollment status changed</h2>
                  <p style="margin:4px 0 0 0;opacity:.9;">${practice?.name ?? 'Your practice'}</p>
                </div>
                <div style="background:white;padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
                  <table style="width:100%;font-size:14px;border-collapse:collapse;">
                    <tr><td style="padding:6px 0;color:#64748b;">Payer</td><td style="padding:6px 0;font-weight:600;">${payerName}</td></tr>
                    <tr><td style="padding:6px 0;color:#64748b;">Transaction type</td><td style="padding:6px 0;">${txLabel}</td></tr>
                    <tr><td style="padding:6px 0;color:#64748b;">Previous status</td><td style="padding:6px 0;">${previousStatus ?? '—'}</td></tr>
                    <tr><td style="padding:6px 0;color:#64748b;">New status</td><td style="padding:6px 0;font-weight:600;color:${status === 'enrolled' ? '#16a34a' : status === 'rejected' ? '#dc2626' : '#0f172a'};">${status}</td></tr>
                    ${rejectionReason ? `<tr><td style="padding:6px 0;color:#64748b;">Reason</td><td style="padding:6px 0;">${rejectionReason}</td></tr>` : ''}
                  </table>
                  <p style="margin:16px 0 0 0;font-size:13px;color:#475569;">
                    ${status === 'enrolled'
                      ? 'You can now submit ' + txLabel.toLowerCase() + ' transactions to this payer.'
                      : status === 'rejected'
                        ? 'This enrollment was rejected. Review the reason and resubmit if applicable.'
                        : 'Status has changed — see the Payer Enrollments page for details.'}
                  </p>
                </div>
                <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:12px;">
                  Automated alert from TherapyBill AI
                </p>
              </div>
            `;
            const text = [
              `Payer enrollment status changed`,
              ``,
              `Practice: ${practice?.name ?? 'Your practice'}`,
              `Payer: ${payerName}`,
              `Transaction: ${txLabel}`,
              `Previous: ${previousStatus ?? '—'}`,
              `New: ${status}`,
              rejectionReason ? `Reason: ${rejectionReason}` : '',
            ].filter(Boolean).join('\n');
            for (const email of recipients) {
              await sendEmail({
                to: email,
                subject,
                html,
                text,
                fromName: 'TherapyBill AI Alerts',
              });
            }
            logger.info('Payer enrollment status-change alert sent', {
              practiceId,
              payerName,
              transactionType,
              previousStatus,
              status,
              recipientCount: recipients.length,
            });
          }
        }
      }
    } catch (notifyErr: any) {
      logger.warn('Failed to send enrollment status-change alert', {
        error: notifyErr?.message ?? String(notifyErr),
      });
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
