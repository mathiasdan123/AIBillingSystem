/**
 * Security audit F3 fix verification.
 *
 * GET /patients/:patientId/plan-documents, GET .../plan-benefits,
 * POST .../plan-benefits/:benefitsId/verify, PATCH .../plan-benefits/:benefitsId,
 * and POST .../oon-predict checked only `user.role === 'admin'` — never that
 * the patient (or benefits record) belonged to that admin's own practice.
 * Since ids are sequential integers, any admin could enumerate another
 * practice's patient plan documents/benefits. All five now also verify
 * patient.practiceId === user.practiceId (and, for the two benefitsId-keyed
 * routes, that the benefits row actually belongs to that patient).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getUser: vi.fn(),
    getPatient: vi.fn(),
    getPlanDocuments: vi.fn(),
    getPatientPlanBenefits: vi.fn(),
    getAllPatientPlanBenefits: vi.fn(),
    verifyPlanBenefits: vi.fn(),
    updatePlanBenefits: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'u1' } };
    next();
  },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../payer-integrations/adapters/payers/StediAdapter', () => ({ StediAdapter: class {} }));
vi.mock('../services/planDocumentParser', () => ({
  parsePlanDocument: vi.fn(), parsePlanDocumentFromPDF: vi.fn(), benefitsToInsertFormat: vi.fn(),
}));
vi.mock('../services/insuranceCostEstimator', () => ({
  parseInsuranceContract: vi.fn(), saveContractRates: vi.fn(), estimatePatientCost: vi.fn(), getQuickEstimate: vi.fn(),
}));
vi.mock('../services/oonReimbursementPredictor', () => ({ predictOONReimbursement: vi.fn(() => ({ estimatedReimbursement: 0 })) }));
vi.mock('../middleware/rate-limiter', () => ({ uploadLimiter: (_r: any, _s: any, n: any) => n() }));
vi.mock('../middleware/file-validator', () => ({
  createFileValidator: () => (_r: any, _s: any, n: any) => n(),
  FileValidationContexts: { INSURANCE_CONTRACT: 'insurance_contract' },
}));
vi.mock('../services/cacheService', () => ({
  cache: { get: async () => null, set: async () => {}, del: async () => {} },
  CacheKeys: new Proxy({}, { get: () => () => 'k' }),
  CacheTTL: new Proxy({}, { get: () => 60 }),
}));
vi.mock('../middleware/financial-access', () => ({ requireFinancialRole: (_r: any, _s: any, n: any) => n() }));

import insuranceRouter from '../routes/insurance';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', insuranceRouter);
  return app;
}

const ADMIN_PRACTICE_1 = { id: 'u1', role: 'admin', practiceId: 1 };
const PATIENT_IN_PRACTICE_2 = { id: 50, practiceId: 2, insuranceProvider: 'Aetna', address: '1 Main St' };
const PATIENT_IN_PRACTICE_1 = { id: 11, practiceId: 1, insuranceProvider: 'Cigna', address: '2 Oak St' };

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getUser.mockResolvedValue(ADMIN_PRACTICE_1);
});

describe('F3 — plan-documents/plan-benefits/oon-predict tenant guard', () => {
  it('GET plan-documents: denies a patient in another practice', async () => {
    mockStorage.getPatient.mockResolvedValue(PATIENT_IN_PRACTICE_2);
    const res = await request(buildApp()).get('/api/patients/50/plan-documents');
    expect(res.status).toBe(404);
    expect(mockStorage.getPlanDocuments).not.toHaveBeenCalled();
  });

  it('GET plan-documents: allows a patient in the admin\'s own practice', async () => {
    mockStorage.getPatient.mockResolvedValue(PATIENT_IN_PRACTICE_1);
    mockStorage.getPlanDocuments.mockResolvedValue([]);
    const res = await request(buildApp()).get('/api/patients/11/plan-documents');
    expect(res.status).toBe(200);
  });

  it('GET plan-benefits: denies a patient in another practice', async () => {
    mockStorage.getPatient.mockResolvedValue(PATIENT_IN_PRACTICE_2);
    const res = await request(buildApp()).get('/api/patients/50/plan-benefits');
    expect(res.status).toBe(404);
    expect(mockStorage.getPatientPlanBenefits).not.toHaveBeenCalled();
  });

  it('POST plan-benefits/:benefitsId/verify: denies a patient in another practice', async () => {
    mockStorage.getPatient.mockResolvedValue(PATIENT_IN_PRACTICE_2);
    const res = await request(buildApp()).post('/api/patients/50/plan-benefits/5/verify');
    expect(res.status).toBe(404);
    expect(mockStorage.verifyPlanBenefits).not.toHaveBeenCalled();
  });

  it('POST plan-benefits/:benefitsId/verify: denies a benefitsId not belonging to this patient, even within the caller\'s own practice', async () => {
    mockStorage.getPatient.mockResolvedValue(PATIENT_IN_PRACTICE_1);
    mockStorage.getAllPatientPlanBenefits.mockResolvedValue([{ id: 999 }]); // benefitsId 5 not in this list
    const res = await request(buildApp()).post('/api/patients/11/plan-benefits/5/verify');
    expect(res.status).toBe(404);
    expect(mockStorage.verifyPlanBenefits).not.toHaveBeenCalled();
  });

  it('POST plan-benefits/:benefitsId/verify: allows a matching benefitsId in the admin\'s own practice', async () => {
    mockStorage.getPatient.mockResolvedValue(PATIENT_IN_PRACTICE_1);
    mockStorage.getAllPatientPlanBenefits.mockResolvedValue([{ id: 5 }]);
    mockStorage.verifyPlanBenefits.mockResolvedValue({ id: 5, verified: true });
    const res = await request(buildApp()).post('/api/patients/11/plan-benefits/5/verify');
    expect(res.status).toBe(200);
    expect(mockStorage.verifyPlanBenefits).toHaveBeenCalledWith(5, 'u1');
  });

  it('PATCH plan-benefits/:benefitsId: denies a patient in another practice', async () => {
    mockStorage.getPatient.mockResolvedValue(PATIENT_IN_PRACTICE_2);
    const res = await request(buildApp()).patch('/api/patients/50/plan-benefits/5').send({ planName: 'x' });
    expect(res.status).toBe(404);
    expect(mockStorage.updatePlanBenefits).not.toHaveBeenCalled();
  });

  it('POST oon-predict: denies a patient in another practice', async () => {
    mockStorage.getPatient.mockResolvedValue(PATIENT_IN_PRACTICE_2);
    const res = await request(buildApp()).post('/api/patients/50/oon-predict').send({ cptCode: '97530', billedAmount: 100 });
    expect(res.status).toBe(404);
    expect(mockStorage.getPatientPlanBenefits).not.toHaveBeenCalled();
  });

  it('POST oon-predict: allows a patient in the admin\'s own practice', async () => {
    mockStorage.getPatient.mockResolvedValue(PATIENT_IN_PRACTICE_1);
    mockStorage.getPatientPlanBenefits.mockResolvedValue(null);
    const res = await request(buildApp()).post('/api/patients/11/oon-predict').send({ cptCode: '97530', billedAmount: 100 });
    expect(res.status).toBe(200);
  });
});
