/**
 * Tests for the create_appointment_self_pay_invoice Blanche tool (P0.4).
 *
 * Explicit skip-the-claim path: generates a Stripe payment link for an
 * appointment, computed from the appointment type's price when no amount
 * is supplied. Tenant-guards through the appointment's practiceId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockStorage, mockStripe, mockCreatePatientPaymentLink,
} = vi.hoisted(() => {
  const mockCreatePatientPaymentLink = vi.fn();
  return {
    mockStorage: {
      getAppointment: vi.fn(),
      getPatient: vi.fn(),
      getAppointmentType: vi.fn(),
      getPatients: vi.fn(),
    },
    mockStripe: {
      isStripeConfigured: vi.fn(() => true),
      createPatientPaymentLink: mockCreatePatientPaymentLink,
    },
    mockCreatePatientPaymentLink,
  };
});

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/stripeService', () => mockStripe);
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));

import { executeTool } from '../routes/ai-assistant';

const PRACTICE_ID = 1;
const OTHER_PRACTICE = 99;
const USER_ID = 'user-1';
const APPT_ID = 555;
const PATIENT_ID = 42;
const APPT_TYPE_ID = 7;

const goodAppointment = (overrides: Partial<any> = {}) => ({
  id: APPT_ID,
  practiceId: PRACTICE_ID,
  patientId: PATIENT_ID,
  appointmentTypeId: APPT_TYPE_ID,
  startTime: '2026-05-29T16:00:00.000Z',
  title: 'OT Session',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockStripe.isStripeConfigured.mockReturnValue(true);
  mockCreatePatientPaymentLink.mockResolvedValue({
    id: 'plink_test_abc',
    url: 'https://buy.stripe.com/test_abc',
  });
});

describe('create_appointment_self_pay_invoice tool', () => {
  it('auto-computes the invoice amount from the appointment type price when none supplied', async () => {
    mockStorage.getAppointment.mockResolvedValue(goodAppointment());
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, firstName: 'Sarah', lastName: 'Chen' });
    mockStorage.getAppointmentType.mockResolvedValue({ id: APPT_TYPE_ID, price: '175.00', name: 'OT Eval' });
    const out = JSON.parse(
      await executeTool('create_appointment_self_pay_invoice', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID),
    );
    expect(out.success).toBe(true);
    expect(out.invoice.amount).toBe('175.00');
    expect(out.invoice.paymentLinkUrl).toBe('https://buy.stripe.com/test_abc');
    expect(out.appointment).toMatchObject({ id: APPT_ID, patient: 'Sarah Chen', date: '2026-05-29' });
    const call = mockCreatePatientPaymentLink.mock.calls[0][0];
    expect(call.amount).toBe(17500); // cents
    expect(call.patientName).toBe('Sarah Chen');
    expect(call.practiceId).toBe(PRACTICE_ID);
    expect(call.description).toMatch(/OT Session.*2026-05-29/);
  });

  it('explicit amount overrides the appointment-type price', async () => {
    mockStorage.getAppointment.mockResolvedValue(goodAppointment());
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, firstName: 'S', lastName: 'C' });
    // No need to set up appointmentType — explicit amount wins.
    await executeTool(
      'create_appointment_self_pay_invoice',
      { appointmentId: APPT_ID, amount: 200, description: 'Custom desc' },
      PRACTICE_ID, USER_ID,
    );
    const call = mockCreatePatientPaymentLink.mock.calls[0][0];
    expect(call.amount).toBe(20000); // cents
    expect(call.description).toBe('Custom desc');
    expect(mockStorage.getAppointmentType).not.toHaveBeenCalled();
  });

  it('rejects when no amount can be determined (no override + no type price)', async () => {
    mockStorage.getAppointment.mockResolvedValue(goodAppointment());
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, firstName: 'S', lastName: 'C' });
    mockStorage.getAppointmentType.mockResolvedValue({ id: APPT_TYPE_ID, price: null });
    const out = JSON.parse(
      await executeTool('create_appointment_self_pay_invoice', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID),
    );
    expect(out.error).toMatch(/could not determine.*amount/i);
    expect(mockCreatePatientPaymentLink).not.toHaveBeenCalled();
  });

  it('rejects amount over the $10,000 assistant cap', async () => {
    mockStorage.getAppointment.mockResolvedValue(goodAppointment());
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, firstName: 'S', lastName: 'C' });
    const out = JSON.parse(
      await executeTool(
        'create_appointment_self_pay_invoice',
        { appointmentId: APPT_ID, amount: 15000 },
        PRACTICE_ID, USER_ID,
      ),
    );
    expect(out.error).toMatch(/10,000/);
    expect(mockCreatePatientPaymentLink).not.toHaveBeenCalled();
  });

  it('rejects cross-practice appointment (tenant guard)', async () => {
    mockStorage.getAppointment.mockResolvedValue(goodAppointment({ practiceId: OTHER_PRACTICE }));
    const out = JSON.parse(
      await executeTool('create_appointment_self_pay_invoice', { appointmentId: APPT_ID, amount: 100 }, PRACTICE_ID, USER_ID),
    );
    expect(out.error).toMatch(/not in this practice/i);
    expect(mockCreatePatientPaymentLink).not.toHaveBeenCalled();
  });

  it('rejects unknown appointment id', async () => {
    mockStorage.getAppointment.mockResolvedValue(undefined);
    const out = JSON.parse(
      await executeTool('create_appointment_self_pay_invoice', { appointmentId: 999999, amount: 100 }, PRACTICE_ID, USER_ID),
    );
    expect(out.error).toMatch(/not found/i);
    expect(mockCreatePatientPaymentLink).not.toHaveBeenCalled();
  });

  it('rejects appointment with no associated patient', async () => {
    mockStorage.getAppointment.mockResolvedValue(goodAppointment({ patientId: null }));
    const out = JSON.parse(
      await executeTool('create_appointment_self_pay_invoice', { appointmentId: APPT_ID, amount: 100 }, PRACTICE_ID, USER_ID),
    );
    expect(out.error).toMatch(/no associated patient/i);
    expect(mockCreatePatientPaymentLink).not.toHaveBeenCalled();
  });

  it('returns a clear error when Stripe is not configured', async () => {
    mockStripe.isStripeConfigured.mockReturnValue(false);
    const out = JSON.parse(
      await executeTool('create_appointment_self_pay_invoice', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID),
    );
    expect(out.error).toMatch(/stripe is not configured/i);
    expect(mockStorage.getAppointment).not.toHaveBeenCalled();
  });
});
