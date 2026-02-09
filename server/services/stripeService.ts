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
      apiVersion: '2024-11-20.acacia',
    });
  }
  return stripe;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

// Pricing plans
export const PRICING_PLANS = {
  solo: {
    name: 'Solo Practice',
    percentageFee: 5.0,
    maxPatients: 100,
    features: ['All core features', 'Email support', 'Up to 100 patients'],
  },
  growing: {
    name: 'Growing Practice',
    percentageFee: 4.5,
    maxPatients: null, // unlimited
    features: ['Unlimited patients', 'Multiple providers', 'Priority support', 'Advanced analytics'],
  },
  enterprise: {
    name: 'Enterprise',
    percentageFee: null, // custom
    maxPatients: null,
    features: ['Multi-location', 'Custom integrations', 'Dedicated success manager', 'SLA guarantee'],
  },
};

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
