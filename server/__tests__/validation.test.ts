import { describe, it, expect } from 'vitest';
import {
  createPatientSchema,
  createClaimSchema,
  updateClaimSchema,
  numericIdParamsSchema,
} from '../validation/schemas';

describe('createPatientSchema', () => {
  const validPatient = {
    practiceId: 1,
    firstName: 'Jane',
    lastName: 'Doe',
  };

  it('accepts valid minimal patient data', () => {
    const result = createPatientSchema.safeParse(validPatient);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe('Jane');
      expect(result.data.lastName).toBe('Doe');
      expect(result.data.practiceId).toBe(1);
    }
  });

  it('trims whitespace from name fields', () => {
    const result = createPatientSchema.safeParse({
      ...validPatient,
      firstName: '  Jane  ',
      lastName: '  Doe  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe('Jane');
      expect(result.data.lastName).toBe('Doe');
    }
  });

  it('rejects missing firstName', () => {
    const result = createPatientSchema.safeParse({
      practiceId: 1,
      lastName: 'Doe',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing lastName', () => {
    const result = createPatientSchema.safeParse({
      practiceId: 1,
      firstName: 'Jane',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive practiceId', () => {
    const result = createPatientSchema.safeParse({
      ...validPatient,
      practiceId: 0,
    });
    expect(result.success).toBe(false);

    const result2 = createPatientSchema.safeParse({
      ...validPatient,
      practiceId: -1,
    });
    expect(result2.success).toBe(false);
  });

  it('validates date of birth format', () => {
    const valid = createPatientSchema.safeParse({
      ...validPatient,
      dateOfBirth: '1990-05-15',
    });
    expect(valid.success).toBe(true);

    const invalid = createPatientSchema.safeParse({
      ...validPatient,
      dateOfBirth: '05/15/1990',
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects future date of birth', () => {
    const result = createPatientSchema.safeParse({
      ...validPatient,
      dateOfBirth: '2099-01-01',
    });
    expect(result.success).toBe(false);
  });

  it('allows null and empty string for optional email', () => {
    const withNull = createPatientSchema.safeParse({ ...validPatient, email: null });
    expect(withNull.success).toBe(true);

    const withEmpty = createPatientSchema.safeParse({ ...validPatient, email: '' });
    expect(withEmpty.success).toBe(true);
  });

  it('validates email format', () => {
    const valid = createPatientSchema.safeParse({
      ...validPatient,
      email: 'jane@example.com',
    });
    expect(valid.success).toBe(true);

    const invalid = createPatientSchema.safeParse({
      ...validPatient,
      email: 'not-an-email',
    });
    expect(invalid.success).toBe(false);
  });

  it('normalizes email to lowercase', () => {
    const result = createPatientSchema.safeParse({
      ...validPatient,
      email: 'Jane@Example.COM',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('jane@example.com');
    }
  });

  it('validates phone number digit count', () => {
    const valid10 = createPatientSchema.safeParse({
      ...validPatient,
      phone: '5551234567',
    });
    expect(valid10.success).toBe(true);

    const validFormatted = createPatientSchema.safeParse({
      ...validPatient,
      phone: '(555) 123-4567',
    });
    expect(validFormatted.success).toBe(true);

    const tooShort = createPatientSchema.safeParse({
      ...validPatient,
      phone: '12345',
    });
    expect(tooShort.success).toBe(false);
  });

  it('accepts secondary insurance fields', () => {
    const result = createPatientSchema.safeParse({
      ...validPatient,
      secondaryInsuranceProvider: 'Cigna',
      secondaryInsurancePolicyNumber: 'POL789',
      secondaryInsuranceMemberId: 'MEM456',
      secondaryInsuranceGroupNumber: 'GRP123',
      secondaryInsuranceRelationship: 'spouse',
      secondaryInsuranceSubscriberName: 'John Doe',
      secondaryInsuranceSubscriberDob: '1988-03-22',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.secondaryInsuranceRelationship).toBe('spouse');
    }
  });

  it('rejects invalid secondaryInsuranceRelationship enum value', () => {
    const result = createPatientSchema.safeParse({
      ...validPatient,
      secondaryInsuranceRelationship: 'cousin',
    });
    expect(result.success).toBe(false);
  });

  it('applies default values for phoneType and preferredContactMethod', () => {
    const result = createPatientSchema.safeParse(validPatient);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phoneType).toBe('mobile');
      expect(result.data.preferredContactMethod).toBe('email');
      expect(result.data.smsConsentGiven).toBe(false);
    }
  });
});

describe('createClaimSchema', () => {
  const validClaim = {
    patientId: 1,
    totalAmount: 150.00,
  };

  it('accepts valid minimal claim data', () => {
    const result = createClaimSchema.safeParse(validClaim);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('draft');
      expect(result.data.billingOrder).toBe('primary');
    }
  });

  it('accepts totalAmount as a string and transforms to number', () => {
    const result = createClaimSchema.safeParse({
      patientId: 1,
      totalAmount: '175.50',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalAmount).toBe(175.50);
    }
  });

  it('rejects zero totalAmount', () => {
    const result = createClaimSchema.safeParse({
      patientId: 1,
      totalAmount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative totalAmount', () => {
    const result = createClaimSchema.safeParse({
      patientId: 1,
      totalAmount: -50,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive patientId', () => {
    const result = createClaimSchema.safeParse({
      patientId: 0,
      totalAmount: 100,
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid status values', () => {
    for (const status of ['draft', 'submitted', 'paid', 'denied', 'appeal', 'optimized']) {
      const result = createClaimSchema.safeParse({
        ...validClaim,
        status,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid status value', () => {
    const result = createClaimSchema.safeParse({
      ...validClaim,
      status: 'cancelled',
    });
    expect(result.success).toBe(false);
  });

  it('accepts secondary billing order with primaryClaimId', () => {
    const result = createClaimSchema.safeParse({
      ...validClaim,
      billingOrder: 'secondary',
      primaryClaimId: 42,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.billingOrder).toBe('secondary');
      expect(result.data.primaryClaimId).toBe(42);
    }
  });

  it('rejects missing patientId', () => {
    const result = createClaimSchema.safeParse({ totalAmount: 100 });
    expect(result.success).toBe(false);
  });
});

describe('updateClaimSchema', () => {
  it('accepts valid paidAmount as number', () => {
    const result = updateClaimSchema.safeParse({ paidAmount: 120.50 });
    expect(result.success).toBe(true);
  });

  it('rejects negative paidAmount', () => {
    const result = updateClaimSchema.safeParse({ paidAmount: -10 });
    expect(result.success).toBe(false);
  });

  it('accepts denialReason string', () => {
    const result = updateClaimSchema.safeParse({
      status: 'denied',
      denialReason: 'Not medically necessary',
    });
    expect(result.success).toBe(true);
  });
});

describe('numericIdParamsSchema', () => {
  it('parses valid numeric string ID', () => {
    const result = numericIdParamsSchema.safeParse({ id: '42' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(42);
    }
  });

  it('rejects non-numeric string', () => {
    const result = numericIdParamsSchema.safeParse({ id: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects zero', () => {
    const result = numericIdParamsSchema.safeParse({ id: '0' });
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = numericIdParamsSchema.safeParse({ id: '' });
    expect(result.success).toBe(false);
  });
});
