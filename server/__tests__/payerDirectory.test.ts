/**
 * A practice must be able to add a payer it needs to bill.
 *
 * The `insurances` catalog was seed-only — the single insert lived in
 * seeds.ts — so a practice whose payer mix included anything outside the
 * founder's seed list (a regional Blues subsidiary, an EAP, a state plan)
 * could not bill it without database surgery. Claim submission resolves the
 * payer from claim.insuranceId, so an unbillable payer meant an unbillable
 * patient.
 *
 * The catalog is GLOBAL (payers are shared entities), which is why adding
 * de-duplicates on payer code: otherwise every practice that billed Horizon
 * would add its own row and everyone's dropdown would fill with duplicates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, mockCache } = vi.hoisted(() => ({
  mockStorage: { findOrCreateInsurance: vi.fn(), getInsurances: vi.fn(), getUser: vi.fn() },
  mockCache: { del: vi.fn(), wrap: vi.fn(async (_k: any, _t: any, fn: any) => fn()) },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({ db: {}, getDb: () => ({}) }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/cacheService', () => ({
  cache: mockCache,
  CacheKeys: { payers: () => 'payers' },
  CacheTTL: { CODE_LOOKUPS: 60 },
}));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'u1' } };
    req.userPracticeId = 1;
    req.userRole = req.headers['x-role'] || 'billing';
    next();
  },
}));
vi.mock('../middleware/financial-access', () => ({
  requireFinancialRole: (req: any, res: any, next: any) =>
    ['admin', 'billing'].includes(req.userRole) ? next() : res.status(403).json({ message: 'denied' }),
  FINANCIAL_ROLES: ['admin', 'billing'],
}));

import insuranceRouter from '../routes/insurance';

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/api', insuranceRouter);
  mockStorage.findOrCreateInsurance.mockImplementation(async (input: any) => ({
    insurance: { id: 9, name: input.name, payerCode: input.payerCode, isActive: true },
    created: true,
  }));
});

describe('POST /api/insurances', () => {
  it('adds a payer and makes it immediately visible by clearing the cached list', async () => {
    const res = await request(app)
      .post('/api/insurances')
      .send({ name: 'Horizon BCBS NJ', payerCode: '22099' });

    expect(res.status).toBe(201);
    expect(res.body.payerCode).toBe('22099');
    // The payer list is globally cached; without this the user who just added
    // the payer would not see it in their own dropdown.
    expect(mockCache.del).toHaveBeenCalledWith('payers');
  });

  it('returns the existing entry instead of creating a duplicate', async () => {
    mockStorage.findOrCreateInsurance.mockResolvedValue({
      insurance: { id: 3, name: 'Aetna', payerCode: '60054', isActive: true },
      created: false,
    });

    const res = await request(app)
      .post('/api/insurances')
      .send({ name: 'Aetna', payerCode: '60054' });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.id).toBe(3);
  });

  it('refuses a payer with no clearinghouse ID, which could not route a claim', async () => {
    const res = await request(app).post('/api/insurances').send({ name: 'Some Local Plan' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/payer ID is required/i);
    expect(mockStorage.findOrCreateInsurance).not.toHaveBeenCalled();
  });

  it('refuses a malformed payer ID', async () => {
    const res = await request(app)
      .post('/api/insurances')
      .send({ name: 'Bad', payerCode: 'not a valid id!!' });

    expect(res.status).toBe(400);
    expect(mockStorage.findOrCreateInsurance).not.toHaveBeenCalled();
  });

  it('refuses an empty name', async () => {
    const res = await request(app).post('/api/insurances').send({ payerCode: '22099' });

    expect(res.status).toBe(400);
    expect(mockStorage.findOrCreateInsurance).not.toHaveBeenCalled();
  });

  it('is closed to the therapist role — the directory is a billing surface', async () => {
    const res = await request(app)
      .post('/api/insurances')
      .set({ 'x-role': 'therapist' })
      .send({ name: 'Horizon BCBS NJ', payerCode: '22099' });

    expect(res.status).toBe(403);
    expect(mockStorage.findOrCreateInsurance).not.toHaveBeenCalled();
  });
});
