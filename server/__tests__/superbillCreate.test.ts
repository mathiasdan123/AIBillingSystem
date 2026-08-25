/**
 * Creating a superbill from the dialog's own payload.
 *
 * POST /api/superbills required { providerId, diagnosisCodes, procedureCodes,
 * totalAmount } — fully resolved values. The Create Superbill dialog sent
 * { patientId, insuranceId, dateOfService, lineItems: [{ cptCodeId, units,
 * icd10CodeId }] }, which is what a user can actually pick. The two contracts
 * never matched, so the dialog returned 400 on every attempt and no superbill
 * could be created from the UI at all. Nothing caught it because nothing
 * exercised the two sides together.
 *
 * Resolution happens on the SERVER on purpose. Fees come from this practice's
 * own schedule; a client sending its own `fee` could put an amount nobody
 * agreed to on a document the patient hands to their insurer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  cptCodes: [] as any[],
  icd10Codes: [] as any[],
  rate: null as string | null,
  generated: [] as any[],
}));

vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.userPracticeId = 1;
    req.userRole = 'billing';
    req.user = { claims: { sub: 'user-123' } };
    next();
  },
}));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../storage', () => ({
  storage: {
    getCptCodes: async () => H.cptCodes,
    getIcd10Codes: async () => H.icd10Codes,
    resolvePracticeCptRate: async () => H.rate,
  },
}));
vi.mock('../services/superbillService', () => ({
  generateSuperbill: vi.fn(async (practiceId: number, data: any) => {
    H.generated.push({ practiceId, ...data });
    return { id: 1, ...data, totalAmount: data.totalAmount };
  }),
  generateFromAppointment: vi.fn(),
  getSuperbills: vi.fn(async () => []),
  getSuperbill: vi.fn(),
  finalizeSuperbill: vi.fn(),
  markSent: vi.fn(),
}));

import superbillsRouter from '../routes/superbills';

/** Exactly what the Create Superbill dialog posts. */
const DIALOG_PAYLOAD = {
  patientId: 10,
  insuranceId: 3,
  dateOfService: '2026-08-12',
  lineItems: [{ cptCodeId: 1, units: 2, icd10CodeId: 5 }],
};

let app: Express;
beforeEach(() => {
  H.cptCodes = [{ id: 1, code: '97153', description: 'Adaptive behavior treatment' }];
  H.icd10Codes = [{ id: 5, code: 'F80.2' }];
  H.rate = '125.00';
  H.generated = [];

  app = express();
  app.use(express.json());
  app.use('/api/superbills', superbillsRouter);
});

describe('POST /api/superbills from the dialog payload', () => {
  it('accepts it instead of 400ing', async () => {
    const res = await request(app).post('/api/superbills').send(DIALOG_PAYLOAD);

    expect(res.status).toBe(201);
  });

  it('resolves CPT ids to codes, descriptions and per-line fees', async () => {
    await request(app).post('/api/superbills').send(DIALOG_PAYLOAD);

    expect(H.generated[0].procedureCodes).toEqual([
      { code: '97153', description: 'Adaptive behavior treatment', units: 2, fee: '250.00' },
    ]);
  });

  it('computes the total from the practice fee schedule, not the client', async () => {
    await request(app).post('/api/superbills').send(DIALOG_PAYLOAD);

    // 125.00 x 2 units. The client never sends an amount.
    expect(H.generated[0].totalAmount).toBe('250.00');
  });

  it('resolves ICD ids to diagnosis codes', async () => {
    await request(app).post('/api/superbills').send(DIALOG_PAYLOAD);

    expect(H.generated[0].diagnosisCodes).toEqual(['F80.2']);
  });

  it('defaults the rendering provider to the signed-in user', async () => {
    await request(app).post('/api/superbills').send(DIALOG_PAYLOAD);

    // providerId is NOT NULL and the dialog never collected it — that alone
    // made the request unsatisfiable.
    expect(H.generated[0].providerId).toBe('user-123');
  });

  it('refuses an unpriced CPT code rather than inventing a fee', async () => {
    H.rate = null;

    const res = await request(app).post('/api/superbills').send(DIALOG_PAYLOAD);

    // The patient submits this document to their insurer. An amount the
    // practice never chose must not appear on it.
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RATE_NOT_SET');
    expect(res.body.cptCode).toBe('97153');
    expect(H.generated).toHaveLength(0);
  });

  it('refuses a superbill with no diagnosis code', async () => {
    const res = await request(app)
      .post('/api/superbills')
      .send({ ...DIALOG_PAYLOAD, lineItems: [{ cptCodeId: 1, units: 1 }] });

    // An insurer cannot reimburse without one, so a superbill lacking it is
    // useless to the patient — better to say so than to produce it.
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/diagnosis/i);
  });

  it('still accepts the original fully-resolved payload', async () => {
    const res = await request(app).post('/api/superbills').send({
      patientId: 10,
      providerId: 'user-999',
      dateOfService: '2026-08-12',
      diagnosisCodes: ['F80.2'],
      procedureCodes: [{ code: '97153', description: 'x', units: 1, fee: '125.00' }],
      totalAmount: '125.00',
    });

    // API callers that already resolve their own values keep working.
    expect(res.status).toBe(201);
    expect(H.generated[0].providerId).toBe('user-999');
  });
});
