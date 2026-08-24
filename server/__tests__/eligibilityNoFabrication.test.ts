import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * Regression tests for the "silent fabricating fallbacks" audit finding:
 * a real (non-demo) practice must NEVER receive invented eligibility data.
 *
 * Before this fix:
 *  - POST /api/appointments/:id/check-eligibility ALWAYS returned Math.random()
 *    benefits and persisted them as a real eligibility check (which then fed
 *    the front-desk copay display and created fake "Coverage Inactive" alerts).
 *  - POST /api/insurance/eligibility fell back to mock data when Stedi errored
 *    or when no API key was configured.
 *  - POST /api/eligibility/batch-verify fabricated checks AND critical alerts
 *    for every upcoming appointment.
 *
 * Now: demo practices (isDemo) get generated data; real practices get the real
 * Stedi check, a 503 when unconfigured, or a 502 on failure — never fiction.
 */

const { storageStub, adapterCheckMock } = vi.hoisted(() => ({
  storageStub: {
    getAppointment: vi.fn(),
    getPatient: vi.fn(),
    getPractice: vi.fn(),
    getInsurances: vi.fn(async () => []),
    createEligibilityCheck: vi.fn(async (row: any) => ({ id: 1, ...row })),
    createEligibilityAlert: vi.fn(async (row: any) => ({ id: 1, ...row })),
    getAppointmentsNeedingEligibilityCheck: vi.fn(async () => []),
    getUser: vi.fn(async () => ({ id: 'user-1', role: 'admin' })),
  },
  adapterCheckMock: vi.fn(),
}));

vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'user-1' } };
    req.userRole = 'admin';
    req.userPracticeId = 1;
    next();
  },
}));
vi.mock('../payer-integrations/adapters/payers/StediAdapter', () => ({
  StediAdapter: class {
    checkEligibility = adapterCheckMock;
  },
}));
vi.mock('../services/stediService', () => ({
  stcsForSpecialty: () => ['30'],
  getStediApiKeyForPractice: vi.fn(async () => null), // no practice-level key
}));
// Stripe service is imported by appointments.ts at module load.
vi.mock('../services/stripeService', () => ({
  chargeCopay: vi.fn(),
  isStripeConfigured: () => false,
  createPatientPaymentLink: vi.fn(),
}));

import appointmentsRouter from '../routes/appointments';
import insuranceRouter from '../routes/insurance';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/appointments', appointmentsRouter);
  app.use('/api', insuranceRouter);
  return app;
}

const PATIENT = {
  id: 9,
  practiceId: 1,
  firstName: 'Test',
  lastName: 'Patient',
  dateOfBirth: '2018-01-01',
  insuranceId: 'MEM123',
  insuranceProvider: 'Aetna',
};

const APPOINTMENT = { id: 5, practiceId: 1, patientId: 9, startTime: new Date() };

beforeEach(() => {
  Object.values(storageStub).forEach((fn) => (fn as any).mockClear?.());
  adapterCheckMock.mockReset();
  storageStub.getAppointment.mockResolvedValue(APPOINTMENT);
  storageStub.getPatient.mockResolvedValue(PATIENT);
  storageStub.getInsurances.mockResolvedValue([]);
  delete process.env.STEDI_API_KEY;
});

describe('real practice never receives fabricated eligibility', () => {
  it('appointments check-eligibility → 503 when no Stedi key, nothing persisted', async () => {
    storageStub.getPractice.mockResolvedValue({ id: 1, isDemo: false });

    const res = await request(makeApp()).post('/api/appointments/5/check-eligibility');

    expect(res.status).toBe(503);
    expect(storageStub.createEligibilityCheck).not.toHaveBeenCalled();
    expect(storageStub.createEligibilityAlert).not.toHaveBeenCalled();
  });

  it('appointments check-eligibility → 502 when Stedi fails, nothing persisted', async () => {
    storageStub.getPractice.mockResolvedValue({ id: 1, isDemo: false });
    process.env.STEDI_API_KEY = 'test_key';
    adapterCheckMock.mockRejectedValue(new Error('payer timeout'));

    const res = await request(makeApp()).post('/api/appointments/5/check-eligibility');

    expect(res.status).toBe(502);
    expect(storageStub.createEligibilityCheck).not.toHaveBeenCalled();
    expect(storageStub.createEligibilityAlert).not.toHaveBeenCalled();
  });

  it('insurance eligibility → 503 when no Stedi key, nothing persisted', async () => {
    storageStub.getPractice.mockResolvedValue({ id: 1, isDemo: false });

    const res = await request(makeApp())
      .post('/api/insurance/eligibility')
      .send({ patientId: 9 });

    expect(res.status).toBe(503);
    expect(storageStub.createEligibilityCheck).not.toHaveBeenCalled();
  });

  it('insurance eligibility → 502 when Stedi fails, nothing persisted', async () => {
    storageStub.getPractice.mockResolvedValue({ id: 1, isDemo: false });
    process.env.STEDI_API_KEY = 'test_key';
    adapterCheckMock.mockRejectedValue(new Error('bad member id'));

    const res = await request(makeApp())
      .post('/api/insurance/eligibility')
      .send({ patientId: 9 });

    expect(res.status).toBe(502);
    expect(storageStub.createEligibilityCheck).not.toHaveBeenCalled();
  });

  it('batch-verify → 503 when no Stedi key, no checks or alerts fabricated', async () => {
    storageStub.getPractice.mockResolvedValue({ id: 1, isDemo: false });
    storageStub.getAppointmentsNeedingEligibilityCheck.mockResolvedValue([APPOINTMENT]);

    const res = await request(makeApp()).post('/api/eligibility/batch-verify').send({});

    expect(res.status).toBe(503);
    expect(storageStub.createEligibilityCheck).not.toHaveBeenCalled();
    expect(storageStub.createEligibilityAlert).not.toHaveBeenCalled();
  });

  it('real Stedi success persists the payer response (source: stedi)', async () => {
    storageStub.getPractice.mockResolvedValue({ id: 1, isDemo: false, specialty: 'OT' });
    process.env.STEDI_API_KEY = 'test_key';
    adapterCheckMock.mockResolvedValue({
      eligibility: { isEligible: true, planType: 'PPO', effectiveDate: '2026-01-01', terminationDate: null, planName: 'Aetna PPO', groupNumber: 'G1' },
      benefits: { copay: 25, coinsurance: 20 },
      raw: {},
    });

    const res = await request(makeApp()).post('/api/appointments/5/check-eligibility');

    expect(res.status).toBe(200);
    expect(storageStub.createEligibilityCheck).toHaveBeenCalledTimes(1);
    const saved = storageStub.createEligibilityCheck.mock.calls[0][0];
    expect(saved.copay).toBe('25');
    expect(saved.rawResponse.source).toBe('stedi');
  });
});

describe('demo practice keeps generated data', () => {
  it('appointments check-eligibility returns and persists demo_mock data', async () => {
    // The demo user operates within their own (demo) practice — id 1 here to
    // match the auth mock's userPracticeId. A cross-practice ?practiceId hop is
    // no longer honored (tenant isolation), so the demo scenario is modeled as
    // the user acting in their own demo-flagged practice.
    storageStub.getPractice.mockResolvedValue({ id: 1, isDemo: true });
    storageStub.getAppointment.mockResolvedValue({ ...APPOINTMENT, practiceId: 1 });
    storageStub.getPatient.mockResolvedValue({ ...PATIENT, practiceId: 1 });

    const res = await request(makeApp()).post('/api/appointments/5/check-eligibility');

    expect(res.status).toBe(200);
    expect(storageStub.createEligibilityCheck).toHaveBeenCalledTimes(1);
    const saved = storageStub.createEligibilityCheck.mock.calls[0][0];
    expect(saved.rawResponse.source).toBe('demo_mock');
    // Generated copay stays within the fixed demo menu.
    expect([20, 25, 30, 35, 40, 50]).toContain(Number(saved.copay));
  });
});
