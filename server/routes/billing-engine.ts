/**
 * Billing Engine admin routes (platform operator only).
 *
 * The percentage-of-collections fee is TherapyBill's own revenue, charged to
 * its customers — so these are gated to a platform admin, not to a practice
 * admin (who would otherwise be looking at, and re-running, their own bill).
 *
 * Endpoints (mounted at /api/billing-engine):
 *   GET  /periods?month=YYYY-MM-DD  — recorded periods (defaults to last month)
 *   POST /preview                   — dry run: compute the basis, touch no money
 *   POST /run                       — compute and DRAFT invoices for review
 */

import { Router, type Response, type NextFunction } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { billingEnginePeriods } from '@shared/schema';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import {
  runBillingEngineForMonth,
  previousMonth,
  monthStart,
} from '../services/billingEngineService';

const router = Router();

/** Platform operator only — this is TherapyBill's revenue, not a practice's. */
const isPlatformAdmin = (req: any, res: Response, next: NextFunction) => {
  if (!req.user?.claims?.sub) return res.status(401).json({ message: 'Unauthorized' });
  if (!req.isPlatformAdmin) {
    return res.status(403).json({ message: 'Platform administrator access required.' });
  }
  next();
};

function parseMonth(raw: unknown): Date {
  if (typeof raw === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(raw)) {
    const [y, m] = raw.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1));
  }
  return previousMonth(new Date());
}

router.get('/periods', isAuthenticated, isPlatformAdmin, async (req: any, res: Response) => {
  try {
    const month = monthStart(parseMonth(req.query.month));
    const rows = await db
      .select()
      .from(billingEnginePeriods)
      .where(eq(billingEnginePeriods.periodMonth, month))
      .orderBy(desc(billingEnginePeriods.feeCents));

    const totalFeeCents = rows.reduce((sum: number, r: any) => sum + (r.feeCents ?? 0), 0);
    const totalCollectionsCents = rows.reduce((sum: number, r: any) => sum + (r.collectionsCents ?? 0), 0);

    res.json({ periodMonth: month, totalCollectionsCents, totalFeeCents, rows });
  } catch (error) {
    logger.error('Failed to load billing engine periods', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to load billing engine periods' });
  }
});

/** Dry run — computes and records the basis, creates NO Stripe invoice. */
router.post('/preview', isAuthenticated, isPlatformAdmin, async (req: any, res: Response) => {
  try {
    const result = await runBillingEngineForMonth(parseMonth(req.body?.month), { dryRun: true });
    res.json({ dryRun: true, ...result });
  } catch (error) {
    logger.error('Billing engine preview failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Billing engine preview failed' });
  }
});

/** Real run — creates DRAFT invoices. Still requires a human to send them. */
router.post('/run', isAuthenticated, isPlatformAdmin, async (req: any, res: Response) => {
  try {
    const result = await runBillingEngineForMonth(parseMonth(req.body?.month));
    logger.info('Billing engine run triggered manually', {
      periodMonth: result.periodMonth,
      invoicesDrafted: result.invoicesDrafted,
      by: req.user?.claims?.sub,
    });
    res.json({ dryRun: false, ...result });
  } catch (error) {
    logger.error('Billing engine run failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Billing engine run failed' });
  }
});

export default router;
