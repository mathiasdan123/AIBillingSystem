/**
 * Tests for PATCH /api/patients/:id/insurance — the endpoint behind the
 * patient-detail "Edit insurance" form and the fix-from-claim-error modal.
 *
 * Mounts the real patientsRouter (no shadow handlers) so the field allowlist
 * and tenant guard exercised here are exactly what production runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatient: vi.fn(),
    updatePatient: vi.fn(),
    // Surface enough of the rest of storage to keep the router import happy.
    createPatient: vi.fn(),
    getPractice: vi.fn(),
    getAllPatients: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'user-1' } };
    req.userPracticeId = 1;
    req.userRole = 'admin';
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
vi.mock('../utils/pagination', () => ({
  parsePagination: () => ({ page: 1, pageSize: 50, offset: 0 }),
  paginatedResponse: (rows: any) => ({ data: rows, page: 1, total: rows.length }),
}));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));

import patientsRouter from '../routes/patients';

const PATIENT_ID = 42;
const PRACTICE_ID = 1;
const OTHER_PRACTICE = 99;

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/api/patients', patientsRouter);
  mockStorage.updatePatient.mockImplementation(async (id: number, patch: any) => ({ id, ...patch }));
});

describe('PATCH /api/patients/:id/insurance', () => {
  it('persists allowed insurance fields', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, practiceId: PRACTICE_ID });
    const res = await request(app)
      .patch(`/api/patients/${PATIENT_ID}/insurance`)
      .send({
        insuranceProvider: 'Aetna',
        insuranceId: 'MEMBER123',
        policyNumber: 'POLICY-AA',
        effectiveDate: '2026-01-01',
        terminationDate: '2026-12-31',
      });
    expect(res.status).toBe(200);
    const patch = mockStorage.updatePatient.mock.calls[0][1];
    expect(patch).toEqual({
      insuranceProvider: 'Aetna',
      insuranceId: 'MEMBER123',
      policyNumber: 'POLICY-AA',
      effectiveDate: '2026-01-01',
      terminationDate: '2026-12-31',
    });
  });

  it('drops non-insurance fields from the patch (allowlist)', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, practiceId: PRACTICE_ID });
    const res = await request(app)
      .patch(`/api/patients/${PATIENT_ID}/insurance`)
      .send({
        insuranceProvider: 'Cigna',
        firstName: 'EVIL',
        ssn: '000-00-0000',
        practiceId: OTHER_PRACTICE, // attempt to reassign tenancy
      });
    expect(res.status).toBe(200);
    const patch = mockStorage.updatePatient.mock.calls[0][1];
    expect(patch).toEqual({ insuranceProvider: 'Cigna' });
    expect(patch).not.toHaveProperty('firstName');
    expect(patch).not.toHaveProperty('ssn');
    expect(patch).not.toHaveProperty('practiceId');
  });

  it('normalizes empty strings to null so a Clear gesture wipes the column', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, practiceId: PRACTICE_ID });
    await request(app)
      .patch(`/api/patients/${PATIENT_ID}/insurance`)
      .send({ terminationDate: '', groupNumber: '' });
    const patch = mockStorage.updatePatient.mock.calls[0][1];
    expect(patch).toEqual({ terminationDate: null, groupNumber: null });
  });

  it('rejects 404 when patient does not exist', async () => {
    mockStorage.getPatient.mockResolvedValue(undefined);
    const res = await request(app)
      .patch(`/api/patients/${PATIENT_ID}/insurance`)
      .send({ insuranceProvider: 'X' });
    expect(res.status).toBe(404);
    expect(mockStorage.updatePatient).not.toHaveBeenCalled();
  });

  it('rejects 403 when patient is in a different practice', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, practiceId: OTHER_PRACTICE });
    const res = await request(app)
      .patch(`/api/patients/${PATIENT_ID}/insurance`)
      .send({ insuranceProvider: 'X' });
    expect(res.status).toBe(403);
    expect(mockStorage.updatePatient).not.toHaveBeenCalled();
  });

  it('rejects 400 when no insurance fields are supplied (all fields filtered out)', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, practiceId: PRACTICE_ID });
    const res = await request(app)
      .patch(`/api/patients/${PATIENT_ID}/insurance`)
      .send({ firstName: 'Nope' });
    expect(res.status).toBe(400);
    expect(mockStorage.updatePatient).not.toHaveBeenCalled();
  });

  it('rejects 400 on a non-numeric patient id', async () => {
    const res = await request(app)
      .patch(`/api/patients/abc/insurance`)
      .send({ insuranceProvider: 'X' });
    expect(res.status).toBe(400);
  });
});
