/**
 * Tests that POST /api/patients (the staff-facing intake wizard's submit
 * endpoint) turns the wizard's HIPAA/Waiver/Financial signatures into real
 * patientConsents rows — previously these only lived as a typed name inside
 * intakeData's jsonb blob, never written to the auditable consents table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    createPatient: vi.fn(),
    createPatientConsent: vi.fn(),
    getPractice: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'staff-user-1', email: 'jessann@wonderkidstc.com' } };
    req.userPracticeId = 1;
    req.userRole = 'billing';
    next();
  },
}));
vi.mock('../middleware/validate', () => ({
  validate: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../middleware/consentCheck', () => ({
  requirePatientConsent: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/emailService', () => ({ sendEmail: vi.fn() }));

import patientsRouter from '../routes/patients';

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/patients', patientsRouter);
  mockStorage.createPatient.mockImplementation(async (p: any) => ({ id: 70, practiceId: 1, ...p }));
  mockStorage.getPractice.mockResolvedValue({ id: 1, name: 'Wonder Kids', email: null });
});

const baseIntake = {
  firstName: 'Sophie',
  lastName: 'Friedman',
  practiceId: 1,
  intakeData: {
    consents: {
      hipaa: { signed: true, signature: 'Michael Friedman', date: '2026-07-30' },
      waiver: { signed: true, signature: 'Michael Friedman', date: '2026-07-30' },
      financial: { signed: true, signature: 'Michael Friedman', date: '2026-07-30' },
    },
  },
};

describe('POST /api/patients — consent wiring', () => {
  it('creates a real patientConsents row for each signed step', async () => {
    const res = await request(app).post('/api/patients').send(baseIntake);
    expect(res.status).toBe(200);
    expect(mockStorage.createPatientConsent).toHaveBeenCalledTimes(3);

    const types = mockStorage.createPatientConsent.mock.calls.map((c: any[]) => c[0].consentType).sort();
    expect(types).toEqual(['financial_responsibility', 'hipaa_privacy_practices', 'waiver_release']);

    const hipaaCall = mockStorage.createPatientConsent.mock.calls.find(
      (c: any[]) => c[0].consentType === 'hipaa_privacy_practices',
    )![0];
    expect(hipaaCall.patientId).toBe(70);
    expect(hipaaCall.practiceId).toBe(1);
    expect(hipaaCall.signatureName).toBe('Michael Friedman');
    expect(hipaaCall.signatureType).toBe('electronic');
    expect(hipaaCall.purposeOfDisclosure).toBeTruthy();
    expect(hipaaCall.notes).toContain('jessann@wonderkidstc.com');
  });

  it('skips a step that was not actually signed', async () => {
    const res = await request(app)
      .post('/api/patients')
      .send({
        ...baseIntake,
        intakeData: {
          consents: {
            hipaa: { signed: true, signature: 'Michael Friedman', date: '2026-07-30' },
            waiver: { signed: false, signature: '', date: '' },
            financial: { signed: true, signature: '', date: '2026-07-30' }, // signed but no typed name
          },
        },
      });
    expect(res.status).toBe(200);
    expect(mockStorage.createPatientConsent).toHaveBeenCalledTimes(1);
    expect(mockStorage.createPatientConsent.mock.calls[0][0].consentType).toBe('hipaa_privacy_practices');
  });

  it('creates no consent rows when intakeData has no consents object (e.g. a bare API create)', async () => {
    const res = await request(app)
      .post('/api/patients')
      .send({ firstName: 'X', lastName: 'Y', practiceId: 1 });
    expect(res.status).toBe(200);
    expect(mockStorage.createPatientConsent).not.toHaveBeenCalled();
  });

  it('still returns the created patient even if consent recording throws', async () => {
    mockStorage.createPatientConsent.mockRejectedValue(new Error('db down'));
    const res = await request(app).post('/api/patients').send(baseIntake);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(70);
  });
});
