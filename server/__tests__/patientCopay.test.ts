/**
 * A practice can record a patient's copay, and it sticks.
 *
 * Copay was previously derivable ONLY from an eligibility response. When the
 * payer returned no copay, returned a wrong one, or the patient was self-pay,
 * nobody could record the real amount — front-desk staff could override it in
 * the moment, one visit at a time, and the correction was forgotten by the
 * next check-in.
 *
 * The amount reaches a card charge, so it is validated rather than trusted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatient: vi.fn(),
    updatePatient: vi.fn(),
    createPatient: vi.fn(),
    getPractice: vi.fn(),
    getAllPatients: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'u1' } };
    req.userPracticeId = 1;
    req.userRole = 'admin';
    req.isPlatformAdmin = false;
    next();
  },
}));
vi.mock('../middleware/validate', () => ({ validate: () => (_r: any, _s: any, n: any) => n() }));
vi.mock('../middleware/consentCheck', () => ({ requirePatientConsent: (_r: any, _s: any, n: any) => n() }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/emailService', () => ({ sendEmail: vi.fn() }));
vi.mock('../utils/pagination', () => ({
  parsePagination: () => ({ page: 1, pageSize: 50, offset: 0 }),
  paginatedResponse: (rows: any) => ({ data: rows, page: 1, total: rows.length }),
}));

import patientsRouter from '../routes/patients';

const PATIENT_ID = 42;
let app: Express;

beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/api/patients', patientsRouter);
  mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, practiceId: 1 });
  mockStorage.updatePatient.mockImplementation(async (id: number, patch: any) => ({ id, ...patch }));
});

describe('PATCH /api/patients/:id/insurance — copayAmount', () => {
  it('records a copay the practice sets', async () => {
    const res = await request(app)
      .patch(`/api/patients/${PATIENT_ID}/insurance`)
      .send({ copayAmount: '30' });

    expect(res.status).toBe(200);
    expect(mockStorage.updatePatient.mock.calls[0][1]).toEqual({ copayAmount: '30.00' });
  });

  it('accepts a typed dollar sign rather than rejecting the staff member', async () => {
    await request(app)
      .patch(`/api/patients/${PATIENT_ID}/insurance`)
      .send({ copayAmount: '$250.50' });

    expect(mockStorage.updatePatient.mock.calls[0][1].copayAmount).toBe('250.50');
  });

  it('accepts a comma-grouped amount at the top of the allowed range', async () => {
    await request(app)
      .patch(`/api/patients/${PATIENT_ID}/insurance`)
      .send({ copayAmount: '1,000' });

    // $1,000 is the boundary: allowed. Anything above it is refused below.
    expect(mockStorage.updatePatient.mock.calls[0][1].copayAmount).toBe('1000.00');
  });

  it('clears the copay so it falls back to the eligibility figure', async () => {
    await request(app)
      .patch(`/api/patients/${PATIENT_ID}/insurance`)
      .send({ copayAmount: '' });

    // null, not "0.00" — a $0 copay and "we do not know" are different states.
    expect(mockStorage.updatePatient.mock.calls[0][1]).toEqual({ copayAmount: null });
  });

  it('rejects a negative copay', async () => {
    const res = await request(app)
      .patch(`/api/patients/${PATIENT_ID}/insurance`)
      .send({ copayAmount: '-10' });

    expect(res.status).toBe(400);
    expect(mockStorage.updatePatient).not.toHaveBeenCalled();
  });

  it('rejects a fat-fingered amount before it can reach a card', async () => {
    const res = await request(app)
      .patch(`/api/patients/${PATIENT_ID}/insurance`)
      .send({ copayAmount: '3000' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/check the amount/i);
    expect(mockStorage.updatePatient).not.toHaveBeenCalled();
  });

  it('rejects text that would otherwise become a $0 copay', async () => {
    const res = await request(app)
      .patch(`/api/patients/${PATIENT_ID}/insurance`)
      .send({ copayAmount: 'thirty' });

    expect(res.status).toBe(400);
    expect(mockStorage.updatePatient).not.toHaveBeenCalled();
  });
});
