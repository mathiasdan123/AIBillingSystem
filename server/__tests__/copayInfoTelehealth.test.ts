/**
 * GET /api/appointments/:id/copay-info — telehealth is a fact, not a guess.
 *
 * QA sweep 2026-11-18: the check-in modal labelled an ordinary "Individual
 * Therapy" appointment as Telehealth (and hid the copay controls) because
 * the route inferred telehealth from a missing locationId. Location is
 * optional in the New Appointment dialog, so that was most in-person
 * appointments. Telehealth now means a telehealth_sessions row exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getAppointment: vi.fn(),
    getTelehealthSessionByAppointment: vi.fn(),
    getPatient: vi.fn(),
    getPatientEligibility: vi.fn(),
    getPractice: vi.fn(),
    getPatientPaymentMethods: vi.fn(),
    getAppointmentType: vi.fn(),
    createAppointment: vi.fn(),
    updateAppointment: vi.fn(),
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
  // In-person "Individual Therapy" with no location chosen — the QA repro.
  mockStorage.getAppointment.mockResolvedValue({
    id: 10, practiceId: 1, patientId: 7, locationId: null, title: 'Individual Therapy', status: 'scheduled',
  });
  mockStorage.getPatient.mockResolvedValue({ id: 7, practiceId: 1, copayAmount: '25.00' });
  mockStorage.getPatientEligibility.mockResolvedValue(null);
  mockStorage.getPractice.mockResolvedValue({ id: 1, copayChargingEnabled: true });
  mockStorage.getPatientPaymentMethods.mockResolvedValue([]);
});

describe('GET /api/appointments/:id/copay-info isTelehealth', () => {
  it('an appointment with no location and no telehealth session is NOT telehealth', async () => {
    mockStorage.getTelehealthSessionByAppointment.mockResolvedValue(undefined);

    const res = await request(app).get('/api/appointments/10/copay-info');

    expect(res.status).toBe(200);
    expect(res.body.isTelehealth).toBe(false);
    expect(mockStorage.getTelehealthSessionByAppointment).toHaveBeenCalledWith(10);
    // And the copay is looked up, not suppressed as a "telehealth" visit.
    expect(res.body.expectedCents).toBe(2500);
  });

  it('an appointment with a telehealth session IS telehealth even when it has a location', async () => {
    mockStorage.getAppointment.mockResolvedValue({
      id: 10, practiceId: 1, patientId: 7, locationId: 3, title: 'Individual Therapy', status: 'scheduled',
    });
    mockStorage.getTelehealthSessionByAppointment.mockResolvedValue({ id: 99, appointmentId: 10 });

    const res = await request(app).get('/api/appointments/10/copay-info');

    expect(res.status).toBe(200);
    expect(res.body.isTelehealth).toBe(true);
  });
});
