import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * POST /api/patient-portal/intake/setup-intent creates a Stripe Customer the
 * first time a patient saves a card. Stripe confirmed (support, 2026-10)
 * that a Customer's name/email aren't required to tokenize or process a
 * payment method, so - with no BAA offered for Payments/Billing/Elements -
 * the Customer name sent to Stripe should be a neutral internal reference,
 * never the patient's actual name.
 */

const { storageStub, stripeStub } = vi.hoisted(() => ({
  storageStub: {
    getPatientPortalByToken: vi.fn(),
    getPatient: vi.fn(),
    getPractice: vi.fn(),
    updatePatientStripeCustomerId: vi.fn(),
  },
  stripeStub: {
    createCustomer: vi.fn(),
    createSetupIntent: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../services/stripeService', () => stripeStub);
vi.mock('../services/emailService', () => ({ sendEmail: vi.fn() }));
vi.mock('../services/emailTemplates', () => ({ intakeSubmissionNotification: vi.fn() }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import patientIntakeRouter from '../routes/patient-intake';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', patientIntakeRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageStub.getPatientPortalByToken.mockResolvedValue({ patientId: 42 });
  storageStub.getPatient.mockResolvedValue({
    id: 42,
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    practiceId: 1,
    stripeCustomerId: null,
  });
  storageStub.getPractice.mockResolvedValue({ id: 1, name: 'Test Practice' });
  stripeStub.createCustomer.mockResolvedValue({ id: 'cus_test123' });
  stripeStub.createSetupIntent.mockResolvedValue({ client_secret: 'seti_secret_abc' });
});

describe('POST /api/patient-portal/intake/setup-intent', () => {
  it('creates the Stripe Customer with a neutral reference, never the patient\'s real name', async () => {
    const res = await request(buildApp())
      .post('/api/patient-portal/intake/setup-intent')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(stripeStub.createCustomer).toHaveBeenCalledTimes(1);
    const [email, name] = stripeStub.createCustomer.mock.calls[0];

    expect(name).toBe('Patient #42');
    expect(name).not.toMatch(/Jane|Doe/);
    // Email is kept - Stripe needs it to deliver receipts.
    expect(email).toBe('jane@example.com');
  });

  it('does not create a new Customer when one already exists', async () => {
    storageStub.getPatient.mockResolvedValue({
      id: 42, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com',
      practiceId: 1, stripeCustomerId: 'cus_existing',
    });

    const res = await request(buildApp())
      .post('/api/patient-portal/intake/setup-intent')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(stripeStub.createCustomer).not.toHaveBeenCalled();
    expect(stripeStub.createSetupIntent).toHaveBeenCalledWith('cus_existing');
  });
});
