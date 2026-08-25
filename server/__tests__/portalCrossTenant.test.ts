/**
 * Cross-tenant leaks reachable from the patient portal.
 *
 * 1. /api/patient-portal/therapists called getAllUsers() and returned every
 *    therapist and admin on the PLATFORM to any portal token holder —
 *    including a token from the public demo login. One practice's patient
 *    could enumerate every other practice's staff.
 *
 * 2. The "Send Portal Link" email built its URL from req.get('host'), which
 *    the caller controls. A crafted Host header would make the practice email
 *    its patient a real, valid magic link pointing at an attacker's server,
 *    which captures the token the moment the patient clicks. The invite is
 *    trustworthy precisely because it comes from us.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatientPortalByToken: vi.fn(),
    getPatient: vi.fn(),
    getAllUsers: vi.fn(),
    getTherapistsByPractice: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../middleware/auditMiddleware', () => ({ logAuditEvent: vi.fn() }));
vi.mock('../services/emailService', () => ({ sendEmail: vi.fn() }));
vi.mock('../email', () => ({ isEmailConfigured: () => false }));

import publicPortalRouter from '../routes/public-portal';

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/api', publicPortalRouter);

  mockStorage.getPatientPortalByToken.mockResolvedValue({ id: 1, patientId: 10, practiceId: 7 });
  mockStorage.getPatient.mockResolvedValue({ id: 10, practiceId: 7, firstName: 'Jane' });
  mockStorage.getTherapistsByPractice.mockResolvedValue([
    { id: 'u1', firstName: 'Own', lastName: 'Therapist', role: 'therapist' },
  ]);
  // If this is ever called again, the cross-tenant leak is back.
  mockStorage.getAllUsers.mockResolvedValue([
    { id: 'u1', firstName: 'Own', lastName: 'Therapist', role: 'therapist' },
    { id: 'u2', firstName: 'Other', lastName: 'Practice', role: 'admin' },
  ]);
});

const asPortal = (r: request.Test) => r.set({ Authorization: `Bearer ${'a'.repeat(64)}` });

describe('GET /api/patient-portal/therapists', () => {
  it("returns only the patient's own practice staff", async () => {
    const res = await asPortal(request(app).get('/api/patient-portal/therapists'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].firstName).toBe('Own');
  });

  it('never enumerates the platform roster', async () => {
    await asPortal(request(app).get('/api/patient-portal/therapists'));

    expect(mockStorage.getTherapistsByPractice).toHaveBeenCalledWith(7);
    expect(mockStorage.getAllUsers).not.toHaveBeenCalled();
  });

  it('returns nothing rather than everything when the patient has no practice', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 10, practiceId: null });

    const res = await asPortal(request(app).get('/api/patient-portal/therapists'));

    expect(res.body).toEqual([]);
    expect(mockStorage.getAllUsers).not.toHaveBeenCalled();
  });

  it('still requires a portal token', async () => {
    const res = await request(app).get('/api/patient-portal/therapists');
    expect(res.status).toBe(401);
  });
});
