/**
 * Expense Routes
 *
 * The /expenses page (client/src/pages/expenses.tsx + ExpenseTracker) has
 * called GET/POST /api/expenses since it was written, but no server route
 * ever existed — the page rendered permanently empty (the icd10-codes
 * failure mode; it sat in clientRoutesExist's KNOWN_MISSING ratchet).
 * The storage helpers were already there (server/storage/claims.ts), so this
 * wires the minimal route pair:
 *
 * - GET  /api/expenses — list the caller-practice's expenses
 * - POST /api/expenses — create an expense for the caller's practice
 *
 * Expenses are practice financials, so the /api/expenses prefix is gated
 * with requireFinancialRole in server/routes.ts (the nav entry was already
 * financial: true).
 */

import { Router } from 'express';
import { z } from 'zod';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

const router = Router();

// Same authorization helper pattern as the other routers.
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
  if (userRole === 'admin' && req.isPlatformAdmin) return requestedPracticeId || userPracticeId || 1;
  if (!userPracticeId) throw new Error('User not assigned to a practice. Contact administrator.');
  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    logger.warn(`Practice access restricted: User requested practice ${requestedPracticeId} but assigned to ${userPracticeId}`);
    return userPracticeId;
  }
  return requestedPracticeId || userPracticeId;
};

const createExpenseSchema = z.object({
  description: z.string().min(1).max(2000),
  amount: z.coerce.number().positive(),
  category: z.string().max(100).optional().nullable(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expenseDate must be YYYY-MM-DD'),
  isDeductible: z.boolean().optional(),
  receiptUrl: z.string().max(2000).optional().nullable(),
});

// GET /api/expenses — list expenses for the caller's practice
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const expenses = await storage.getExpenses(practiceId);
    res.json(expenses);
  } catch (error) {
    logger.error('Error fetching expenses', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch expenses' });
  }
});

// POST /api/expenses — create an expense for the caller's practice
router.post('/', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const parsed = createExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid expense data', errors: parsed.error.flatten() });
    }
    const data = parsed.data;
    const expense = await storage.createExpense({
      // Tenant + author come from the session, never the body.
      practiceId,
      createdBy: req.user?.claims?.sub ?? null,
      description: data.description,
      amount: data.amount.toFixed(2),
      category: data.category ?? null,
      expenseDate: data.expenseDate,
      isDeductible: data.isDeductible ?? true,
      receiptUrl: data.receiptUrl ?? null,
    });
    res.status(201).json(expense);
  } catch (error) {
    logger.error('Error creating expense', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create expense' });
  }
});

export default router;
