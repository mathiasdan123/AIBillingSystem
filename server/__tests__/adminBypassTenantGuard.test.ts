/**
 * Security audit: `userRole !== 'admin'` was used as a tenant-ownership gate
 * in nine places across claims.ts, appointments.ts and practices.ts. Every
 * practice's own admin has role='admin' - not just the platform/founder
 * admin - so any practice admin could reach another practice's claim,
 * appointment, or practice record by id. Fixed by checking
 * `!req.isPlatformAdmin` instead, consistent with every other correctly-
 * scoped route in the codebase. This file covers the appointments.ts and
 * practices.ts occurrences (claims.ts is covered in
 * claimsAdminBypassAndPreviewCheckStatusGuard.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, authCtx } = vi.hoisted(() => ({
  mockStorage: {
    getAppointment: vi.fn(),
    getPatient: vi.fn(),
    getAppointmentType: vi.fn(),
  },
  authCtx: { role: 'admin', practiceId: 2 as number | null, platformAdmin: false },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { execute: vi.fn(async () => ({ rows: [] })) },
}));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'u1' } };
    req.userPracticeId = authCtx.practiceId;
    req.userRole = authCtx.role;
    req.isPlatformAdmin = authCtx.platformAdmin;
    next();
  },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/stripeService', () => ({
  chargeCopay: vi.fn(), isStripeConfigured: () => true,
  createPatientPaymentLink: vi.fn(), practiceMayCollectPatientPayments: () => true,
}));

import appointmentsRouter from '../routes/appointments';
import practicesRouter from '../routes/practices';

beforeEach(() => {
  vi.clearAllMocks();
  authCtx.role = 'admin';
  authCtx.practiceId = 2;
  authCtx.platformAdmin = false;
});

describe('appointments.ts — self-pay-invoice tenant guard', () => {
  function buildApp(): Express {
    const app = express();
    app.use(express.json());
    app.use('/api/appointments', appointmentsRouter);
    return app;
  }

  it('denies a plain admin self-pay-invoicing another practice\'s appointment', async () => {
    mockStorage.getAppointment.mockResolvedValue({ id: 99, practiceId: 1, patientId: 5 });
    const res = await request(buildApp()).post('/api/appointments/99/self-pay-invoice');
    expect(res.status).toBe(403);
    expect(mockStorage.getPatient).not.toHaveBeenCalled();
  });

  it('allows a platform admin to reach another practice\'s appointment', async () => {
    authCtx.platformAdmin = true;
    mockStorage.getAppointment.mockResolvedValue({ id: 99, practiceId: 1, patientId: 5 });
    mockStorage.getPatient.mockResolvedValue(null); // short-circuits with 400 before Stripe - fine, proves the tenant gate passed
    const res = await request(buildApp()).post('/api/appointments/99/self-pay-invoice');
    expect(res.status).not.toBe(403);
  });
});

describe('practices.ts — patients-missing-plan-documents tenant guard', () => {
  function buildApp(): Express {
    const app = express();
    app.use(express.json());
    app.use('/api/practices', practicesRouter);
    return app;
  }

  it('denies a plain admin viewing another practice\'s missing-documents report', async () => {
    const res = await request(buildApp()).get('/api/practices/1/patients-missing-plan-documents');
    expect(res.status).toBe(403);
  });

  it('allows an admin to view their own practice\'s report', async () => {
    const res = await request(buildApp()).get('/api/practices/2/patients-missing-plan-documents');
    expect(res.status).toBe(200);
  });

  it('allows a platform admin to view another practice\'s report', async () => {
    authCtx.platformAdmin = true;
    const res = await request(buildApp()).get('/api/practices/1/patients-missing-plan-documents');
    expect(res.status).toBe(200);
  });
});
