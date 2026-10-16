/**
 * Security audit F1/F2 fix verification.
 *
 * GET /api/patients/:id/cost-estimate and GET /api/patients/:id/documents
 * previously called storage.getPatient(id)/storage.getPatientDocuments(id)
 * with no check that the patient belonged to the caller's practice — a
 * cross-tenant IDOR (any authenticated user of any practice could read
 * another practice's patient name/insurance/documents by guessing an id).
 * Both routes now route through verifyPatientAccess, the same helper
 * tenantIsolation.test.ts covers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, authCtx } = vi.hoisted(() => ({
  mockStorage: {
    getPatient: vi.fn(),
    getPatientDocuments: vi.fn(),
    getPatientConsents: vi.fn(async () => []),
    hasRequiredTreatmentConsents: vi.fn(async () => ({ hasConsent: true, hasAllConsents: true, missingConsents: [], consentStatus: {} })),
  },
  authCtx: { role: 'therapist', practiceId: 2 as number | null, platformAdmin: false },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({ db: {}, getDb: async () => ({}), dbReady: Promise.resolve() }));
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'u1' } };
    req.userPracticeId = authCtx.practiceId;
    req.userRole = authCtx.role;
    req.isPlatformAdmin = authCtx.platformAdmin;
    next();
  },
}));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/emailService', () => ({ sendEmail: vi.fn() }));
vi.mock('../services/emailTemplates', () => ({ portalWelcome: vi.fn(), intakeSubmissionNotification: vi.fn() }));
vi.mock('../services/insuranceCostEstimator', () => ({ getQuickEstimate: vi.fn(async () => ({ estimatedCost: 100 })) }));

import patientsRouter from '../routes/patients';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/patients', patientsRouter);
  return app;
}

describe('patients tenant guard — cost-estimate and documents (F1/F2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authCtx.role = 'therapist';
    authCtx.practiceId = 2;
    authCtx.platformAdmin = false;
  });

  describe('GET /:id/cost-estimate', () => {
    it('returns 404 for a patient in another practice (cross-tenant IDOR)', async () => {
      mockStorage.getPatient.mockResolvedValue({ id: 99, practiceId: 1, firstName: 'Other', lastName: 'Practice', insuranceProvider: 'Aetna' });
      const res = await request(buildApp()).get('/api/patients/99/cost-estimate');
      expect(res.status).toBe(404);
    });

    it('succeeds for a patient in the caller\'s own practice', async () => {
      mockStorage.getPatient.mockResolvedValue({ id: 11, practiceId: 2, firstName: 'Mine', lastName: 'Patient', insuranceProvider: 'Cigna' });
      const res = await request(buildApp()).get('/api/patients/11/cost-estimate');
      expect(res.status).toBe(200);
      expect(res.body.patient.id).toBe(11);
    });

    it('lets a platform admin reach a patient in another practice', async () => {
      authCtx.role = 'admin';
      authCtx.platformAdmin = true;
      mockStorage.getPatient.mockResolvedValue({ id: 99, practiceId: 1, firstName: 'Other', lastName: 'Practice', insuranceProvider: 'Aetna' });
      const res = await request(buildApp()).get('/api/patients/99/cost-estimate');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /:id/documents', () => {
    it('returns 404 for a patient in another practice (cross-tenant IDOR)', async () => {
      mockStorage.getPatient.mockResolvedValue({ id: 99, practiceId: 1 });
      const res = await request(buildApp()).get('/api/patients/99/documents');
      expect(res.status).toBe(404);
      expect(mockStorage.getPatientDocuments).not.toHaveBeenCalled();
    });

    it('succeeds for a patient in the caller\'s own practice', async () => {
      mockStorage.getPatient.mockResolvedValue({ id: 11, practiceId: 2 });
      mockStorage.getPatientDocuments.mockResolvedValue([{ id: 1, name: 'doc.pdf' }]);
      const res = await request(buildApp()).get('/api/patients/11/documents');
      expect(res.status).toBe(200);
      expect(mockStorage.getPatientDocuments).toHaveBeenCalledWith(11);
    });
  });
});
