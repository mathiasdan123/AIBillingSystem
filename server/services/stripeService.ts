import Stripe from 'stripe';

// Initialize Stripe lazily to allow app to start without key
let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not configured');
    }
    stripe = new Stripe(apiKey, {
      apiVersion: '2025-08-27.basil',
    });
  }
  return stripe;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

// ─── Pricing Plans ──────────────────────────────────────────────────────────

export const PRICING_PLANS = {
  starter: {
    name: 'Starter',
    tagline: 'Solo OT practitioners',
    monthlyPriceCents: 9900, // $99
    annualPriceCents: 82500, // $825/yr
    maxProviders: 1,
    maxStaff: 1,
    additionalProviderCents: null as number | null,
    features: [
      '1 OT provider',
      '1 non-clinical staff',
      'AI SOAP notes',
      'Scheduling & online booking',
      'Patient & caregiver portal',
      'Treatment plans & goal tracking',
      'Basic analytics',
      'Email support',
    ],
  },
  professional: {
    name: 'Professional',
    tagline: 'Growing OT practices',
    monthlyPriceCents: 19900, // $199
    annualPriceCents: 165900, // $1,659/yr
    maxProviders: 5,
    maxStaff: 3,
    additionalProviderCents: 5900, // $59/mo each
    features: [
      'Up to 5 OTs ($59/mo each add\'l)',
      '3 non-clinical staff',
      'AI SOAP notes',
      'Scheduling & online booking',
      'Patient & caregiver portal',
      'Treatment plans & goal tracking',
      'Telehealth',
      'Full analytics & reporting',
      'Email + chat support',
    ],
  },
  practice: {
    name: 'Practice',
    tagline: 'Multi-therapist OT clinics',
    monthlyPriceCents: 39900, // $399
    annualPriceCents: 332500, // $3,325/yr
    maxProviders: 15,
    maxStaff: null as number | null, // unlimited
    additionalProviderCents: 4900, // $49/mo each
    features: [
      'Up to 15 OTs ($49/mo each add\'l)',
      'Unlimited non-clinical staff',
      'Everything in Professional, plus:',
      'AOTA industry benchmarking',
      'Custom report builder',
      'Priority support + onboarding call',
      'Priority data migration',
    ],
  },
};

/** AI Billing Engine: 6% of insurance collections */
export const BILLING_ENGINE_PERCENTAGE = 6;

/**
 * Create Stripe Products and Prices for the pricing catalog.
 * One-time setup — creates products and recurring prices.
 */
export async function createStripePricingCatalog(): Promise<{
  products: Record<string, string>;
  prices: Record<string, string>;
}> {
  const s = getStripe();
  const products: Record<string, string> = {};
  const prices: Record<string, string> = {};

  for (const [key, plan] of Object.entries(PRICING_PLANS)) {
    const product = await s.products.create({
      name: `TherapyBill AI \u2014 ${plan.name}`,
      description: plan.tagline,
      metadata: { planKey: key },
    });
    products[key] = product.id;

    // Monthly price
    const monthly = await s.prices.create({
      product: product.id,
      unit_amount: plan.monthlyPriceCents,
      currency: 'usd',
      recurring: { interval: 'month' },
      lookup_key: `therapybill-${key}-monthly`,
      metadata: { planKey: key, interval: 'monthly' },
    });
    prices[`${key}-monthly`] = monthly.id;

    // Annual price
    const annual = await s.prices.create({
      product: product.id,
      unit_amount: plan.annualPriceCents,
      currency: 'usd',
      recurring: { interval: 'year' },
      lookup_key: `therapybill-${key}-annual`,
      metadata: { planKey: key, interval: 'annual' },
    });
    prices[`${key}-annual`] = annual.id;
  }

  // Billing engine product (usage tracked manually, charged via PaymentIntent)
  const billingProduct = await s.products.create({
    name: 'TherapyBill AI \u2014 Billing Engine',
    description: '6% of insurance collections',
    metadata: { planKey: 'billing-engine' },
  });
  products['billing-engine'] = billingProduct.id;

  return { products, prices };
}

/**
 * Create a Stripe customer for a practice
 */
export async function createStripeCustomer(practice: {
  id: number;
  name: string;
  email: string;
  phone?: string;
}): Promise<Stripe.Customer> {
  const customer = await getStripe().customers.create({
    name: practice.name,
    email: practice.email,
    phone: practice.phone || undefined,
    metadata: {
      practiceId: practice.id.toString(),
    },
  });

  return customer;
}

/**
 * Create a setup intent for saving payment method
 */
export async function createSetupIntent(customerId: string): Promise<Stripe.SetupIntent> {
  const setupIntent = await getStripe().setupIntents.create({
    customer: customerId,
    payment_method_types: ['card', 'us_bank_account'],
    usage: 'off_session', // Allow charging later without customer present
  });

  return setupIntent;
}

/**
 * Get or create a Stripe customer for a practice
 */
export async function getOrCreateCustomer(practice: {
  id: number;
  name: string;
  email: string;
  stripeCustomerId?: string | null;
}): Promise<Stripe.Customer> {
  if (practice.stripeCustomerId) {
    try {
      const customer = await getStripe().customers.retrieve(practice.stripeCustomerId);
      if (!customer.deleted) {
        return customer as Stripe.Customer;
      }
    } catch (error) {
      // Customer not found, create new one
    }
  }

  return createStripeCustomer(practice);
}

/**
 * Charge a practice for their monthly billing (percentage of collections)
 */
export async function chargeMonthlyFee(params: {
  customerId: string;
  paymentMethodId: string;
  amount: number; // in cents
  description: string;
  practiceId: number;
  billingPeriod: string; // e.g., "2024-01"
}): Promise<Stripe.PaymentIntent> {
  const paymentIntent = await getStripe().paymentIntents.create({
    amount: params.amount,
    currency: 'usd',
    customer: params.customerId,
    payment_method: params.paymentMethodId,
    off_session: true,
    confirm: true,
    description: params.description,
    metadata: {
      practiceId: params.practiceId.toString(),
      billingPeriod: params.billingPeriod,
      type: 'monthly_fee',
    },
  });

  return paymentIntent;
}

/**
 * Charge a patient's saved card for a copay at check-in.
 * Uses off_session + confirm so the charge fires immediately without another
 * patient action (the patient already authorized this card when they saved it).
 *
 * Metadata includes appointmentId + type='copay' so the Stripe webhook can
 * update the appointment row when payment_intent.succeeded arrives.
 */
export async function chargeCopay(params: {
  customerId: string;
  paymentMethodId: string;
  amount: number; // cents
  description: string;
  practiceId: number;
  patientId: number;
  appointmentId: number;
}): Promise<Stripe.PaymentIntent> {
  const paymentIntent = await getStripe().paymentIntents.create({
    amount: params.amount,
    currency: 'usd',
    customer: params.customerId,
    payment_method: params.paymentMethodId,
    off_session: true,
    confirm: true,
    description: params.description,
    metadata: {
      practiceId: params.practiceId.toString(),
      patientId: params.patientId.toString(),
      appointmentId: params.appointmentId.toString(),
      type: 'copay',
    },
  });

  return paymentIntent;
}

/**
 * Create a payment intent for patient payment
 */
export async function createPatientPaymentIntent(params: {
  amount: number; // in cents
  patientEmail: string;
  patientName: string;
  practiceId: number;
  patientId: number;
  claimId?: number;
  description: string;
}): Promise<Stripe.PaymentIntent> {
  const paymentIntent = await getStripe().paymentIntents.create({
    amount: params.amount,
    currency: 'usd',
    receipt_email: params.patientEmail,
    description: params.description,
    metadata: {
      practiceId: params.practiceId.toString(),
      patientId: params.patientId.toString(),
      claimId: params.claimId?.toString() || '',
      type: 'patient_payment',
    },
  });

  return paymentIntent;
}

/**
 * Create a payment link for patient to pay their balance
 */
export async function createPatientPaymentLink(params: {
  amount: number; // in cents
  patientName: string;
  practiceId: number;
  patientId: number;
  description: string;
}): Promise<Stripe.PaymentLink> {
  // First create a price for this one-time payment
  const price = await getStripe().prices.create({
    unit_amount: params.amount,
    currency: 'usd',
    product_data: {
      name: params.description,
    },
  });

  const paymentLink = await getStripe().paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: {
      practiceId: params.practiceId.toString(),
      patientId: params.patientId.toString(),
      type: 'patient_payment',
    },
    after_completion: {
      type: 'redirect',
      redirect: {
        url: `${process.env.APP_URL || 'http://localhost:5000'}/portal/payment-success`,
      },
    },
  });

  return paymentLink;
}

/**
 * List payment methods for a customer
 */
export async function listPaymentMethods(customerId: string): Promise<Stripe.PaymentMethod[]> {
  const paymentMethods = await getStripe().paymentMethods.list({
    customer: customerId,
    type: 'card',
  });

  return paymentMethods.data;
}

/**
 * Set default payment method for a customer
 */
export async function setDefaultPaymentMethod(
  customerId: string,
  paymentMethodId: string
): Promise<Stripe.Customer> {
  const customer = await getStripe().customers.update(customerId, {
    invoice_settings: {
      default_payment_method: paymentMethodId,
    },
  });

  return customer;
}

/**
 * Get payment history for a customer
 */
export async function getPaymentHistory(
  customerId: string,
  limit: number = 10
): Promise<Stripe.PaymentIntent[]> {
  const paymentIntents = await getStripe().paymentIntents.list({
    customer: customerId,
    limit,
  });

  return paymentIntents.data;
}

/**
 * Calculate monthly fee based on collections
 */
export function calculateMonthlyFee(
  totalCollections: number,
  planPercentage: number
): { feeAmount: number; feePercentage: number } {
  const feeAmount = Math.round(totalCollections * (planPercentage / 100) * 100); // in cents
  return {
    feeAmount,
    feePercentage: planPercentage,
  };
}

/**
 * Create a refund
 */
export async function createRefund(
  paymentIntentId: string,
  amount?: number // partial refund in cents, omit for full refund
): Promise<Stripe.Refund> {
  const refund = await getStripe().refunds.create({
    payment_intent: paymentIntentId,
    amount,
  });

  return refund;
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string,
  webhookSecret: string
): Stripe.Event {
  return getStripe().webhooks.constructEvent(payload, signature, webhookSecret);
}

/**
 * Get Stripe instance for advanced operations
 */
export function getStripeInstance(): Stripe {
  return getStripe();
}

/**
 * Create a customer (for patients or practices)
 */
export async function createCustomer(
  email: string,
  name: string,
  metadata?: Record<string, string>
): Promise<Stripe.Customer> {
  const customer = await getStripe().customers.create({
    email,
    name,
    metadata,
  });
  return customer;
}

/**
 * Get a payment method by ID
 */
export async function getPaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
  return await getStripe().paymentMethods.retrieve(paymentMethodId);
}

// ─── Subscription Checkout ──────────────────────────────────────────────────

export type PlanId = keyof typeof PRICING_PLANS;
export type BillingInterval = 'month' | 'year';

/**
 * Look up a Stripe Price by lookup_key, or create it if missing.
 * Uses lookup_keys set by createStripePricingCatalog (e.g. "therapybill-starter-monthly").
 */
export async function getOrCreatePrice(
  planId: PlanId,
  interval: BillingInterval
): Promise<string> {
  const s = getStripe();
  const plan = PRICING_PLANS[planId];
  const intervalLabel = interval === 'year' ? 'annual' : 'monthly';
  const lookupKey = `therapybill-${planId}-${intervalLabel}`;

  // Try to find existing price by lookup_key
  const existingPrices = await s.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (existingPrices.data.length > 0) {
    return existingPrices.data[0].id;
  }

  // No price found — find or create the product, then create the price
  const existingProducts = await s.products.search({
    query: `metadata["planKey"]:"${planId}"`,
    limit: 1,
  });

  let productId: string;
  if (existingProducts.data.length > 0) {
    productId = existingProducts.data[0].id;
  } else {
    const product = await s.products.create({
      name: `TherapyBill AI \u2014 ${plan.name}`,
      description: plan.tagline,
      metadata: { planKey: planId },
    });
    productId = product.id;
  }

  const amountCents = interval === 'year' ? plan.annualPriceCents : plan.monthlyPriceCents;
  const price = await s.prices.create({
    product: productId,
    unit_amount: amountCents,
    currency: 'usd',
    recurring: { interval },
    lookup_key: lookupKey,
    metadata: { planKey: planId, interval: intervalLabel },
  });

  return price.id;
}

/**
 * Create a Stripe Checkout Session for a subscription.
 */
export async function createCheckoutSession(params: {
  customerId: string;
  priceId: string;
  practiceId: number;
  planId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<Stripe.Checkout.Session> {
  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    customer: params.customerId,
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      practiceId: params.practiceId.toString(),
      planId: params.planId,
    },
    subscription_data: {
      metadata: {
        practiceId: params.practiceId.toString(),
        planId: params.planId,
      },
    },
  });

  return session;
}

/**
 * Get a Stripe subscription by ID.
 */
export async function getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return await getStripe().subscriptions.retrieve(subscriptionId);
}

/**
 * Cancel a Stripe subscription at the end of the current billing period.
 */
export async function cancelSubscriptionAtPeriodEnd(subscriptionId: string): Promise<Stripe.Subscription> {
  return await getStripe().subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
}

/**
 * Reactivate a subscription that was set to cancel at period end.
 */
export async function reactivateSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return await getStripe().subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });
}
