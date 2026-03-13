/**
 * Payment Routes
 *
 * Handles:
 * - /api/payment-settings - Practice payment settings
 * - /api/payment-methods/* - Payment method CRUD
 * - /api/payment-transactions/* - Payment transactions CRUD, refund
 * - /api/payment-plans/* - Payment plans CRUD, cancel, installments
 * - /api/installments/* - Installment pay, upcoming, overdue
 */

import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

const router = Router();

const isAdminOrBilling = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(req.user.claims.sub);
    if (!user || (user.role !== 'admin' && user.role !== 'billing')) {
      return res.status(403).json({ message: "Access denied. Admin or billing role required." });
    }
    next();
  } catch (error) {
    logger.error("Error checking user role", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to verify permissions" });
  }
};

const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
  if (userRole === 'admin') return requestedPracticeId || userPracticeId || 1;
  if (!userPracticeId) throw new Error('User not assigned to a practice.');
  if (requestedPracticeId && requestedPracticeId !== userPracticeId) return userPracticeId;
  return requestedPracticeId || userPracticeId;
};

// ==================== PAYMENT SETTINGS ====================

router.get('/payment-settings', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const settings = await storage.getPracticePaymentSettings(practiceId);
    res.json(settings || {
      practiceId, acceptsCreditCards: false, acceptsAch: false,
      autoChargeOnFile: false, paymentDueDays: 30,
    });
  } catch (error) {
    logger.error('Error fetching payment settings', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch payment settings' });
  }
});

router.put('/payment-settings', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const settings = await storage.upsertPracticePaymentSettings(req.body);
    res.json(settings);
  } catch (error) {
    logger.error('Error updating payment settings', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update payment settings' });
  }
});

// ==================== PAYMENT METHODS ====================

router.patch('/payment-methods/:id', isAuthenticated, async (req: any, res) => {
  try {
    const method = await storage.updatePatientPaymentMethod(parseInt(req.params.id), req.body);
    if (!method) return res.status(404).json({ message: 'Payment method not found' });
    res.json(method);
  } catch (error) {
    logger.error('Error updating payment method', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update payment method' });
  }
});

router.post('/payment-methods/:id/set-default', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const existingMethod = await storage.getPatientPaymentMethod(id);
    if (!existingMethod) return res.status(404).json({ message: 'Payment method not found' });
    const method = await storage.setDefaultPaymentMethod(id, existingMethod.patientId);
    res.json(method);
  } catch (error) {
    logger.error('Error setting default payment method', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to set default payment method' });
  }
});

router.delete('/payment-methods/:id', isAuthenticated, async (req: any, res) => {
  try {
    await storage.deletePatientPaymentMethod(parseInt(req.params.id));
    res.json({ message: 'Payment method deleted' });
  } catch (error) {
    logger.error('Error deleting payment method', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete payment method' });
  }
});

// ==================== PAYMENT TRANSACTIONS ====================

router.get('/payment-transactions', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
      status: req.query.status as string | undefined,
      type: req.query.type as string | undefined,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    };
    const transactions = await storage.getPaymentTransactions(practiceId, filters);
    res.json(transactions);
  } catch (error) {
    logger.error('Error fetching payment transactions', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch payment transactions' });
  }
});

router.get('/payment-transactions/stats', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const stats = await storage.getPaymentStats(practiceId, startDate, endDate);
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching payment stats', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch payment stats' });
  }
});

router.get('/payment-transactions/:id', isAuthenticated, async (req: any, res) => {
  try {
    const transaction = await storage.getPaymentTransaction(parseInt(req.params.id));
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    res.json(transaction);
  } catch (error) {
    logger.error('Error fetching payment transaction', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch transaction' });
  }
});

router.post('/payment-transactions', isAuthenticated, async (req: any, res) => {
  try {
    const transaction = await storage.createPaymentTransaction(req.body);
    await storage.createAuditLog({
      userId: req.user?.claims?.sub || 'system',
      eventType: 'write', eventCategory: 'payment',
      resourceType: 'payment_transaction',
      resourceId: transaction.id.toString(),
      practiceId: transaction.practiceId,
      ipAddress: req.ip || '0.0.0.0',
      details: { amount: transaction.amount, type: transaction.type, patientId: transaction.patientId },
    });
    res.status(201).json(transaction);
  } catch (error) {
    logger.error('Error creating payment transaction', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create payment transaction' });
  }
});

router.patch('/payment-transactions/:id', isAuthenticated, async (req: any, res) => {
  try {
    const transaction = await storage.updatePaymentTransaction(parseInt(req.params.id), req.body);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    res.json(transaction);
  } catch (error) {
    logger.error('Error updating payment transaction', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update transaction' });
  }
});

router.post('/payment-transactions/:id/refund', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const { amount, reason } = req.body;

    const original = await storage.getPaymentTransaction(id);
    if (!original) return res.status(404).json({ message: 'Transaction not found' });
    if (original.status !== 'completed') return res.status(400).json({ message: 'Can only refund completed transactions' });

    const refundAmount = amount ? parseFloat(amount) : parseFloat(original.amount);
    const refund = await storage.createPaymentTransaction({
      practiceId: original.practiceId, patientId: original.patientId,
      claimId: original.claimId, paymentMethodId: original.paymentMethodId,
      amount: (-refundAmount).toString(), type: 'refund',
      processor: original.processor, status: 'completed',
      description: reason || `Refund for transaction #${id}`,
      processedAt: new Date(),
    });

    await storage.updatePaymentTransaction(id, { status: 'refunded' });
    res.json(refund);
  } catch (error) {
    logger.error('Error refunding transaction', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to refund transaction' });
  }
});

// ==================== PAYMENT PLANS ====================

router.get('/payment-plans', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
      status: req.query.status as string | undefined,
    };
    const plans = await storage.getPaymentPlans(practiceId, filters);
    res.json(plans);
  } catch (error) {
    logger.error('Error fetching payment plans', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch payment plans' });
  }
});

router.get('/payment-plans/:id', isAuthenticated, async (req: any, res) => {
  try {
    const planDetails = await storage.getPaymentPlanWithInstallments(parseInt(req.params.id));
    if (!planDetails) return res.status(404).json({ message: 'Payment plan not found' });
    res.json(planDetails);
  } catch (error) {
    logger.error('Error fetching payment plan', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch payment plan' });
  }
});

router.post('/payment-plans', isAuthenticated, async (req: any, res) => {
  try {
    const { numberOfInstallments, ...planData } = req.body;
    const plan = await storage.createPaymentPlan(planData);

    if (numberOfInstallments && numberOfInstallments > 0) {
      const totalAmount = parseFloat(planData.totalAmount);
      const installmentAmount = (totalAmount / numberOfInstallments).toFixed(2);
      const startDate = new Date(planData.startDate || Date.now());

      for (let i = 0; i < numberOfInstallments; i++) {
        const dueDate = new Date(startDate);
        if (planData.frequency === 'weekly') {
          dueDate.setDate(dueDate.getDate() + (i * 7));
        } else if (planData.frequency === 'bi-weekly') {
          dueDate.setDate(dueDate.getDate() + (i * 14));
        } else {
          dueDate.setMonth(dueDate.getMonth() + i);
        }

        await storage.createPaymentPlanInstallment({
          paymentPlanId: plan.id,
          installmentNumber: i + 1,
          amount: installmentAmount,
          dueDate: dueDate.toISOString().split('T')[0],
          status: 'scheduled',
        });
      }
    }

    const planWithInstallments = await storage.getPaymentPlanWithInstallments(plan.id);
    res.status(201).json(planWithInstallments);
  } catch (error) {
    logger.error('Error creating payment plan', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create payment plan' });
  }
});

router.patch('/payment-plans/:id', isAuthenticated, async (req: any, res) => {
  try {
    const plan = await storage.updatePaymentPlan(parseInt(req.params.id), req.body);
    if (!plan) return res.status(404).json({ message: 'Payment plan not found' });
    res.json(plan);
  } catch (error) {
    logger.error('Error updating payment plan', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update payment plan' });
  }
});

router.post('/payment-plans/:id/cancel', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const { reason } = req.body;
    const plan = await storage.updatePaymentPlan(parseInt(req.params.id), {
      status: 'cancelled', pausedAt: new Date(), pauseReason: reason || 'Cancelled by user',
    });
    if (!plan) return res.status(404).json({ message: 'Payment plan not found' });
    res.json(plan);
  } catch (error) {
    logger.error('Error cancelling payment plan', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to cancel payment plan' });
  }
});

// ==================== PAYMENT PLAN INSTALLMENTS ====================

router.get('/payment-plans/:id/installments', isAuthenticated, async (req: any, res) => {
  try {
    const installments = await storage.getPaymentPlanInstallments(parseInt(req.params.id));
    res.json(installments);
  } catch (error) {
    logger.error('Error fetching installments', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch installments' });
  }
});

router.post('/installments/:id/pay', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const { paymentMethodId } = req.body;

    const installment = await storage.getPaymentPlanInstallment(id);
    if (!installment) return res.status(404).json({ message: 'Installment not found' });
    if (installment.status === 'paid') return res.status(400).json({ message: 'Installment already paid' });

    const plan = await storage.getPaymentPlan(installment.paymentPlanId);
    if (!plan) return res.status(404).json({ message: 'Payment plan not found' });

    const transaction = await storage.createPaymentTransaction({
      practiceId: plan.practiceId, patientId: plan.patientId,
      paymentMethodId, amount: installment.amount,
      type: 'payment', status: 'completed', processedAt: new Date(),
      description: `Payment plan installment #${installment.installmentNumber}`,
    });

    const updated = await storage.updatePaymentPlanInstallment(id, {
      status: 'paid', paidAt: new Date(), transactionId: transaction.id,
    });

    const installmentAmt = parseFloat(installment.amount);
    const newRemainingAmount = parseFloat(plan.remainingAmount) - installmentAmt;
    const newCompletedInstallments = (plan.completedInstallments || 0) + 1;
    const planStatus = newRemainingAmount <= 0 ? 'completed' : 'active';
    await storage.updatePaymentPlan(plan.id, {
      remainingAmount: newRemainingAmount.toFixed(2),
      completedInstallments: newCompletedInstallments,
      status: planStatus,
    });

    res.json({ installment: updated, transaction });
  } catch (error) {
    logger.error('Error paying installment', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to pay installment' });
  }
});

router.get('/installments/upcoming', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const days = parseInt(req.query.days as string) || 7;
    const upcoming = await storage.getUpcomingInstallments(practiceId, days);
    res.json(upcoming);
  } catch (error) {
    logger.error('Error fetching upcoming installments', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch upcoming installments' });
  }
});

router.get('/installments/overdue', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const overdue = await storage.getOverdueInstallments(practiceId);
    res.json(overdue);
  } catch (error) {
    logger.error('Error fetching overdue installments', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch overdue installments' });
  }
});

export default router;
