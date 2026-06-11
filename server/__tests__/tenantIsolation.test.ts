/**
 * Regression guard for the cross-tenant IDOR fixes (adversarial-audit P0 #1-4).
 *
 * Mounts the real patients router and asserts that the router.use('/:id')
 * ownership guard blocks a non-admin user from reaching another practice's
 * patient via a sub-route, and that list/search are scoped to the caller's
 * practice. If someone removes the guard or unscopes the list query, these fail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatient: vi.fn(),
    getAllPatients: vi.fn(),
    countAllPatients: vi.fn(),
    searchPatients: vi.fn(),
    getPatientDocuments: vi.fn(),
    batchGetConsentStatus: vi.fn(),
    createPatient: vi.fn(),
    updatePatient: vi.fn(),
    getPractice: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));

// Non-admin user in practice 1.
let currentUser = { sub: 'user-1', practiceId: 1, role: 'therapist' };
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: currentUser.sub } };
    req.userPracticeId = currentUser.practiceId;
    req.userRole = currentUser.role;
    next();
  },
}));
vi.mock('../middleware/validate', () => ({ validate: () => (_r: any, _s: any, n: any) => n() }));
vi.mock('../middleware/consentCheck', () => ({ requirePatientConsent: (_r: any, _s: any, n: any) => n() }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/emailService', () => ({ sendEmail: vi.fn() }));
vi.mock('../utils/pagination', () => ({
  parsePagination: () => ({ page: 1, limit: 50, offset: 0 }),
  paginatedResponse: (rows: any) => ({ data: rows, page: 1, total: rows.length }),
}));
vi.mock('../db', () => ({ db: {} }));

import patientsRouter from '../routes/patients';

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { sub: 'user-1', practiceId: 1, role: 'therapist' };
  app = express();
  app.use(express.json());
  app.use('/api/patients', patientsRouter);
  mockStorage.batchGetConsentStatus.mockResolvedValue(new Map());
});

describe('tenant isolation — patients router', () => {
  it('blocks a sub-route for a patient in another practice (404, not the data)', async () => {
    // Patient 777 belongs to practice 99; caller is in practice 1.
    mockStorage.getPatient.mockResolvedValue({ id: 777, practiceId: 99 });
    mockStorage.getPatientDocuments.mockResolvedValue([{ id: 1, name: 'secret.pdf' }]);

    const res = await request(app).get('/api/patients/777/documents');

    expect(res.status).toBe(404);
    // The guard must short-circuit before the handler touches the data.
    expect(mockStorage.getPatientDocuments).not.toHaveBeenCalled();
  });

  it('allows a sub-route for a patient in the caller’s own practice', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 5, practiceId: 1 });
    mockStorage.getPatientDocuments.mockResolvedValue([]);

    const res = await request(app).get('/api/patients/5/documents');

    expect(res.status).toBe(200);
    expect(mockStorage.getPatientDocuments).toHaveBeenCalled();
  });

  it('scopes the list endpoint to the caller’s practice', async () => {
    mockStorage.getAllPatients.mockResolvedValue([]);
    await request(app).get('/api/patients');
    expect(mockStorage.getAllPatients).toHaveBeenCalledWith(1, undefined);
  });

  it('scopes search to the caller’s practice', async () => {
    mockStorage.searchPatients.mockResolvedValue([]);
    await request(app).get('/api/patients/search?q=smith');
    expect(mockStorage.searchPatients).toHaveBeenCalledWith(1, 'smith', expect.any(Number));
  });
});
