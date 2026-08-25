/**
 * Patient-portal identity guards.
 *
 * Two portal defects, both reachable by someone holding nothing but a link:
 *
 * 1. The profile endpoint let a portal token holder rewrite the patient's
 *    EMAIL — the account-recovery channel. An ex-partner, a forwarded invite
 *    or a shared tablet could point it at themselves, after which every
 *    magic link, statement and reminder went to them and the real patient
 *    could no longer get back in. Silent, permanent takeover.
 *
 * 2. getPatientByEmail returned the FIRST match from an unordered, unscoped
 *    scan. Siblings in a paediatric practice necessarily share a parent's
 *    address (there is no caregiver model), so a parent requesting their own
 *    login link could be handed a different child's chart — and every sibling
 *    after the first could never log in at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, mockAudit } = vi.hoisted(() => ({
  mockStorage: {
    getPatientPortalByToken: vi.fn(),
    getPatientPortalAccess: vi.fn(),
    getPatient: vi.fn(),
    updatePatient: vi.fn(),
    getPatientsByEmail: vi.fn(),
    createPatientPortalAccess: vi.fn(),
    updatePatientPortalMagicLink: vi.fn(),
  },
  mockAudit: { logAuditEvent: vi.fn() },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../middleware/auditMiddleware', () => mockAudit);
vi.mock('../email', () => ({ isEmailConfigured: () => false }));

import publicPortalRouter from '../routes/public-portal';

const PATIENT = {
  id: 10,
  practiceId: 1,
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'parent@example.com',
  phone: '5551234567',
};

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/api', publicPortalRouter);

  mockStorage.getPatientPortalByToken.mockResolvedValue({
    id: 1,
    patientId: PATIENT.id,
    practiceId: 1,
    canUpdateProfile: true,
    portalTokenExpiresAt: new Date(Date.now() + 86400000),
    isActive: true,
  });
  mockStorage.getPatient.mockResolvedValue(PATIENT);
  mockStorage.updatePatient.mockImplementation(async (id: number, patch: any) => ({ id, ...patch }));
});

const asPortal = (r: request.Test) => r.set({ Authorization: `Bearer ${'a'.repeat(64)}` });

describe('PUT /api/patient-portal/profile — identity is not portal-editable', () => {
  it('refuses to move the account-recovery email', async () => {
    const res = await asPortal(
      request(app).put('/api/patient-portal/profile').send({ email: 'attacker@evil.com' }),
    );

    expect(res.status).toBe(400);
    expect(mockStorage.updatePatient).not.toHaveBeenCalled();
    expect(res.body.message).toMatch(/contact the practice/i);
  });

  it('records the attempt rather than silently dropping it', async () => {
    await asPortal(request(app).put('/api/patient-portal/profile').send({ email: 'attacker@evil.com' }));

    expect(mockAudit.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        details: expect.objectContaining({ blockedFields: ['email'] }),
      }),
    );
  });

  it('refuses name and date of birth — chart and payer identifiers', async () => {
    await asPortal(
      request(app)
        .put('/api/patient-portal/profile')
        .send({ firstName: 'New', lastName: 'Name', dateOfBirth: '1990-01-01' }),
    );

    expect(mockStorage.updatePatient).not.toHaveBeenCalled();
  });

  it('strips identity fields but still applies legitimate contact changes', async () => {
    const res = await asPortal(
      request(app)
        .put('/api/patient-portal/profile')
        .send({ email: 'attacker@evil.com', phone: '5559999999' }),
    );

    expect(res.status).toBe(200);
    const patch = mockStorage.updatePatient.mock.calls[0][1];
    expect(patch).toEqual({ phone: '5559999999' });
    expect(patch).not.toHaveProperty('email');
  });

  it('still allows a patient to update their own insurance', async () => {
    await asPortal(
      request(app)
        .put('/api/patient-portal/profile')
        .send({ insuranceProvider: 'Horizon BCBS NJ', policyNumber: 'P-1' }),
    );

    expect(mockStorage.updatePatient.mock.calls[0][1]).toEqual({
      insuranceProvider: 'Horizon BCBS NJ',
      policyNumber: 'P-1',
    });
  });
});

describe('POST /api/patient-portal/request-login — siblings share one email', () => {
  it('issues a link for every matching patient, not an arbitrary one', async () => {
    mockStorage.getPatientsByEmail.mockResolvedValue([
      { ...PATIENT, id: 10, firstName: 'Jane' },
      { ...PATIENT, id: 11, firstName: 'Sam' },
    ]);
    mockStorage.getPatientPortalAccess.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/patient-portal/request-login')
      .send({ email: 'parent@example.com' });

    expect(res.status).toBe(200);
    // Both children get portal access provisioned — previously the second
    // sibling was permanently unreachable.
    expect(mockStorage.createPatientPortalAccess).toHaveBeenCalledTimes(2);
    const ids = mockStorage.createPatientPortalAccess.mock.calls.map((c: any) => c[0].patientId);
    expect(ids).toEqual([10, 11]);
  });

  it('refuses to mail a pile of credentials for an address on implausibly many records', async () => {
    mockStorage.getPatientsByEmail.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({ ...PATIENT, id: 100 + i })),
    );

    const res = await request(app)
      .post('/api/patient-portal/request-login')
      .send({ email: 'frontdesk@practice.com' });

    expect(res.status).toBe(200);
    expect(mockStorage.createPatientPortalAccess).not.toHaveBeenCalled();
  });

  it('never reveals whether an address is on file', async () => {
    mockStorage.getPatientsByEmail.mockResolvedValue([]);
    const unknown = await request(app)
      .post('/api/patient-portal/request-login')
      .send({ email: 'nobody@example.com' });

    mockStorage.getPatientsByEmail.mockResolvedValue([PATIENT]);
    mockStorage.getPatientPortalAccess.mockResolvedValue(null);
    const known = await request(app)
      .post('/api/patient-portal/request-login')
      .send({ email: 'parent@example.com' });

    expect(unknown.body).toEqual(known.body);
  });
});
