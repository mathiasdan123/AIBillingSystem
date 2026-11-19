/**
 * Appointment tenant guards apply to every caller except the platform admin.
 *
 * The router-level guards for /:id and /series/:seriesId only ran their
 * practice check for non-admin roles. Every practice's own admin has role
 * 'admin', so a practice admin could read or change another practice's
 * appointments and series by id. The guards now key on req.isPlatformAdmin,
 * the same rule the patients and claims guards use.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, authCtx } = vi.hoisted(() => ({
  mockStorage: {
    getAppointment: vi.fn(),
    updateAppointment: vi.fn(),
    getAppointmentsBySeriesId: vi.fn(),
    deleteSeriesBySeriesId: vi.fn(),
    updateSeriesBySeriesId: vi.fn(),
    cancelSeriesBySeriesId: vi.fn(),
    getPatient: vi.fn(),
    getPractice: vi.fn(),
    getAppointmentType: vi.fn(),
    createAuditLog: vi.fn(async () => ({})),
  },
  authCtx: { role: 'admin', practiceId: 2 as number | null, platformAdmin: false },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: {
    execute: vi.fn(async () => ({ rows: [] })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
  },
}));
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
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/stripeService', () => ({
  chargeCopay: vi.fn(), isStripeConfigured: () => true,
  createPatientPaymentLink: vi.fn(), practiceMayCollectPatientPayments: () => true,
}));

import appointmentsRouter from '../routes/appointments';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/appointments', appointmentsRouter);
  return app;
}

const OTHER_PRACTICE_APPT = { id: 1, practiceId: 99, patientId: 5, therapistId: 't9', startTime: new Date().toISOString(), endTime: new Date().toISOString(), status: 'scheduled' };
const OTHER_PRACTICE_SERIES = [{ id: 1, seriesId: 'abc', practiceId: 99, status: 'scheduled', startTime: new Date().toISOString() }];

beforeEach(() => {
  vi.clearAllMocks();
  authCtx.role = 'admin';
  authCtx.practiceId = 2;
  authCtx.platformAdmin = false;
  mockStorage.getAppointment.mockResolvedValue(OTHER_PRACTICE_APPT);
  mockStorage.getAppointmentsBySeriesId.mockResolvedValue(OTHER_PRACTICE_SERIES);
  mockStorage.updateAppointment.mockResolvedValue({ ...OTHER_PRACTICE_APPT, status: 'cancelled' });
});

describe('appointments /:id guard — a practice admin from another practice gets 404', () => {
  it.each([
    ['GET', '/api/appointments/1'],
    ['PATCH', '/api/appointments/1'],
    ['POST', '/api/appointments/1/cancel'],
    ['POST', '/api/appointments/1/check-in'],
    ['POST', '/api/appointments/1/check-out'],
  ])('%s %s', async (method, path) => {
    const res = await (request(buildApp()) as any)[method.toLowerCase()](path).send({ status: 'cancelled', notes: 'x' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Appointment not found' });
    expect(mockStorage.updateAppointment).not.toHaveBeenCalled();
  });

  it('a practice admin can still reach their own practice\'s appointment', async () => {
    mockStorage.getAppointment.mockResolvedValue({ ...OTHER_PRACTICE_APPT, practiceId: 2 });
    const res = await request(buildApp()).get('/api/appointments/1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it('a platform admin passes the guard for another practice\'s appointment', async () => {
    authCtx.platformAdmin = true;
    const res = await request(buildApp()).get('/api/appointments/1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it('a user with no practice assignment is refused regardless of role', async () => {
    authCtx.practiceId = null;
    const res = await request(buildApp()).get('/api/appointments/1');
    expect(res.status).toBe(404);
  });
});

describe('appointments /series/:seriesId guard — a practice admin from another practice gets 404', () => {
  it.each([
    ['GET', '/api/appointments/series/abc'],
    ['PUT', '/api/appointments/series/abc'],
    ['DELETE', '/api/appointments/series/abc'],
    ['POST', '/api/appointments/series/abc/cancel'],
  ])('%s %s', async (method, path) => {
    const res = await (request(buildApp()) as any)[method.toLowerCase()](path).send({ notes: 'x' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Series not found' });
    expect(mockStorage.deleteSeriesBySeriesId).not.toHaveBeenCalled();
    expect(mockStorage.updateSeriesBySeriesId).not.toHaveBeenCalled();
    expect(mockStorage.cancelSeriesBySeriesId).not.toHaveBeenCalled();
  });

  it('a series with even one appointment in another practice is refused', async () => {
    mockStorage.getAppointmentsBySeriesId.mockResolvedValue([
      { ...OTHER_PRACTICE_SERIES[0], practiceId: 2 },
      { ...OTHER_PRACTICE_SERIES[0], id: 2, practiceId: 99 },
    ]);
    const res = await request(buildApp()).get('/api/appointments/series/abc');
    expect(res.status).toBe(404);
  });

  it('a platform admin passes the series guard', async () => {
    authCtx.platformAdmin = true;
    const res = await request(buildApp()).get('/api/appointments/series/abc');
    expect(res.status).toBe(200);
  });
});
