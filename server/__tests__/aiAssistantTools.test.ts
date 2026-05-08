/**
 * Targeted regression tests for the high-risk Blanche tools.
 *
 * Locks down three behaviors from the PR #86 security review:
 *   1. check_claim_status rejects cross-practice access
 *   2. create_patient_invoice rejects amounts above the $10,000 cap
 *   3. send_patient_payment_link rejects Stripe intents that lack our metadata
 *      (the cross-tenant bypass fix)
 *   4. bulk_eligibility_by_filter enforces the 200-patient cap and applies the
 *      payer filter without an N+1 lookup
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- mocks (vi.hoisted lets the mock objects be referenced both inside
//      vi.mock() factories — which run before imports — and from tests) ----

const { mockStorage, mockStripe, mockPaymentIntentsRetrieve, mockStediCheckEligibility } = vi.hoisted(() => {
  const mockPaymentIntentsRetrieve = vi.fn();
  return {
    mockStorage: {
      getClaim: vi.fn(),
      getClaims: vi.fn(),
      getClaimLineItems: vi.fn(),
      getPatient: vi.fn(),
      getPatients: vi.fn(),
      getPatientsByIds: vi.fn(),
      getPractice: vi.fn(),
      getInsurance: vi.fn(),
      getAppointmentsByDateRange: vi.fn(),
    },
    mockStripe: {
      isStripeConfigured: vi.fn(() => true),
      createPatientPaymentIntent: vi.fn(),
      createPatientPaymentLink: vi.fn(),
      getStripeInstance: vi.fn(() => ({
        paymentIntents: { retrieve: mockPaymentIntentsRetrieve },
      })),
    },
    mockPaymentIntentsRetrieve,
    mockStediCheckEligibility: vi.fn(),
  };
});

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/stripeService', () => mockStripe);
vi.mock('../services/stediService', () => ({
  isStediConfigured: vi.fn(() => true),
  checkEligibility: mockStediCheckEligibility,
  checkClaimStatus: vi.fn(),
  resolvePayerId: vi.fn(),
  getStediApiKeyForPractice: vi.fn(() => Promise.resolve(null)),
  PAYER_IDS: {} as Record<string, string>,
}));

vi.mock('../db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => Promise.resolve([])),
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
    })),
  },
}));

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../replitAuth', () => ({ isAuthenticated: vi.fn() }));
vi.mock('../services/practiceContext', () => ({ getUserPracticeContext: vi.fn() }));
vi.mock('../services/aiSoapBillingService', () => ({ generateSoapNoteAndBilling: vi.fn() }));
vi.mock('../services/underpaymentAnalyzer', () => ({
  assessUnderpayment: vi.fn(),
  analyzeAdjustment: vi.fn(),
}));

import { executeTool } from '../routes/ai-assistant';

const PRACTICE_ID = 1;
const OTHER_PRACTICE_ID = 999;

beforeEach(() => {
  vi.clearAllMocks();
  mockStripe.isStripeConfigured.mockReturnValue(true);
});

// ---- 1. check_claim_status: cross-practice rejection ---------------------

describe('check_claim_status', () => {
  it('rejects a claim that belongs to a different practice', async () => {
    mockStorage.getClaim.mockResolvedValue({
      id: 42,
      practiceId: OTHER_PRACTICE_ID,
      status: 'submitted',
      patientId: 7,
      claimNumber: 'CLM-OTHER-42',
      totalAmount: '150.00',
    });

    const out = await executeTool('check_claim_status', { claimId: 42 }, PRACTICE_ID, 'user1');
    const parsed = JSON.parse(out);

    expect(parsed.error).toBeDefined();
    expect(parsed.error).toMatch(/does not belong/i);
    // Sanity: we never reached the clearinghouse
    expect(mockStorage.getClaimLineItems).not.toHaveBeenCalled();
  });

  it('rejects when the claim id is unknown', async () => {
    mockStorage.getClaim.mockResolvedValue(undefined);
    const out = await executeTool('check_claim_status', { claimId: 99999 }, PRACTICE_ID, 'user1');
    expect(JSON.parse(out).error).toMatch(/not found/i);
  });
});

// ---- 2. create_patient_invoice: $10k cap ---------------------------------

describe('create_patient_invoice', () => {
  it('rejects amounts above $10,000', async () => {
    const out = await executeTool(
      'create_patient_invoice',
      { patientId: 1, amount: 10001, description: 'oversized invoice' },
      PRACTICE_ID,
      'user1',
    );
    const parsed = JSON.parse(out);

    expect(parsed.error).toBeDefined();
    expect(parsed.error).toMatch(/10,000/);
    expect(mockStripe.createPatientPaymentIntent).not.toHaveBeenCalled();
  });

  it('accepts an amount at the cap', async () => {
    mockStorage.getPatient.mockResolvedValue({
      id: 1,
      practiceId: PRACTICE_ID,
      firstName: 'Test',
      lastName: 'Patient',
      email: 't@x.com',
    });
    mockStripe.createPatientPaymentIntent.mockResolvedValue({
      id: 'pi_123',
      status: 'requires_payment_method',
      currency: 'usd',
    });

    const out = await executeTool(
      'create_patient_invoice',
      { patientId: 1, amount: 10000, description: 'at cap' },
      PRACTICE_ID,
      'user1',
    );
    const parsed = JSON.parse(out);

    expect(parsed.success).toBe(true);
    expect(parsed.invoice.id).toBe('pi_123');
    expect(mockStripe.createPatientPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000000 }), // dollars → cents
    );
  });
});

// ---- 3. send_patient_payment_link: metadata-required cross-tenant fix ----

describe('send_patient_payment_link', () => {
  beforeEach(() => {
    mockStorage.getPatient.mockResolvedValue({
      id: 1,
      practiceId: PRACTICE_ID,
      firstName: 'Test',
      lastName: 'Patient',
    });
  });

  it('rejects an intent with NO metadata at all (bypass fix)', async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: 'pi_outsider',
      amount: 5000,
      description: 'externally created',
      metadata: {},
    });

    const out = await executeTool(
      'send_patient_payment_link',
      { patientId: 1, invoiceId: 'pi_outsider' },
      PRACTICE_ID,
      'user1',
    );
    expect(JSON.parse(out).error).toMatch(/not found for this practice/i);
    expect(mockStripe.createPatientPaymentLink).not.toHaveBeenCalled();
  });

  it('rejects an intent whose practiceId metadata does not match', async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: 'pi_other',
      amount: 5000,
      metadata: { practiceId: String(OTHER_PRACTICE_ID), patientId: '1' },
    });

    const out = await executeTool(
      'send_patient_payment_link',
      { patientId: 1, invoiceId: 'pi_other' },
      PRACTICE_ID,
      'user1',
    );
    expect(JSON.parse(out).error).toMatch(/not found for this practice/i);
  });

  it('rejects an intent whose patientId metadata does not match', async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: 'pi_wrongpatient',
      amount: 5000,
      metadata: { practiceId: String(PRACTICE_ID), patientId: '99' },
    });

    const out = await executeTool(
      'send_patient_payment_link',
      { patientId: 1, invoiceId: 'pi_wrongpatient' },
      PRACTICE_ID,
      'user1',
    );
    expect(JSON.parse(out).error).toMatch(/different patient/i);
  });

  it('accepts an intent whose metadata matches both practice and patient', async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: 'pi_ours',
      amount: 5000,
      description: 'copay',
      metadata: { practiceId: String(PRACTICE_ID), patientId: '1' },
    });
    mockStripe.createPatientPaymentLink.mockResolvedValue({
      id: 'pl_abc',
      url: 'https://checkout.stripe.com/test',
    });

    const out = await executeTool(
      'send_patient_payment_link',
      { patientId: 1, invoiceId: 'pi_ours' },
      PRACTICE_ID,
      'user1',
    );
    const parsed = JSON.parse(out);
    expect(parsed.success).toBe(true);
    expect(parsed.paymentLink.url).toBe('https://checkout.stripe.com/test');
    expect(mockStripe.createPatientPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, practiceId: PRACTICE_ID }),
    );
  });
});

// ---- 4. bulk_eligibility_by_filter: cap + N+1-free payer filter ----------

describe('bulk_eligibility_by_filter', () => {
  it('rejects ranges over 60 days', async () => {
    const out = await executeTool(
      'bulk_eligibility_by_filter',
      { startDate: '2026-01-01', endDate: '2026-04-01', appointmentsOnly: false },
      PRACTICE_ID,
      'user1',
    );
    expect(JSON.parse(out).error).toMatch(/60 days/);
    expect(mockStorage.getPatients).not.toHaveBeenCalled();
  });

  it('rejects when the candidate set exceeds 200 patients (cap fires before per-patient work)', async () => {
    const fakePatients = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1,
      practiceId: PRACTICE_ID,
      insuranceProvider: 'Aetna',
    }));
    mockStorage.getPatients.mockResolvedValue(fakePatients);

    const out = await executeTool(
      'bulk_eligibility_by_filter',
      { appointmentsOnly: false },
      PRACTICE_ID,
      'user1',
    );
    const parsed = JSON.parse(out);

    expect(parsed.error).toMatch(/Too many patients matched \(250\)/);
    // Critical: per-patient work must NOT have started
    expect(mockStorage.getPatient).not.toHaveBeenCalled();
    expect(mockStorage.getPatientsByIds).not.toHaveBeenCalled();
    expect(mockStediCheckEligibility).not.toHaveBeenCalled();
  });

  it('applies the payer filter using the records already fetched (no N+1)', async () => {
    const aetna = { id: 1, practiceId: PRACTICE_ID, insuranceProvider: 'Aetna PPO', firstName: 'A', lastName: 'A' };
    const bcbs  = { id: 2, practiceId: PRACTICE_ID, insuranceProvider: 'BCBS', firstName: 'B', lastName: 'B' };
    mockStorage.getPatients.mockResolvedValue([aetna, bcbs]);
    mockStorage.getPractice.mockResolvedValue({ id: PRACTICE_ID, name: 'Test', npi: '1234567890' });
    mockStediCheckEligibility.mockResolvedValue({ status: 'active' });

    const out = await executeTool(
      'bulk_eligibility_by_filter',
      { appointmentsOnly: false, payerName: 'aetna' },
      PRACTICE_ID,
      'user1',
    );
    const parsed = JSON.parse(out);

    expect(parsed.checked).toBe(1);
    // The runBulkEligibility helper still calls getPatient once per matched
    // patient (defense-in-depth). What we're checking here is that
    // getPatientsByIds was NOT used because we already had records, AND
    // getPatient was called only for the 1 filtered patient — not all 2.
    expect(mockStorage.getPatientsByIds).not.toHaveBeenCalled();
    expect(mockStorage.getPatient).toHaveBeenCalledTimes(1);
    expect(mockStorage.getPatient).toHaveBeenCalledWith(1); // the Aetna patient
  });
});
