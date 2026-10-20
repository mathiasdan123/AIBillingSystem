import { describe, it, expect } from 'vitest';
import { neutralPatientPaymentDescription, neutralAppointmentPaymentDescription } from '../services/stripeService';

/**
 * These are the default PaymentIntent/PaymentLink descriptions used across
 * billing.ts, appointments.ts, ai-assistant.ts, and the invoice/appointment
 * MCP tools whenever no caller-supplied description is given. They used to
 * default to the patient's full name or "Therapy session" - real PHI that
 * reached Stripe's own systems (shown on patient receipt emails and the
 * Stripe Dashboard). Locking in that these never include a name or any
 * clinical/treatment term.
 */
describe('neutralPatientPaymentDescription', () => {
  it('references only the patient ID, never a name', () => {
    const result = neutralPatientPaymentDescription(42);
    expect(result).toBe('Practice Payment — Patient #42');
    expect(result.toLowerCase()).not.toMatch(/therapy|session|treatment/);
  });
});

describe('neutralAppointmentPaymentDescription', () => {
  it('references only the appointment ID when no date is given', () => {
    const result = neutralAppointmentPaymentDescription(7);
    expect(result).toBe('Appointment Payment — #7');
  });

  it('includes the date but never "Therapy session" or an appointment title', () => {
    const result = neutralAppointmentPaymentDescription(7, '2026-10-20');
    expect(result).toBe('Appointment Payment — #7 (2026-10-20)');
    expect(result.toLowerCase()).not.toMatch(/therapy|session|treatment/);
  });
});
