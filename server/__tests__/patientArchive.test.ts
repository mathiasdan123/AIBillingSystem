/**
 * Patient archive (QA sweep 2026-11-18): there was no delete or archive
 * control on a patient at all. Archive is a soft, reversible retirement of the
 * record -- hidden from the default list, search and pickers, blocked from
 * new appointments and claims -- distinct from the right-to-erasure soft
 * delete, which nulls PHI and purges the row later.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  patient: null as any,
  archivePatient: vi.fn(),
  unarchivePatient: vi.fn(),
  getAllPatients: vi.fn(),
  countAllPatients: vi.fn(),
  batchGetConsentStatus: vi.fn(),
  getPatient: vi.fn(),
  createAppointment: vi.fn(),
  createClaim: vi.fn(),
}));

vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.userPracticeId = 1;
    req.userRole = 'billing';
    req.user = { claims: { sub: 'u1' } };
    next();
  },
}));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../db', () => ({ db: {}, getDb: () => ({}), getPool: async () => ({}) }));
vi.mock('../storage', () => ({
  storage: {
    getPatient: H.getPatient,
    archivePatient: H.archivePatient,
    unarchivePatient: H.unarchivePatient,
    getAllPatients: H.getAllPatients,
    countAllPatients: H.countAllPatients,
    batchGetConsentStatus: H.batchGetConsentStatus,
    createAppointment: H.createAppointment,
    getAppointmentType: vi.fn(),
    getUser: vi.fn(async () => ({ id: 'u1', role: 'billing', practiceId: 1 })),
    createClaim: H.createClaim,
    getSoapNotes: vi.fn(async () => []),
    getPatients: vi.fn(async () => []),
  },
}));
vi.mock('../services/stripeService', () => ({
  chargeCopay: vi.fn(),
  isStripeConfigured: () => false,
  createPatientPaymentLink: vi.fn(),
}));
vi.mock('../aiClaimOptimizer', () => ({
  AiClaimOptimizer: class {
    async optimizeClaim() {
      return { aiReviewScore: 90, aiReviewNotes: '' };
    }
  },
}));
vi.mock('../aiAppealGenerator', () => ({ appealGenerator: {} }));
vi.mock('./payerContracts', () => ({ checkClaimUnderpayment: vi.fn() }));
vi.mock('../routes/payerContracts', () => ({ checkClaimUnderpayment: vi.fn() }));

import patientsRouter from '../routes/patients';
import appointmentsRouter from '../routes/appointments';
import claimsRouter from '../routes/claims';

const ACTIVE = { id: 10, practiceId: 1, firstName: 'Jude', lastName: 'Spero', archivedAt: null };
const ARCHIVED = { ...ACTIVE, archivedAt: new Date('2026-11-18T15:00:00Z') };

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  H.patient = ACTIVE;
  H.getPatient.mockImplementation(async () => H.patient);
  H.archivePatient.mockImplementation(async (id: number) => ({ ...H.patient, id, archivedAt: new Date() }));
  H.unarchivePatient.mockImplementation(async (id: number) => ({ ...H.patient, id, archivedAt: null }));
  H.getAllPatients.mockResolvedValue([]);
  H.countAllPatients.mockResolvedValue(0);
  H.batchGetConsentStatus.mockResolvedValue(new Map());
  H.createAppointment.mockImplementation(async (d: any) => ({ id: 1, ...d }));
  H.createClaim.mockImplementation(async (d: any) => ({ id: 1, ...d }));
  app = express();
  app.use(express.json());
  app.use('/api/patients', patientsRouter);
  app.use('/api/appointments', appointmentsRouter);
  app.use('/api/claims', claimsRouter);
});

describe('PATCH /api/patients/:id/archive and /unarchive', () => {
  it('archives a patient in the caller practice and returns the updated row', async () => {
    const res = await request(app).patch('/api/patients/10/archive');
    expect(res.status).toBe(200);
    expect(H.archivePatient).toHaveBeenCalledWith(10, 1);
    expect(res.body.archivedAt).toBeTruthy();
  });

  it('unarchives an archived patient', async () => {
    H.patient = ARCHIVED;
    const res = await request(app).patch('/api/patients/10/unarchive');
    expect(res.status).toBe(200);
    expect(H.unarchivePatient).toHaveBeenCalledWith(10, 1);
    expect(res.body.archivedAt).toBeNull();
  });

  it('is idempotent: archiving an archived patient and unarchiving an active one write nothing', async () => {
    H.patient = ARCHIVED;
    expect((await request(app).patch('/api/patients/10/archive')).status).toBe(200);
    expect(H.archivePatient).not.toHaveBeenCalled();
    H.patient = ACTIVE;
    expect((await request(app).patch('/api/patients/10/unarchive')).status).toBe(200);
    expect(H.unarchivePatient).not.toHaveBeenCalled();
  });

  it('refuses a patient from another practice with 404 and writes nothing', async () => {
    H.patient = { ...ACTIVE, practiceId: 2 };
    const res = await request(app).patch('/api/patients/10/archive');
    expect(res.status).toBe(404);
    expect(H.archivePatient).not.toHaveBeenCalled();
  });
});

describe('GET /api/patients archive filter', () => {
  it('excludes archived patients by default', async () => {
    await request(app).get('/api/patients');
    expect(H.getAllPatients).toHaveBeenCalledWith(1, { archived: 'exclude' });
  });

  it('?archived=only lists only archived patients, ?archived=include lists everyone', async () => {
    await request(app).get('/api/patients?archived=only');
    expect(H.getAllPatients).toHaveBeenLastCalledWith(1, { archived: 'only' });
    await request(app).get('/api/patients?archived=include&page=1&limit=20');
    expect(H.getAllPatients).toHaveBeenLastCalledWith(1, { limit: 20, offset: 0, archived: 'include' });
    expect(H.countAllPatients).toHaveBeenLastCalledWith(1, { archived: 'include' });
  });

  it('ignores an unknown archived value', async () => {
    await request(app).get('/api/patients?archived=yesplease');
    expect(H.getAllPatients).toHaveBeenCalledWith(1, { archived: 'exclude' });
  });
});

describe('archived patients take no new appointments or claims', () => {
  it('POST /api/appointments → 400 for an archived patient, created for an active one', async () => {
    H.patient = ARCHIVED;
    const blocked = await request(app)
      .post('/api/appointments')
      .send({ patientId: 10, startTime: '2026-12-01T14:00:00Z', endTime: '2026-12-01T14:45:00Z' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/archived/i);
    expect(H.createAppointment).not.toHaveBeenCalled();

    H.patient = ACTIVE;
    const ok = await request(app)
      .post('/api/appointments')
      .send({ patientId: 10, startTime: '2026-12-01T14:00:00Z', endTime: '2026-12-01T14:45:00Z' });
    expect(ok.status).toBe(200);
    expect(H.createAppointment).toHaveBeenCalled();
  });

  it('POST /api/claims → 400 for an archived patient, created for an active one', async () => {
    H.patient = ARCHIVED;
    const blocked = await request(app).post('/api/claims').send({ patientId: 10, totalAmount: 300 });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/archived/i);
    expect(H.createClaim).not.toHaveBeenCalled();

    H.patient = ACTIVE;
    const ok = await request(app).post('/api/claims').send({ patientId: 10, totalAmount: 300 });
    expect([200, 201]).toContain(ok.status);
    expect(H.createClaim).toHaveBeenCalled();
  });

  it('a patient lookup failure does not block scheduling (only a confirmed archive does)', async () => {
    H.getPatient.mockRejectedValue(new Error('db down'));
    const res = await request(app)
      .post('/api/appointments')
      .send({ patientId: 10, startTime: '2026-12-01T14:00:00Z', endTime: '2026-12-01T14:45:00Z' });
    expect(res.status).toBe(200);
  });
});
