/**
 * POST /api/claims tenant guard (2026-11-18): storage.createClaim is a plain
 * insert and the schema only checks patientId is a positive integer, so a
 * claim could be filed under the caller's practice for another practice's
 * patient. The route now requires the patient to exist in the caller's
 * practice (404 otherwise, so cross-practice ids are not confirmed) and
 * creates nothing when it does not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  getPatient: vi.fn(),
  createClaim: vi.fn(),
  optimizeClaim: vi.fn(),
}));

vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.userPracticeId = 1;
    req.userRole = 'billing';
    req.user = { claims: { sub: 'u1' } };
    next();
  },
}));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../db', () => ({ db: {}, getDb: () => ({}), getPool: async () => ({}) }));
vi.mock('../storage', () => ({
  storage: {
    getPatient: H.getPatient,
    createClaim: H.createClaim,
    getUser: vi.fn(async () => ({ id: 'u1', role: 'billing', practiceId: 1 })),
    getSoapNotes: vi.fn(async () => [{ id: 5, sessionId: 77, practiceId: 1 }]),
    getPatients: vi.fn(async () => []),
    getInsurance: vi.fn(async () => ({ id: 3, name: 'Aetna' })),
  },
}));
vi.mock('../services/stripeService', () => ({
  chargeCopay: vi.fn(),
  isStripeConfigured: () => false,
  createPatientPaymentLink: vi.fn(),
}));
vi.mock('../aiClaimOptimizer', () => ({
  AiClaimOptimizer: class {
    async optimizeClaim(...args: any[]) {
      H.optimizeClaim(...args);
      return { aiReviewScore: 90, aiReviewNotes: '' };
    }
  },
}));
vi.mock('../aiAppealGenerator', () => ({ appealGenerator: {} }));
vi.mock('./payerContracts', () => ({ checkClaimUnderpayment: vi.fn() }));
vi.mock('../routes/payerContracts', () => ({ checkClaimUnderpayment: vi.fn() }));

import claimsRouter from '../routes/claims';

const OWN_PATIENT = { id: 10, practiceId: 1, firstName: 'Jude', lastName: 'Spero', archivedAt: null };
const OTHER_PRACTICE_PATIENT = { id: 99, practiceId: 2, firstName: 'Ava', lastName: 'Sample', archivedAt: null };

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  H.getPatient.mockImplementation(async (id: number) =>
    id === OWN_PATIENT.id ? OWN_PATIENT : id === OTHER_PRACTICE_PATIENT.id ? OTHER_PRACTICE_PATIENT : undefined,
  );
  H.createClaim.mockImplementation(async (d: any) => ({ id: 1, ...d }));
  app = express();
  app.use(express.json());
  app.use('/api/claims', claimsRouter);
});

describe('POST /api/claims tenant guard', () => {
  it("returns 404 for another practice's patient and creates nothing", async () => {
    const res = await request(app).post('/api/claims').send({ patientId: OTHER_PRACTICE_PATIENT.id, totalAmount: 300 });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Patient not found');
    expect(H.createClaim).not.toHaveBeenCalled();
    expect(H.optimizeClaim).not.toHaveBeenCalled();
  });

  it('returns 404 for a patient id that does not exist and creates nothing', async () => {
    const res = await request(app).post('/api/claims').send({ patientId: 12345, totalAmount: 300 });
    expect(res.status).toBe(404);
    expect(H.createClaim).not.toHaveBeenCalled();
  });

  it("the AI review never runs for another practice's patient, even with a session", async () => {
    const res = await request(app).post('/api/claims').send({ patientId: OTHER_PRACTICE_PATIENT.id, totalAmount: 300, sessionId: 77 });
    expect(res.status).toBe(404);
    expect(H.optimizeClaim).not.toHaveBeenCalled();
  });

  it("creates the claim for the caller's own patient, with the session's AI review", async () => {
    const res = await request(app).post('/api/claims').send({ patientId: OWN_PATIENT.id, totalAmount: 300, sessionId: 77 });
    expect([200, 201]).toContain(res.status);
    expect(H.createClaim).toHaveBeenCalledTimes(1);
    expect(H.createClaim.mock.calls[0][0]).toMatchObject({ practiceId: 1, patientId: OWN_PATIENT.id });
    expect(H.optimizeClaim).toHaveBeenCalledTimes(1);
  });

  it('still refuses an archived patient of the caller practice with 400', async () => {
    H.getPatient.mockResolvedValue({ ...OWN_PATIENT, archivedAt: new Date('2026-11-18T15:00:00Z') });
    const res = await request(app).post('/api/claims').send({ patientId: OWN_PATIENT.id, totalAmount: 300 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/archived/i);
    expect(H.createClaim).not.toHaveBeenCalled();
  });
});
