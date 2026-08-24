/**
 * Patient money must not be collected on behalf of a practice we cannot remit
 * it to.
 *
 * Every patient-facing charge runs through TherapyBill's own Stripe account,
 * so funds land in TherapyBill's balance. For the founder's own practice
 * that is fine. For any other practice it would mean holding their patients'
 * money with no mechanism to pass it on. Until Stripe Connect settles funds
 * directly to each practice, collection is restricted to an allowlist.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const ORIGINAL = process.env.PATIENT_PAYMENT_PRACTICE_IDS;

beforeEach(() => {
  vi.resetModules();
  delete process.env.PATIENT_PAYMENT_PRACTICE_IDS;
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PATIENT_PAYMENT_PRACTICE_IDS;
  else process.env.PATIENT_PAYMENT_PRACTICE_IDS = ORIGINAL;
});

describe('practiceMayCollectPatientPayments', () => {
  it('defaults to the founder practice only', async () => {
    const { practiceMayCollectPatientPayments } = await import('../services/stripeService');
    expect(practiceMayCollectPatientPayments(1)).toBe(true);
    expect(practiceMayCollectPatientPayments(2)).toBe(false);
    expect(practiceMayCollectPatientPayments(37)).toBe(false);
  });

  it('honors an explicit allowlist', async () => {
    process.env.PATIENT_PAYMENT_PRACTICE_IDS = '1, 7';
    const { practiceMayCollectPatientPayments } = await import('../services/stripeService');
    expect(practiceMayCollectPatientPayments(7)).toBe(true);
    expect(practiceMayCollectPatientPayments(8)).toBe(false);
  });
});

describe('patient-charging functions refuse a non-allowlisted practice', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  });

  it('chargeCopay throws before touching Stripe', async () => {
    const svc = await import('../services/stripeService');
    await expect(
      svc.chargeCopay({
        customerId: 'cus_1',
        paymentMethodId: 'pm_1',
        amount: 3000,
        description: 'Copay',
        practiceId: 2, // not the founder practice
        patientId: 5,
        appointmentId: 9,
      }),
    ).rejects.toThrow(/not enabled for this practice/i);
  });

  it('createPatientPaymentLink throws before touching Stripe', async () => {
    const svc = await import('../services/stripeService');
    await expect(
      svc.createPatientPaymentLink({
        amount: 5000,
        patientName: 'A B',
        practiceId: 2,
        patientId: 5,
        description: 'Balance',
      }),
    ).rejects.toThrow(/not enabled for this practice/i);
  });

  it('createPatientPaymentIntent throws before touching Stripe', async () => {
    const svc = await import('../services/stripeService');
    await expect(
      svc.createPatientPaymentIntent({
        amount: 5000,
        patientEmail: 'a@b.com',
        patientName: 'A B',
        practiceId: 2,
        patientId: 5,
        description: 'Balance',
      }),
    ).rejects.toThrow(/not enabled for this practice/i);
  });

  it('allows the founder practice through the guard', async () => {
    const svc = await import('../services/stripeService');
    // Reaches Stripe (which fails on the fake key) rather than the guard.
    await expect(
      svc.createPatientPaymentLink({
        amount: 5000,
        patientName: 'A B',
        practiceId: 1,
        patientId: 5,
        description: 'Balance',
      }),
    ).rejects.not.toThrow(/not enabled for this practice/i);
  });
});
