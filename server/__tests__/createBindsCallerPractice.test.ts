/**
 * Creates must bind to the CALLER's practice, never a client-supplied
 * practiceId.
 *
 * Several client pages historically posted a hardcoded `practiceId: 1`. With
 * a second practice onboarded that filed their appointments and sessions into
 * practice 1 — the founder's real billing entity, and the wrong PHI
 * custodian. The server now overrides the field on create, so no client
 * (including a stale cached bundle or a hand-rolled curl) can misdirect a
 * write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    createAppointment: vi.fn(async (data: any) => ({ id: 1, ...data })),
    getAppointmentType: vi.fn(),
    createSession: vi.fn(async (data: any) => ({ id: 2, ...data })),
    getUser: vi.fn(async () => ({ id: 'u1', role: 'admin', practiceId: 7 })),
    upsertUser: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({ db: {}, getDb: () => ({}) }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'u1' } };
    // Caller belongs to practice 7 — NOT practice 1.
    req.userPracticeId = 7;
    req.userRole = 'admin';
    req.isPlatformAdmin = false;
    next();
  },
}));
vi.mock('../services/stripeService', () => ({
  chargeCopay: vi.fn(),
  isStripeConfigured: () => false,
  createPatientPaymentLink: vi.fn(),
}));

import appointmentsRouter from '../routes/appointments';
import sessionsRouter from '../routes/sessions';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/appointments', appointmentsRouter);
  app.use('/api', sessionsRouter);
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('create binds to the caller practice', () => {
  it('POST /api/appointments ignores a hardcoded practiceId: 1 in the body', async () => {
    await request(makeApp())
      .post('/api/appointments')
      .send({
        practiceId: 1, // what the old client sent
        patientId: 5,
        startTime: '2026-09-01T15:00:00Z',
        endTime: '2026-09-01T15:45:00Z',
      });

    expect(mockStorage.createAppointment).toHaveBeenCalledTimes(1);
    const written = mockStorage.createAppointment.mock.calls[0][0];
    expect(written.practiceId).toBe(7);
    expect(written.practiceId).not.toBe(1);
  });

  it('POST /api/sessions ignores a hardcoded practiceId: 1 in the body', async () => {
    await request(makeApp())
      .post('/api/sessions')
      .send({ practiceId: 1, patientId: 5, sessionDate: '2026-09-01' });

    expect(mockStorage.createSession).toHaveBeenCalledTimes(1);
    const written = mockStorage.createSession.mock.calls[0][0];
    expect(written.practiceId).toBe(7);
    expect(written.practiceId).not.toBe(1);
  });
});
