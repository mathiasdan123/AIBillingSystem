/**
 * Tests for the two "migrated consent" endpoints — attesting that a
 * patient already consented some other way before this system existed
 * (paper intake, a prior EHR, etc), distinct from a live e-signature:
 *   - POST /api/patients/:id/consents/migrate (one patient at a time)
 *   - POST /api/data-import/consents/migrate (bulk, after a CSV import)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatient: vi.fn(),
    createPatientConsent: vi.fn(),
    updatePatient: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'staff-user-1' } };
    req.userPracticeId = 1;
    req.userRole = 'billing';
    next();
  },
}));
vi.mock('../middleware/validate', () => ({ validate: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../middleware/consentCheck', () => ({ requirePatientConsent: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/emailService', () => ({ sendEmail: vi.fn() }));

describe('POST /api/patients/:id/consents/migrate', () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    const patientsRouter = (await import('../routes/patients')).default;
    app = express();
    app.use(express.json());
    app.use('/api/patients', patientsRouter);
    mockStorage.createPatientConsent.mockImplementation(async (c: any) => ({ id: 1, ...c }));
    mockStorage.updatePatient.mockResolvedValue({ id: 70 });
  });

  it('flips smsConsentGiven on the patient when sms_reminders is one of the migrated types', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 70, practiceId: 1 });
    const res = await request(app)
      .post('/api/patients/70/consents/migrate')
      .send({
        consentTypes: ['hipaa_privacy_practices', 'sms_reminders'],
        signatureName: 'Michael Friedman',
        originalDate: '2025-03-12',
        attestationSource: 'Paper intake on file at first visit',
      });
    expect(res.status).toBe(200);
    expect(mockStorage.updatePatient).toHaveBeenCalledWith(
      70,
      expect.objectContaining({ smsConsentGiven: true }),
    );
  });

  it('does not touch smsConsentGiven when sms_reminders is not among the migrated types', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 70, practiceId: 1 });
    const res = await request(app)
      .post('/api/patients/70/consents/migrate')
      .send({
        consentTypes: ['hipaa_privacy_practices'],
        signatureName: 'Michael Friedman',
        originalDate: '2025-03-12',
        attestationSource: 'Paper intake on file at first visit',
      });
    expect(res.status).toBe(200);
    expect(mockStorage.updatePatient).not.toHaveBeenCalled();
  });

  it('creates one consent row per requested type, tagged as migrated', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 70, practiceId: 1 });
    const res = await request(app)
      .post('/api/patients/70/consents/migrate')
      .send({
        consentTypes: ['hipaa_privacy_practices', 'waiver_release'],
        signatureName: 'Michael Friedman',
        originalDate: '2025-03-12',
        attestationSource: 'Paper intake on file at first visit',
      });
    expect(res.status).toBe(200);
    expect(mockStorage.createPatientConsent).toHaveBeenCalledTimes(2);
    const call = mockStorage.createPatientConsent.mock.calls[0][0];
    expect(call.signatureType).toBe('migrated');
    expect(call.signatureIpAddress).toBeNull();
    expect(call.attestationSource).toBe('Paper intake on file at first visit');
    expect(call.attestedByUserId).toBe('staff-user-1');
    expect(call.effectiveDate).toBe('2025-03-12');
  });

  it('rejects an unknown consent type', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 70, practiceId: 1 });
    const res = await request(app)
      .post('/api/patients/70/consents/migrate')
      .send({
        consentTypes: ['not_a_real_type'],
        signatureName: 'X',
        originalDate: '2025-03-12',
        attestationSource: 'Y',
      });
    expect(res.status).toBe(400);
    expect(mockStorage.createPatientConsent).not.toHaveBeenCalled();
  });

  it('rejects when required fields are missing', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 70, practiceId: 1 });
    const res = await request(app)
      .post('/api/patients/70/consents/migrate')
      .send({ consentTypes: ['hipaa_privacy_practices'] });
    expect(res.status).toBe(400);
    expect(mockStorage.createPatientConsent).not.toHaveBeenCalled();
  });

  it('404s for a patient in a different practice (tenant guard)', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 70, practiceId: 99 });
    const res = await request(app)
      .post('/api/patients/70/consents/migrate')
      .send({
        consentTypes: ['hipaa_privacy_practices'],
        signatureName: 'X',
        originalDate: '2025-03-12',
        attestationSource: 'Y',
      });
    expect(res.status).toBe(404);
    expect(mockStorage.createPatientConsent).not.toHaveBeenCalled();
  });
});

describe('POST /api/data-import/consents/migrate', () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dataImportRouter = (await import('../routes/data-import')).default;
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { claims: { sub: 'staff-user-1' } };
      req.userPracticeId = 1;
      req.userRole = 'billing';
      next();
    });
    app.use('/api/data-import', dataImportRouter);
    mockStorage.createPatientConsent.mockImplementation(async (c: any) => ({ id: 1, ...c }));
    mockStorage.updatePatient.mockResolvedValue({ id: 1 });
  });

  it('flips smsConsentGiven on every selected patient when sms_reminders is among the migrated types', async () => {
    mockStorage.getPatient.mockImplementation(async (id: number) => ({ id, practiceId: 1 }));
    const res = await request(app)
      .post('/api/data-import/consents/migrate')
      .send({
        patientIds: [10, 11],
        consentTypes: ['hipaa_privacy_practices', 'sms_reminders'],
        signatureName: 'Various',
        originalDate: '2026-01-01',
        attestationSource: 'Migrated from SimplePractice',
      });
    expect(res.status).toBe(200);
    expect(mockStorage.updatePatient).toHaveBeenCalledTimes(2);
    expect(mockStorage.updatePatient).toHaveBeenCalledWith(10, expect.objectContaining({ smsConsentGiven: true }));
    expect(mockStorage.updatePatient).toHaveBeenCalledWith(11, expect.objectContaining({ smsConsentGiven: true }));
  });

  it('creates consents for every selected patient and consent type', async () => {
    mockStorage.getPatient.mockImplementation(async (id: number) => ({ id, practiceId: 1 }));
    const res = await request(app)
      .post('/api/data-import/consents/migrate')
      .send({
        patientIds: [10, 11],
        consentTypes: ['hipaa_privacy_practices', 'waiver_release'],
        signatureName: 'Various',
        originalDate: '2026-01-01',
        attestationSource: 'Migrated from SimplePractice',
      });
    expect(res.status).toBe(200);
    expect(res.body.consentsCreated).toBe(4); // 2 patients x 2 types
    expect(res.body.skippedPatientIds).toEqual([]);
  });

  it('skips (does not error on) a patient id from a different practice', async () => {
    mockStorage.getPatient.mockImplementation(async (id: number) =>
      id === 10 ? { id, practiceId: 1 } : { id, practiceId: 99 },
    );
    const res = await request(app)
      .post('/api/data-import/consents/migrate')
      .send({
        patientIds: [10, 20],
        consentTypes: ['hipaa_privacy_practices'],
        signatureName: 'Various',
        originalDate: '2026-01-01',
        attestationSource: 'Migrated from SimplePractice',
      });
    expect(res.status).toBe(200);
    expect(res.body.consentsCreated).toBe(1);
    expect(res.body.skippedPatientIds).toEqual([20]);
  });

  it('rejects an empty patientIds array', async () => {
    const res = await request(app)
      .post('/api/data-import/consents/migrate')
      .send({
        patientIds: [],
        consentTypes: ['hipaa_privacy_practices'],
        signatureName: 'X',
        originalDate: '2026-01-01',
        attestationSource: 'Y',
      });
    expect(res.status).toBe(400);
    expect(mockStorage.createPatientConsent).not.toHaveBeenCalled();
  });
});
