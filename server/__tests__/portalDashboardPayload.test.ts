/**
 * What the portal dashboard hands to whoever holds the link.
 *
 * 1. `patient` was the entire database row — date of birth, address, both
 *    insurance sets, policy numbers, internal flags. The dashboard displays
 *    five fields; everything else was extra PHI given away for nothing.
 *
 * 2. The permission flags were RETURNED as data but never enforced here, so a
 *    patient whose practice had switched off statements or documents still
 *    received both in this payload — while the sibling list endpoints
 *    correctly refuse them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatientPortalByToken: vi.fn(),
    getPatient: vi.fn(),
    updatePortalAccess: vi.fn(),
    getPatientPortalDashboard: vi.fn(),
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

const TOKEN = 'd'.repeat(64);

const FULL_PATIENT = {
  id: 10, firstName: 'Jane', lastName: 'Doe', email: 'j@example.com',
  phone: '5551234567', insuranceProvider: 'Horizon BCBS NJ',
  // None of the below belongs in a portal dashboard payload.
  dateOfBirth: '1990-05-15', address: '1 Private Way', policyNumber: 'POL-SECRET',
  secondaryInsurancePolicyNumber: 'SEC-SECRET', copayAmount: '30.00',
  intakeData: { notes: 'internal' }, practiceId: 1,
};

function makeApp(access: any): Express {
  mockStorage.getPatientPortalByToken.mockResolvedValue(access);
  mockStorage.getPatient.mockResolvedValue(FULL_PATIENT);
  mockStorage.getPatientPortalDashboard.mockResolvedValue({
    patient: FULL_PATIENT,
    upcomingAppointments: [{ id: 1 }],
    recentStatements: [{ id: 2 }],
    documents: [{ id: 3 }],
    unreadMessages: 4,
  });
  const app = express();
  app.use(express.json());
  app.use('/api', publicPortalRouter);
  return app;
}

const ALL_ALLOWED = {
  id: 1, patientId: 10, practiceId: 1,
  canViewAppointments: true, canViewStatements: true, canViewDocuments: true,
  canSendMessages: true, canUpdateProfile: true, canCompleteIntake: true,
};

beforeEach(() => vi.clearAllMocks());

describe('GET /public/portal/:token/dashboard', () => {
  it('returns only the fields the dashboard renders', async () => {
    const res = await request(makeApp(ALL_ALLOWED)).get(`/api/public/portal/${TOKEN}/dashboard`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.patient).sort()).toEqual(
      ['email', 'firstName', 'id', 'insuranceProvider', 'lastName', 'phone'],
    );
  });

  it('does not leak DOB, address or policy numbers', async () => {
    const res = await request(makeApp(ALL_ALLOWED)).get(`/api/public/portal/${TOKEN}/dashboard`);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('1990-05-15');
    expect(body).not.toContain('POL-SECRET');
    expect(body).not.toContain('SEC-SECRET');
    expect(body).not.toContain('1 Private Way');
  });

  it('honours the permission flags instead of only reporting them', async () => {
    const res = await request(
      makeApp({ ...ALL_ALLOWED, canViewStatements: false, canViewDocuments: false }),
    ).get(`/api/public/portal/${TOKEN}/dashboard`);

    expect(res.body.recentStatements).toEqual([]);
    expect(res.body.documents).toEqual([]);
    // Still returns what IS permitted.
    expect(res.body.upcomingAppointments).toHaveLength(1);
  });

  it('suppresses the unread count when messaging is off', async () => {
    const res = await request(
      makeApp({ ...ALL_ALLOWED, canSendMessages: false }),
    ).get(`/api/public/portal/${TOKEN}/dashboard`);

    expect(res.body.unreadMessages).toBe(0);
  });
});
