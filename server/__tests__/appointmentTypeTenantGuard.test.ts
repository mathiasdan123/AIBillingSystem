/**
 * Tests for the tenant guard on POST /api/appointments when the caller
 * passes an appointmentTypeId. The DB FK only proves the catalog row
 * exists somewhere — the guard proves it belongs to this practice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getAppointmentType: vi.fn(),
    createAppointment: vi.fn(),
    // surface the rest of the surface area the router pulls in
    getAppointment: vi.fn(),
    updateAppointment: vi.fn(),
    getPatient: vi.fn(),
    getPractice: vi.fn(),
    getStediApiKeyForPractice: vi.fn(),
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
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));

import appointmentsRouter from '../routes/appointments';

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/api/appointments', appointmentsRouter);
  mockStorage.createAppointment.mockImplementation(async (data: any) => ({ id: 999, ...data }));
});

const basePayload = {
  practiceId: 1,
  patientId: 7,
  startTime: '2026-06-01T15:00:00.000Z',
  endTime: '2026-06-01T16:00:00.000Z',
  title: 'Therapy Session',
  status: 'scheduled',
};

describe('POST /api/appointments — appointmentTypeId tenant guard', () => {
  it('accepts an appointmentTypeId from the same practice', async () => {
    mockStorage.getAppointmentType.mockResolvedValue({ id: 42, practiceId: 1, duration: 45, name: 'Eval' });
    const res = await request(app)
      .post('/api/appointments')
      .send({ ...basePayload, appointmentTypeId: 42, durationMinutes: 45 });
    expect(res.status).toBe(200);
    expect(mockStorage.createAppointment).toHaveBeenCalled();
    const created = mockStorage.createAppointment.mock.calls[0][0];
    expect(created.appointmentTypeId).toBe(42);
    expect(created.durationMinutes).toBe(45);
  });

  it('rejects 400 when appointmentTypeId belongs to a different practice', async () => {
    mockStorage.getAppointmentType.mockResolvedValue({ id: 42, practiceId: 99, duration: 45, name: 'Eval' });
    const res = await request(app)
      .post('/api/appointments')
      .send({ ...basePayload, appointmentTypeId: 42 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong to this practice/i);
    expect(mockStorage.createAppointment).not.toHaveBeenCalled();
  });

  it('rejects 400 when appointmentTypeId points at a nonexistent row', async () => {
    mockStorage.getAppointmentType.mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/appointments')
      .send({ ...basePayload, appointmentTypeId: 999999 });
    expect(res.status).toBe(400);
    expect(mockStorage.createAppointment).not.toHaveBeenCalled();
  });

  it('does not call getAppointmentType when no appointmentTypeId is supplied (back-compat)', async () => {
    const res = await request(app).post('/api/appointments').send(basePayload);
    expect(res.status).toBe(200);
    expect(mockStorage.getAppointmentType).not.toHaveBeenCalled();
    expect(mockStorage.createAppointment).toHaveBeenCalled();
  });
});
