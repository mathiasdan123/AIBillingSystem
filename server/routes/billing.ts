/**
 * Billing Routes
 *
 * Handles:
 * - GET /api/billing/ar-aging - AR aging report for patient billing
 * - POST /api/billing/setup-intent - Create Stripe setup intent
 * - GET /api/billing/payment-methods - List payment methods
 * - POST /api/billing/set-default-payment-method - Set default payment method
 * - GET /api/billing/info - Get billing info for practice
 * - GET /api/billing/history - Get payment history
 * - POST /api/billing/patient-payment-link - Create patient payment link
 * - POST /api/webhooks/stripe - Stripe webhook handler
 *
 * Mounted at /api so all paths include their full prefix.
 */

import { Router } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import * as stripeService from '../services/stripeService';
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
    logger.warn(`Practice access restricted: User requested practice ${requestedPracticeId} but assigned to ${userPracticeId}`);
    return userPracticeId;
  }

  return requestedPracticeId || userPracticeId;
};

// AR aging report for patient billing (statement-based)
router.get('/billing/ar-aging', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const data = await storage.getPatientArAging(practiceId);
    res.json(data);
  } catch (error: any) {
    logger.error('Error fetching billing AR aging', { error: error?.message || String(error) });
    res.status(500).json({ message: 'Failed to fetch AR aging data' });
  }
});

// Get Stripe setup intent for adding payment method
router.post('/billing/setup-intent', isAuthenticated, async (req: any, res) => {
  try {
    if (!stripeService.isStripeConfigured()) {
      return res.status(503).json({
        message: 'Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.'
      });
    }

    const practiceId = getAuthorizedPracticeId(req);
    const practice = await storage.getPractice(practiceId);

    if (!practice) {
      return res.status(404).json({ message: 'Practice not found' });
    }

    // Get or create Stripe customer
    const customer = await stripeService.getOrCreateCustomer({
      id: practice.id,
      name: practice.name,
      email: practice.email || '',
      stripeCustomerId: practice.stripeCustomerId,
    });

    // Update practice with Stripe customer ID if new
    if (!practice.stripeCustomerId) {
      await storage.updatePractice(practiceId, { stripeCustomerId: customer.id });
    }

    // Create setup intent
    const setupIntent = await stripeService.createSetupIntent(customer.id);

    res.json({
      clientSecret: setupIntent.client_secret,
      customerId: customer.id,
    });
  } catch (error) {
    logger.error('Error creating setup intent', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create setup intent' });
  }
});

// List payment methods for a practice
router.get('/billing/payment-methods', isAuthenticated, async (req: any, res) => {
  try {
    if (!stripeService.isStripeConfigured()) {
      return res.json({ paymentMethods: [] });
    }

    const practiceId = getAuthorizedPracticeId(req);
    const practice = await storage.getPractice(practiceId);

    if (!practice?.stripeCustomerId) {
      return res.json({ paymentMethods: [] });
    }

    const paymentMethods = await stripeService.listPaymentMethods(practice.stripeCustomerId);
    res.json({ paymentMethods });
  } catch (error) {
    logger.error('Error listing payment methods', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to list payment methods' });
  }
});

// Set default payment method
router.post('/billing/set-default-payment-method', isAuthenticated, async (req: any, res) => {
  try {
    if (!stripeService.isStripeConfigured()) {
      return res.status(503).json({
        message: 'Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.'
      });
    }

    const { paymentMethodId } = req.body;
    const practiceId = getAuthorizedPracticeId(req);
    const practice = await storage.getPractice(practiceId);

    if (!practice?.stripeCustomerId) {
      return res.status(400).json({ message: 'No Stripe customer found' });
    }

    await stripeService.setDefaultPaymentMethod(practice.stripeCustomerId, paymentMethodId);
    await storage.updatePractice(practice.id, { stripePaymentMethodId: paymentMethodId });

    res.json({ success: true });
  } catch (error) {
    logger.error('Error setting default payment method', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to set default payment method' });
  }
});

// Get billing info for practice
router.get('/billing/info', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const practice = await storage.getPractice(practiceId);

    if (!practice) {
      return res.status(404).json({ message: 'Practice not found' });
    }

    const plan = stripeService.PRICING_PLANS[practice.billingPlan as keyof typeof stripeService.PRICING_PLANS]
      || stripeService.PRICING_PLANS.growing;

    res.json({
      plan: practice.billingPlan || 'growing',
      planName: plan.name,
      percentage: practice.billingPercentage || 4.5,
      features: plan.features,
      hasPaymentMethod: !!practice.stripePaymentMethodId,
      trialEndsAt: practice.trialEndsAt,
      isInTrial: practice.trialEndsAt ? new Date(practice.trialEndsAt) > new Date() : false,
    });
  } catch (error) {
    logger.error('Error getting billing info', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to get billing info' });
  }
});

// Get payment history
router.get('/billing/history', isAuthenticated, async (req: any, res) => {
  try {
    if (!stripeService.isStripeConfigured()) {
      return res.json({ payments: [] });
    }

    const practiceId = getAuthorizedPracticeId(req);
    const practice = await storage.getPractice(practiceId);

    if (!practice?.stripeCustomerId) {
      return res.json({ payments: [] });
    }

    const payments = await stripeService.getPaymentHistory(practice.stripeCustomerId, 20);
    res.json({
      payments: payments.map(p => ({
        id: p.id,
        amount: p.amount / 100, // Convert from cents
        status: p.status,
        description: p.description,
        created: new Date(p.created * 1000).toISOString(),
      })),
    });
  } catch (error) {
    logger.error('Error getting payment history', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to get payment history' });
  }
});

// Create patient payment link
router.post('/billing/patient-payment-link', isAuthenticated, async (req: any, res) => {
  try {
    if (!stripeService.isStripeConfigured()) {
      return res.status(503).json({
        message: 'Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.'
      });
    }

    const { patientId, amount, description } = req.body;
    const patient = await storage.getPatient(patientId);

    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const paymentLink = await stripeService.createPatientPaymentLink({
      amount: Math.round(amount * 100), // Convert to cents
      patientName: `${patient.firstName} ${patient.lastName}`,
      practiceId: patient.practiceId,
      patientId: patient.id,
      description: description || `Payment for ${patient.firstName} ${patient.lastName}`,
    });

    res.json({ url: paymentLink.url });
  } catch (error) {
    logger.error('Error creating payment link', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create payment link' });
  }
});

// Stripe webhook handler - requires raw body for signature verification
// Raw body is provided by express.raw() middleware in index.ts
router.post('/webhooks/stripe', async (req: any, res) => {
  if (!stripeService.isStripeConfigured()) {
    return res.status(503).json({ message: 'Stripe not configured' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig) {
    logger.warn('Stripe webhook received without signature');
    return res.status(400).json({ message: 'Missing stripe-signature header' });
  }

  if (!webhookSecret) {
    logger.error('Stripe webhook secret not configured');
    return res.status(500).json({ message: 'Webhook not configured' });
  }

  try {
    // req.body is a Buffer when using express.raw()
    const event = stripeService.verifyWebhookSignature(
      req.body,
      sig,
      webhookSecret
    );

    logger.info('Stripe webhook verified', { eventType: event.type, eventId: event.id });

    // Idempotency check: skip if this event was already processed
    const existingEvent = await storage.getWebhookEvent(event.id);
    if (existingEvent && existingEvent.status === 'processed') {
      logger.info('Webhook event already processed, skipping', { eventId: event.id });
      return res.json({ received: true, deduplicated: true });
    }

    // Record the event before processing (status: 'processing')
    if (!existingEvent) {
      await storage.createWebhookEvent(event.id, event.type, 'processing');
    }

    try {
      // Handle different event types
      switch (event.type) {
        case 'payment_intent.succeeded':
          const paymentIntent = event.data.object as any;
          logger.info('Payment succeeded', { paymentIntentId: paymentIntent.id });

          // Record payment in database
          const metadata = paymentIntent.metadata || {};
          const practiceId = parseInt(metadata.practiceId);

          if (practiceId) {
            const paymentRecord = {
              practiceId,
              patientId: metadata.patientId ? parseInt(metadata.patientId) : null,
              claimId: metadata.claimId ? parseInt(metadata.claimId) : null,
              amount: (paymentIntent.amount / 100).toFixed(2), // Convert from cents
              paymentMethod: metadata.type === 'patient_payment' ? 'patient' : 'practice',
              paymentType: metadata.type === 'monthly_fee' ? 'subscription' : 'patient_payment',
              paymentDate: new Date().toISOString().split('T')[0],
              transactionId: paymentIntent.id,
              referenceNumber: paymentIntent.latest_charge,
              notes: paymentIntent.description || `Stripe payment: ${metadata.type}`,
              status: 'completed',
            };

            await storage.createPayment(paymentRecord);
            logger.info('Payment recorded in database', {
              practiceId,
              paymentIntentId: paymentIntent.id,
              amount: paymentRecord.amount
            });
          } else {
            logger.warn('Payment succeeded but no practiceId in metadata', {
              paymentIntentId: paymentIntent.id
            });
          }
          break;

        case 'payment_intent.payment_failed':
          const failedPayment = event.data.object as any;
          logger.warn('Payment failed', {
            paymentId: failedPayment.id,
            failureCode: failedPayment.last_payment_error?.code,
            failureMessage: failedPayment.last_payment_error?.message,
          });

          // Record failed payment and notify practice
          const failedMetadata = failedPayment.metadata || {};
          const failedPracticeId = parseInt(failedMetadata.practiceId);

          if (failedPracticeId) {
            // Record the failed payment attempt
            const failedPaymentRecord = {
              practiceId: failedPracticeId,
              patientId: failedMetadata.patientId ? parseInt(failedMetadata.patientId) : null,
              claimId: failedMetadata.claimId ? parseInt(failedMetadata.claimId) : null,
              amount: (failedPayment.amount / 100).toFixed(2),
              paymentMethod: failedMetadata.type === 'patient_payment' ? 'patient' : 'practice',
              paymentType: failedMetadata.type === 'monthly_fee' ? 'subscription' : 'patient_payment',
              paymentDate: new Date().toISOString().split('T')[0],
              transactionId: failedPayment.id,
              notes: `FAILED: ${failedPayment.last_payment_error?.message || 'Payment failed'}`,
              status: 'failed',
            };

            await storage.createPayment(failedPaymentRecord);

            // Log notification (in production, would send email/SMS to practice admin)
            logger.warn('Practice notified of failed payment', {
              practiceId: failedPracticeId,
              paymentIntentId: failedPayment.id,
              failureReason: failedPayment.last_payment_error?.message,
            });
          }
          break;

        case 'setup_intent.succeeded':
          const setupIntent = event.data.object as any;
          logger.info('Setup intent succeeded', { setupIntentId: setupIntent.id });
          // Payment method saved
          break;

        default:
          logger.info('Unhandled event type', { eventType: event.type });
      }

      // Mark event as successfully processed
      await storage.updateWebhookEventStatus(event.id, 'processed');
      res.json({ received: true });
    } catch (processingError: any) {
      // Mark event as failed so it can be retried on next webhook delivery
      logger.error('Webhook event processing failed', {
        eventId: event.id,
        eventType: event.type,
        error: processingError.message,
      });
      await storage.updateWebhookEventStatus(event.id, 'failed');
      // Still return 200 to Stripe to avoid infinite retries for non-transient errors
      res.json({ received: true, processingFailed: true });
    }
  } catch (error: any) {
    logger.error('Stripe webhook verification failed', {
      error: error.message,
      type: error.type,
    });
    res.status(400).json({ message: 'Webhook signature verification failed' });
  }
});

export default router;
