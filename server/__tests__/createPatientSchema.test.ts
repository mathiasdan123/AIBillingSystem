/**
 * A client must be able to create a patient WITHOUT sending practiceId.
 *
 * The route overwrites practiceId with the caller's own practice (tenant
 * safety), so the client value is ignored — but the Zod schema still
 * REQUIRED it, so every caller that correctly stopped sending a hardcoded
 * practiceId got "Practice ID must be a positive integer" and patient
 * creation broke from the calendar, front-desk walk-in, waitlist, SOAP notes
 * and treatment plans (caught live during a demo, 2026-08-24).
 */
import { describe, it, expect } from 'vitest';
import { createPatientSchema } from '../validation/schemas';

describe('createPatientSchema', () => {
  it('accepts a create with no practiceId (the route binds it)', () => {
    const result = createPatientSchema.safeParse({
      firstName: 'Jane',
      lastName: 'Doe',
      dateOfBirth: '2000-01-01',
    });
    expect(result.success).toBe(true);
  });

  it('accepts the minimum a quick-add flow sends: first and last name only', () => {
    const result = createPatientSchema.safeParse({ firstName: 'Jane', lastName: 'Doe' });
    expect(result.success).toBe(true);
  });

  it('still rejects a missing last name', () => {
    const result = createPatientSchema.safeParse({ firstName: 'Jane' });
    expect(result.success).toBe(false);
  });

  it('still rejects a nonsense practiceId when one IS supplied', () => {
    const result = createPatientSchema.safeParse({
      firstName: 'Jane',
      lastName: 'Doe',
      practiceId: -5,
    });
    expect(result.success).toBe(false);
  });
});
