/**
 * Tenant-isolation guard for the recurring-series routes keyed by the string
 * seriesId (GET/PUT/DELETE /series/:seriesId, /series/:seriesId/cancel). The
 * storage functions filter by seriesId only, so the router.use('/series/:seriesId')
 * guard must block a non-admin from touching another practice's series.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getAppointmentsBySeriesId: vi.fn(),
    deleteSeriesBySeriesId: vi.fn(),
    updateSeriesBySeriesId: vi.fn(),
    cancelSeriesBySeriesId: vi.fn(),
    getAppointment: vi.fn(),
    getPatient: vi.fn(),
    getPractice: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
// Non-admin user in practice 1.
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'user-1' } };
    req.userPracticeId = 1;
    req.userRole = 'therapist';
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
});

describe('recurring-series tenant guard (/series/:seriesId)', () => {
  it('404s a GET for a series in another practice and never returns its data', async () => {
    mockStorage.getAppointmentsBySeriesId.mockResolvedValue([
      { id: 1, seriesId: 'abc', practiceId: 99, startTime: new Date().toISOString(), status: 'scheduled' },
    ]);
    const res = await request(app).get('/api/appointments/series/abc');
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('appointments');
  });

  it('404s a DELETE for another practice’s series and does not delete', async () => {
    mockStorage.getAppointmentsBySeriesId.mockResolvedValue([
      { id: 1, seriesId: 'abc', practiceId: 99, status: 'scheduled' },
    ]);
    const res = await request(app).delete('/api/appointments/series/abc');
    expect(res.status).toBe(404);
    expect(mockStorage.deleteSeriesBySeriesId).not.toHaveBeenCalled();
  });

  it('404s when the series does not exist', async () => {
    mockStorage.getAppointmentsBySeriesId.mockResolvedValue([]);
    const res = await request(app).delete('/api/appointments/series/missing');
    expect(res.status).toBe(404);
    expect(mockStorage.deleteSeriesBySeriesId).not.toHaveBeenCalled();
  });

  it('allows access to a series in the caller’s own practice', async () => {
    mockStorage.getAppointmentsBySeriesId.mockResolvedValue([
      { id: 1, seriesId: 'mine', practiceId: 1, isRecurringInstance: false, startTime: new Date().toISOString(), status: 'scheduled' },
    ]);
    const res = await request(app).get('/api/appointments/series/mine');
    expect(res.status).toBe(200);
    expect(res.body.seriesId).toBe('mine');
  });
});
