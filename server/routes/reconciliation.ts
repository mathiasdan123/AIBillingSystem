/**
 * Deposit Reconciliation Routes (Plaid three-way match)
 *
 * Financial-role gated (mounted under the requireFinancialRole prefix):
 * - POST  /api/reconciliation/link-token      - Start Plaid Link for the practice
 * - POST  /api/reconciliation/exchange        - Complete Link (store item, initial sync)
 * - GET   /api/reconciliation/items           - Connected banks for the practice
 * - POST  /api/reconciliation/run             - Run matching now
 * - GET   /api/reconciliation/exceptions      - Billing-team work queue
 * - PATCH /api/reconciliation/exceptions/:id  - Claim/resolve an exception
 * - GET   /api/reconciliation/statement       - Remitted vs deposited for a period
 *
 * Public (signature-verified, mounted separately with a raw body parser):
 * - POST  /api/plaid/webhook                  - Plaid sync/item webhooks
 */
import { Router, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { isAuthenticated } from '../replitAuth';
import { db } from '../db';
import { bankAccounts, bankItems, depositExceptions, type DepositException } from '@shared/schema';
import {
  createLinkToken,
  exchangePublicToken,
  isPlaidConfigured,
  markItemLoginRequired,
  syncItem,
  verifyPlaidWebhook,
} from '../services/reconciliation/plaidService';
import { depositStatement, reconcilePractice } from '../services/reconciliation/reconciliationService';
import logger from '../services/logger';

const router = Router();

const safeErrorResponse = (res: Response, statusCode: number, publicMessage: string, error?: any) => {
  if (error) {
    logger.error(publicMessage, { error: error instanceof Error ? error.message : String(error) });
  }
  return res.status(statusCode).json({ message: publicMessage });
};

const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  if (!userPracticeId) {
    throw new Error('User not assigned to a practice. Contact administrator.');
  }
  return userPracticeId;
};

const today = () => new Date().toISOString().slice(0, 10);

router.post('/link-token', isAuthenticated, async (req: any, res) => {
  try {
    if (!isPlaidConfigured()) {
      return res.status(503).json({ message: 'Bank connections are not configured yet.' });
    }
    const practiceId = getAuthorizedPracticeId(req);
    const linkToken = await createLinkToken(practiceId);
    res.json({ linkToken });
  } catch (error) {
    safeErrorResponse(res, 500, 'Could not start the bank connection. Please try again.', error);
  }
});

router.post('/exchange', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { publicToken } = req.body ?? {};
    if (!publicToken) return res.status(400).json({ message: 'publicToken is required' });
    const result = await exchangePublicToken(practiceId, publicToken);
    res.json(result);
  } catch (error) {
    safeErrorResponse(res, 500, 'Bank connection failed. Please try again.', error);
  }
});

router.get('/items', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const items = await db.select().from(bankItems).where(eq(bankItems.practiceId, practiceId));
    const result = [];
    for (const item of items) {
      const accounts = await db
        .select({ name: bankAccounts.name, mask: bankAccounts.mask, subtype: bankAccounts.subtype })
        .from(bankAccounts)
        .where(eq(bankAccounts.itemId, item.id));
      result.push({
        id: item.id,
        institutionName: item.institutionName,
        status: item.status,
        accounts,
      });
    }
    res.json(result);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to load connected banks', error);
  }
});

router.post('/run', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const result = await reconcilePractice(practiceId, today());
    res.json({ matches: result.matches.length, newExceptions: result.newExceptions });
  } catch (error) {
    safeErrorResponse(res, 500, 'Reconciliation run failed', error);
  }
});

router.get('/exceptions', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const rows: DepositException[] = await db
      .select()
      .from(depositExceptions)
      .where(and(eq(depositExceptions.practiceId, practiceId)))
      .orderBy(depositExceptions.openedAt);
    res.json(rows.filter((r: DepositException) => r.status !== 'resolved'));
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to load exceptions', error);
  }
});

router.patch('/exceptions/:id', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id, 10);
    const { status, assignee, notes } = req.body ?? {};
    if (status && !['open', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const [existing] = await db
      .select()
      .from(depositExceptions)
      .where(and(eq(depositExceptions.id, id), eq(depositExceptions.practiceId, practiceId)));
    if (!existing) return res.status(404).json({ message: 'Exception not found' });

    await db
      .update(depositExceptions)
      .set({
        status: status ?? existing.status,
        assignee: assignee ?? existing.assignee,
        notes: notes ?? existing.notes,
        resolvedAt: status === 'resolved' ? new Date() : existing.resolvedAt,
      })
      .where(eq(depositExceptions.id, id));
    res.json({ ok: true });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to update exception', error);
  }
});

router.get('/statement', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ message: 'from and to (YYYY-MM-DD) are required' });
    }
    res.json(await depositStatement(practiceId, from, to));
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to build deposit statement', error);
  }
});

export default router;

// ---- Plaid webhook (public path, signature-verified, raw body) ----

export const plaidWebhookRouter = Router();

plaidWebhookRouter.post('/webhook', async (req, res) => {
  try {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
    const verified = await verifyPlaidWebhook(req.header('plaid-verification'), rawBody);
    if (!verified) {
      logger.warn('Rejected Plaid webhook with invalid signature');
      return res.status(401).json({ message: 'Invalid webhook signature' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const { webhook_type, webhook_code, item_id } = payload;

    if (webhook_type === 'TRANSACTIONS' && webhook_code === 'SYNC_UPDATES_AVAILABLE') {
      await syncItem(item_id);
      const [item] = await db.select().from(bankItems).where(eq(bankItems.plaidItemId, item_id));
      if (item) await reconcilePractice(item.practiceId, new Date().toISOString().slice(0, 10));
    } else if (webhook_type === 'ITEM' && (webhook_code === 'ERROR' || webhook_code === 'LOGIN_REPAIRED')) {
      if (webhook_code === 'ERROR') await markItemLoginRequired(item_id);
      else await db.update(bankItems).set({ status: 'active' }).where(eq(bankItems.plaidItemId, item_id));
    }
    res.json({ ok: true });
  } catch (error) {
    logger.error('Plaid webhook handling failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Webhook handling failed' });
  }
});
