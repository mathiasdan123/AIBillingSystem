/**
 * Security audit fixes, two bugs in server/routes/claims.ts:
 *
 * 1. (New finding, found while fixing F4) Nine routes/middleware across
 *    claims.ts, appointments.ts and practices.ts used `userRole !== 'admin'`
 *    as their tenant-ownership gate. Every PRACTICE's own admin has
 *    role='admin' — not just the platform/founder admin — so any practice
 *    admin could reach any other practice's claim by id. Fixed by switching
 *    to `!req.isPlatformAdmin`, the property every other correctly-scoped
 *    route in this codebase already uses for this exact distinction.
 *
 * 2. (F4, F5 from the audit report) GET /:id/preview-payload and
 *    POST /:id/check-status had no tenant check at all (not even the buggy
 *    admin-bypass one) before assembling/querying another practice's claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, authCtx } = vi.hoisted(() => ({
  mockStorage: {
    getClaim: vi.fn(),
    getClaimLineItems: vi.fn(async () => []),
    getPatient: vi.fn(),
    getPractice: vi.fn(),
    getInsurance: vi.fn(),
    getCptCodes: vi.fn(async () => []),
    getIcd10Codes: vi.fn(async () => []),
  },
  authCtx: { role: 'admin', practiceId: 2 as number | null, platformAdmin: false },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'u1' } };
    req.userPracticeId = authCtx.practiceId;
    req.userRole = authCtx.role;
    req.isPlatformAdmin = authCtx.platformAdmin;
    next();
  },
}));
vi.mock('../aiClaimOptimizer', () => ({ AiClaimOptimizer: class { async optimize() { return {}; } } }));
vi.mock('../aiAppealGenerator', () => ({ appealGenerator: { generate: vi.fn() } }));
vi.mock('../services/claimLifecycleService', () => ({ listLifecycleClaims: vi.fn(async () => []) }));
vi.mock('../services/stediService', () => ({
  getStediApiKeyForPractice: vi.fn(async () => ({ apiKey: 'test-key' })),
  checkClaimStatus: vi.fn(async () => ({ status: 'pending' })),
  parseOneLineAddress: vi.fn(() => ({ line1: '', city: '', state: '', zip: '' })),
}));
vi.mock('../services/stripeService', () => ({
  chargeCopay: vi.fn(), isStripeConfigured: () => false,
  createPatientPaymentLink: vi.fn(), practiceMayCollectPatientPayments: () => true,
}));
vi.mock('./payerContracts', () => ({ checkClaimUnderpayment: vi.fn() }));

import claimsRouter from '../routes/claims';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/claims', claimsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  authCtx.role = 'admin';
  authCtx.practiceId = 2;
  authCtx.platformAdmin = false;
});

describe('admin-bypass fix — a practice admin (not platform admin) is still tenant-scoped', () => {
  it('GET /:id — 404s another practice\'s claim for a plain admin', async () => {
    mockStorage.getClaim.mockResolvedValue({ id: 99, practiceId: 1, status: 'draft' });
    const res = await request(buildApp()).get('/api/claims/99');
    expect(res.status).toBe(404);
  });

  it('GET /:id/line-items — denies another practice\'s claim for a plain admin', async () => {
    mockStorage.getClaim.mockResolvedValue({ id: 99, practiceId: 1, status: 'draft' });
    const res = await request(buildApp()).get('/api/claims/99/line-items');
    // The router.use('/:id', ...) guard (also fixed) intercepts first and
    // 404s before the line-items handler's own 403 check ever runs - both
    // layers now correctly deny, 404 just wins by running first.
    expect(res.status).toBe(404);
    expect(mockStorage.getClaimLineItems).not.toHaveBeenCalled();
  });

  it('a platform admin can still reach another practice\'s claim', async () => {
    authCtx.platformAdmin = true;
    mockStorage.getClaim.mockResolvedValue({ id: 99, practiceId: 1, status: 'draft' });
    const res = await request(buildApp()).get('/api/claims/99/line-items');
    expect(res.status).toBe(200);
  });

  it('an admin can still reach their own practice\'s claim', async () => {
    mockStorage.getClaim.mockResolvedValue({ id: 11, practiceId: 2, status: 'draft' });
    const res = await request(buildApp()).get('/api/claims/11/line-items');
    expect(res.status).toBe(200);
  });
});

describe('F4 — GET /:id/preview-payload tenant guard', () => {
  it('404s a claim belonging to another practice, before touching patient/insurance data', async () => {
    mockStorage.getClaim.mockResolvedValue({ id: 99, practiceId: 1, patientId: 50, insuranceId: 7 });
    const res = await request(buildApp()).get('/api/claims/99/preview-payload');
    expect(res.status).toBe(404);
    expect(mockStorage.getPatient).not.toHaveBeenCalled();
    expect(mockStorage.getInsurance).not.toHaveBeenCalled();
  });
});

describe('F5 — POST /:id/check-status tenant guard', () => {
  it('404s a claim belonging to another practice, before querying the clearinghouse', async () => {
    mockStorage.getClaim.mockResolvedValue({ id: 99, practiceId: 1, status: 'submitted', patientId: 50 });
    const res = await request(buildApp()).post('/api/claims/99/check-status');
    expect(res.status).toBe(404);
    expect(mockStorage.getPatient).not.toHaveBeenCalled();
  });
});
