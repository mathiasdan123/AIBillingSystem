/**
 * Editing a patient's demographics.
 *
 * There was no way to edit these anywhere: the Details tab was display-only,
 * "Edit insurance" covered only insurance fields, and the intake wizard
 * creates a NEW record rather than editing (its own comment marks editing as
 * a future slice). Whatever was typed at intake was permanent — discovered
 * when a patient's address turned out to be the PRACTICE'S address and the
 * biller preparing a real claim had no way to correct it. The subscriber
 * address goes on the 837P and the payer matches it against their member
 * record, so "frozen at intake" is not acceptable for claim data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  patient: null as any,
  updatePatient: vi.fn(),
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
    getPatient: async () => H.patient,
    updatePatient: H.updatePatient,
  },
}));

import patientsRouter from '../routes/patients';

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  H.patient = { id: 10, practiceId: 1, firstName: 'Jude', lastName: 'Spero' };
  H.updatePatient.mockImplementation(async (_id: number, patch: any) => ({ ...H.patient, ...patch }));
  app = express();
  app.use(express.json());
  app.use('/api/patients', patientsRouter);
});

describe('PATCH /api/patients/:id/details', () => {
  it('updates the address', async () => {
    const res = await request(app)
      .patch('/api/patients/10/details')
      .send({ address: '12 Maple Ct, Lakewood, NJ 08701' });

    expect(res.status).toBe(200);
    expect(H.updatePatient).toHaveBeenCalledWith(10, {
      address: '12 Maple Ct, Lakewood, NJ 08701',
    });
  });

  it('ignores fields outside the allowlist', async () => {
    await request(app)
      .patch('/api/patients/10/details')
      .send({ address: 'x', practiceId: 99, isDemo: true, insuranceId: 'HACK' });

    // Mass-assignment must not reach storage — practiceId/isDemo/insurance
    // fields have their own guarded paths.
    expect(H.updatePatient).toHaveBeenCalledWith(10, { address: 'x' });
  });

  it("refuses another practice's patient, without revealing it exists", async () => {
    H.patient.practiceId = 2;

    const res = await request(app).patch('/api/patients/10/details').send({ address: 'x' });

    // 404, not 403: the router-level guard (router.use('/:id')) answers
    // cross-tenant access the same as a nonexistent id, so responses cannot
    // be used to probe which patient ids are real. The route's own 403 is
    // defence-in-depth behind it.
    expect(res.status).toBe(404);
    expect(H.updatePatient).not.toHaveBeenCalled();
  });

  it('refuses clearing a name', async () => {
    const res = await request(app)
      .patch('/api/patients/10/details')
      .send({ firstName: '' });

    // Names are claim-matching identity — a cleared one breaks every future
    // claim for this patient.
    expect(res.status).toBe(400);
    expect(H.updatePatient).not.toHaveBeenCalled();
  });

  it('400s when nothing editable was sent', async () => {
    const res = await request(app).patch('/api/patients/10/details').send({ practiceId: 5 });

    expect(res.status).toBe(400);
  });

  it('clears an optional field with an empty string', async () => {
    await request(app).patch('/api/patients/10/details').send({ phone: '' });

    expect(H.updatePatient).toHaveBeenCalledWith(10, { phone: null });
  });
});
