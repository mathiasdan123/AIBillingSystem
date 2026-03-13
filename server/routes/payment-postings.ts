/**
 * Payment Posting Routes
 *
 * Handles:
 * - POST   /api/payment-postings                - Post a payment against a claim
 * - GET    /api/payment-postings/claim/:claimId  - Get payments for a claim
 * - GET    /api/payment-postings/summary         - Get payment summary for date range
 * - GET    /api/payment-postings/unposted        - Get claims awaiting payment posting
 * - GET    /api/payment-postings/daily            - Get daily posting summary
 * - POST   /api/payment-postings/:id/reverse     - Reverse a posted payment
 */

import { Router } from 'express';
import { isAuthenticated } from '../replitAuth';
import * as paymentPostingService from '../services/paymentPostingService';
import logger from '../services/logger';

const router = Router();

// Helper to get authorized practiceId from request
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) {
    return req.authorizedPracticeId;
  }

  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;

  if (userRole === 'admin') {
    return requestedPracticeId || userPracticeId || 1;
  }

  if (!userPracticeId) {
    throw new Error('User not assigned to a practice. Contact administrator.');
  }

  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    return userPracticeId;
  }

  return requestedPracticeId || userPracticeId;
};

/**
 * POST /api/payment-postings
 * Post a payment against a claim.
 */
router.post('/', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const userId = req.user?.claims?.sub;

    const posting = await paymentPostingService.postPayment(practiceId, {
      ...req.body,
      postedBy: userId,
    });

    res.status(201).json(posting);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to post payment';
    logger.error('Error posting payment', { error: message });
    res.status(400).json({ message });
  }
});

/**
 * GET /api/payment-postings/claim/:claimId
 * Get all payments for a specific claim.
 */
router.get('/claim/:claimId', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const claimId = parseInt(req.params.claimId, 10);

    if (isNaN(claimId)) {
      return res.status(400).json({ message: 'Invalid claim ID' });
    }

    const payments = await paymentPostingService.getPaymentsForClaim(claimId, practiceId);
    res.json(payments);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get payments';
    logger.error('Error getting payments for claim', { error: message });
    res.status(500).json({ message });
  }
});

/**
 * GET /api/payment-postings/summary
 * Get payment summary for a date range.
 * Query params: startDate, endDate
 */
router.get('/summary', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate are required' });
    }

    const summary = await paymentPostingService.getPaymentSummary(
      practiceId,
      new Date(startDate as string),
      new Date(endDate as string),
    );
    res.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get payment summary';
    logger.error('Error getting payment summary', { error: message });
    res.status(500).json({ message });
  }
});

/**
 * GET /api/payment-postings/unposted
 * Get claims in 'submitted' status older than 14 days.
 */
router.get('/unposted', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const claims = await paymentPostingService.getUnpostedClaims(practiceId);
    res.json(claims);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get unposted claims';
    logger.error('Error getting unposted claims', { error: message });
    res.status(500).json({ message });
  }
});

/**
 * GET /api/payment-postings/daily
 * Get daily posting summary.
 * Query param: date (defaults to today)
 */
router.get('/daily', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const dateStr = req.query.date as string;
    const date = dateStr ? new Date(dateStr) : new Date();

    const summary = await paymentPostingService.getDailyPostingSummary(practiceId, date);
    res.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get daily summary';
    logger.error('Error getting daily posting summary', { error: message });
    res.status(500).json({ message });
  }
});

/**
 * POST /api/payment-postings/:id/reverse
 * Reverse a posted payment.
 */
router.post('/:id/reverse', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const paymentId = parseInt(req.params.id, 10);

    if (isNaN(paymentId)) {
      return res.status(400).json({ message: 'Invalid payment ID' });
    }

    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ message: 'Reversal reason is required' });
    }

    const reversed = await paymentPostingService.reversePayment(paymentId, practiceId, reason);
    res.json(reversed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reverse payment';
    logger.error('Error reversing payment', { error: message });
    res.status(400).json({ message });
  }
});

export default router;
