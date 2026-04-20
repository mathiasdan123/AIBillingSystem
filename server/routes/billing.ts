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
 * - POST /api/billing/create-checkout-session - Create Stripe Checkout for subscription
 * - GET /api/billing/subscription - Get current subscription details
 * - POST /api/billing/cancel-subscription - Cancel subscription at period end
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
      || stripeService.PRICING_PLANS.starter;

    res.json({
      plan: practice.billingPlan || 'starter',
      planName: plan.name,
      monthlyPrice: plan.monthlyPriceCents / 100,
      annualPrice: plan.annualPriceCents / 100,
      billingEnginePercentage: stripeService.BILLING_ENGINE_PERCENTAGE,
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

// ─── Subscription Checkout & Management ──────────────────────────────────────

// Create Stripe Checkout Session for subscribing to a plan
router.post('/billing/create-checkout-session', isAuthenticated, async (req: any, res) => {
  try {
    if (!stripeService.isStripeConfigured()) {
      return res.status(503).json({
        message: 'Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.',
      });
    }

    const { planId, interval = 'month' } = req.body;

    // Validate planId
    const validPlans: Array<stripeService.PlanId> = ['starter', 'professional', 'practice'];
    if (!validPlans.includes(planId)) {
      return res.status(400).json({ message: 'Invalid plan ID. Must be starter, professional, or practice.' });
    }

    // Validate interval
    const validIntervals: Array<stripeService.BillingInterval> = ['month', 'year'];
    if (!validIntervals.includes(interval)) {
      return res.status(400).json({ message: 'Invalid interval. Must be month or year.' });
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

    // Save customer ID if new
    if (!practice.stripeCustomerId) {
      await storage.updatePractice(practiceId, { stripeCustomerId: customer.id });
    }

    // Look up or create the Stripe Price
    const priceId = await stripeService.getOrCreatePrice(planId as stripeService.PlanId, interval as stripeService.BillingInterval);

    // Build success/cancel URLs
    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'http://localhost:5000';
    const successUrl = `${origin}/settings?subscription=success`;
    const cancelUrl = `${origin}/subscription`;

    // Create the checkout session
    const session = await stripeService.createCheckoutSession({
      customerId: customer.id,
      priceId,
      practiceId,
      planId,
      successUrl,
      cancelUrl,
    });

    logger.info('Checkout session created', { practiceId, planId, interval, sessionId: session.id });
    res.json({ url: session.url });
  } catch (error) {
    logger.error('Error creating checkout session', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create checkout session' });
  }
});

// Get current subscription details
router.get('/billing/subscription', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const practice = await storage.getPractice(practiceId);

    if (!practice) {
      return res.status(404).json({ message: 'Practice not found' });
    }

    const currentPlanKey = (practice.billingPlan || 'starter') as keyof typeof stripeService.PRICING_PLANS;
    const plan = stripeService.PRICING_PLANS[currentPlanKey] || stripeService.PRICING_PLANS.starter;

    // Base response without active subscription
    const response: Record<string, any> = {
      plan: currentPlanKey,
      planName: plan.name,
      monthlyPrice: plan.monthlyPriceCents / 100,
      annualPrice: plan.annualPriceCents / 100,
      billingInterval: practice.billingInterval || 'monthly',
      hasSubscription: false,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      status: null,
    };

    // If there's an active Stripe subscription, fetch its details
    if (practice.stripeSubscriptionId && stripeService.isStripeConfigured()) {
      try {
        const subscription = await stripeService.getSubscription(practice.stripeSubscriptionId);
        response.hasSubscription = true;
        response.status = subscription.status;
        response.cancelAtPeriodEnd = subscription.cancel_at_period_end;
        // current_period_end lives on subscription items in newer Stripe API versions
        const periodEnd = subscription.items.data[0]?.current_period_end;
        if (periodEnd) {
          response.currentPeriodEnd = new Date(periodEnd * 1000).toISOString();
        }
      } catch (err) {
        // Subscription may have been deleted — just return without it
        logger.warn('Could not retrieve subscription', {
          practiceId,
          subscriptionId: practice.stripeSubscriptionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    res.json(response);
  } catch (error) {
    logger.error('Error getting subscription', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to get subscription details' });
  }
});

// Cancel subscription at end of billing period
router.post('/billing/cancel-subscription', isAuthenticated, async (req: any, res) => {
  try {
    if (!stripeService.isStripeConfigured()) {
      return res.status(503).json({ message: 'Stripe is not configured.' });
    }

    const practiceId = getAuthorizedPracticeId(req);
    const practice = await storage.getPractice(practiceId);

    if (!practice) {
      return res.status(404).json({ message: 'Practice not found' });
    }

    if (!practice.stripeSubscriptionId) {
      return res.status(400).json({ message: 'No active subscription to cancel' });
    }

    const subscription = await stripeService.cancelSubscriptionAtPeriodEnd(practice.stripeSubscriptionId);
    const periodEnd = subscription.items.data[0]?.current_period_end;
    const periodEndISO = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

    logger.info('Subscription set to cancel at period end', {
      practiceId,
      subscriptionId: subscription.id,
      cancelAt: periodEndISO,
    });

    res.json({
      success: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: periodEndISO,
    });
  } catch (error) {
    logger.error('Error cancelling subscription', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to cancel subscription' });
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

          // Copay-specific reconciliation: when a PaymentIntent tagged
          // type='copay' with an appointmentId succeeds, mark that
          // appointment as collected. The charge endpoint already writes
          // this synchronously; the webhook is a belt-and-suspenders
          // reconciliation for the cases where confirm returned `pending`
          // (e.g. 3DS / manual capture paths that land later).
          if (metadata.type === 'copay' && metadata.appointmentId) {
            try {
              const appointmentId = parseInt(metadata.appointmentId);
              if (!isNaN(appointmentId)) {
                await storage.updateAppointment(appointmentId, {
                  copayStatus: 'collected',
                  copayCollected: (paymentIntent.amount / 100).toFixed(2),
                  copayStripeChargeId: paymentIntent.id,
                  copayUpdatedAt: new Date(),
                } as any);
                logger.info('Copay marked collected via webhook', {
                  appointmentId,
                  paymentIntentId: paymentIntent.id,
                });
              }
            } catch (err) {
              logger.error('Failed to reconcile copay via webhook', {
                error: err instanceof Error ? err.message : String(err),
                paymentIntentId: paymentIntent.id,
              });
            }
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

          // Copay-specific: mark the appointment as failed so the pill
          // shows "amber / owes" and receptionist knows to follow up.
          if (failedMetadata.type === 'copay' && failedMetadata.appointmentId) {
            try {
              const appointmentId = parseInt(failedMetadata.appointmentId);
              if (!isNaN(appointmentId)) {
                await storage.updateAppointment(appointmentId, {
                  copayStatus: 'failed',
                  copayStripeChargeId: failedPayment.id,
                  copayNote: (failedPayment.last_payment_error?.message || 'Charge failed').slice(0, 500),
                  copayUpdatedAt: new Date(),
                } as any);
                logger.info('Copay marked failed via webhook', {
                  appointmentId,
                  paymentIntentId: failedPayment.id,
                });
              }
            } catch (err) {
              logger.error('Failed to reconcile failed copay via webhook', {
                error: err instanceof Error ? err.message : String(err),
                paymentIntentId: failedPayment.id,
              });
            }
          }
          break;

        case 'setup_intent.succeeded': {
          const setupIntent = event.data.object as any;
          logger.info('Setup intent succeeded', { setupIntentId: setupIntent.id });
          // Payment method saved
          break;
        }

        case 'checkout.session.completed': {
          const session = event.data.object as any;
          if (session.mode === 'subscription') {
            const sessionMeta = session.metadata || {};
            const sessionPracticeId = parseInt(sessionMeta.practiceId);
            const sessionPlanId = sessionMeta.planId;
            const subscriptionId = session.subscription;

            if (sessionPracticeId && sessionPlanId && subscriptionId) {
              const intervalLabel = session.metadata?.interval || 'monthly';
              await storage.updatePractice(sessionPracticeId, {
                billingPlan: sessionPlanId,
                stripeSubscriptionId: subscriptionId,
                stripeCustomerId: session.customer,
                billingInterval: intervalLabel,
              } as any);
              logger.info('Practice subscription activated via checkout', {
                practiceId: sessionPracticeId,
                planId: sessionPlanId,
                subscriptionId,
              });
            } else {
              logger.warn('Checkout session completed but missing metadata', {
                sessionId: session.id,
                metadata: sessionMeta,
              });
            }
          }
          break;
        }

        case 'customer.subscription.updated': {
          const updatedSub = event.data.object as any;
          const subMeta = updatedSub.metadata || {};
          const subPracticeId = parseInt(subMeta.practiceId);

          if (subPracticeId) {
            const planId = subMeta.planId;
            const updates: Record<string, any> = {};
            if (planId) {
              updates.billingPlan = planId;
            }
            if (Object.keys(updates).length > 0) {
              await storage.updatePractice(subPracticeId, updates as any);
              logger.info('Practice subscription updated', {
                practiceId: subPracticeId,
                planId,
                subscriptionId: updatedSub.id,
                status: updatedSub.status,
              });
            }
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const deletedSub = event.data.object as any;
          const deletedMeta = deletedSub.metadata || {};
          const deletedPracticeId = parseInt(deletedMeta.practiceId);

          if (deletedPracticeId) {
            await storage.updatePractice(deletedPracticeId, {
              billingPlan: 'starter',
              stripeSubscriptionId: null,
            } as any);
            logger.info('Practice subscription cancelled/deleted, downgraded to starter', {
              practiceId: deletedPracticeId,
              subscriptionId: deletedSub.id,
            });
          }
          break;
        }

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

// ─── Admin: Create Stripe Products (one-time setup) ─────────────────────────

router.post('/admin/stripe/create-products', isAuthenticated, async (req: any, res) => {
  try {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    if (!stripeService.isStripeConfigured()) {
      return res.status(400).json({ message: 'Stripe is not configured' });
    }

    const result = await stripeService.createStripePricingCatalog();
    logger.info('Stripe pricing catalog created', { products: result.products, prices: result.prices });
    res.json(result);
  } catch (error) {
    logger.error('Error creating Stripe pricing catalog', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to create Stripe products' });
  }
});

export default router;
