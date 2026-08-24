/**
 * PATCH /api/claims/:id had no practice ownership check and passed req.body
 * straight into updateClaim.
 *
 * Any authenticated biller could enumerate claim ids and rewrite another
 * practice's totalAmount, paidAmount, status and paidAt — corrupting A/R and
 * every collections figure derived from claims, with no record of who did it.
 * Payment and lifecycle changes have their own audited endpoints (/paid,
 * /deny, /reopen), so this generic route has no business writing them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getClaim: vi.fn(),
    updateClaim: vi.fn(),
    getUser: vi.fn(),
    getClaims: vi.fn(),
    getPractice: vi.fn(),
    getPatient: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'u1' } };
    req.userPracticeId = 1;
    req.userRole = 'admin';
    req.isPlatformAdmin = false;
    next();
  },
}));
vi.mock('../services/stripeService', () => ({
  chargeCopay: vi.fn(),
  isStripeConfigured: () => false,
  createPatientPaymentLink: vi.fn(),
  practiceMayCollectPatientPayments: () => true,
}));

import claimsRouter from '../routes/claims';

let app: Express;

beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/api/claims', claimsRouter);
  mockStorage.updateClaim.mockImplementation(async (id: number, patch: any) => ({ id, ...patch }));
  mockStorage.getUser.mockResolvedValue({ id: 'u1', role: 'admin', practiceId: 1 });
});

describe('PATCH /api/claims/:id', () => {
  it("refuses another practice's claim, and does not confirm it exists", async () => {
    mockStorage.getClaim.mockResolvedValue({ id: 99, practiceId: 2, status: 'draft' });

    const res = await request(app).patch('/api/claims/99').send({ totalAmount: '1.00' });

    // 404, not 403: a distinguishable error would confirm the claim exists.
    expect(res.status).toBe(404);
    expect(mockStorage.updateClaim).not.toHaveBeenCalled();
  });

  it('drops money and lifecycle fields that belong to their own endpoints', async () => {
    mockStorage.getClaim.mockResolvedValue({ id: 5, practiceId: 1, status: 'draft' });

    const res = await request(app).patch('/api/claims/5').send({
      insuranceId: 7,
      paidAmount: '9999.00',
      status: 'paid',
      paidAt: '2020-01-01',
      practiceId: 2,
      clearinghouseClaimId: 'forged',
    });

    expect(res.status).toBe(200);
    const written = mockStorage.updateClaim.mock.calls[0][1];
    expect(written).toEqual({ insuranceId: 7 });
    expect(written).not.toHaveProperty('paidAmount');
    expect(written).not.toHaveProperty('status');
    expect(written).not.toHaveProperty('practiceId');
    expect(written).not.toHaveProperty('clearinghouseClaimId');
  });

  it('rejects a body with nothing editable rather than silently doing nothing', async () => {
    mockStorage.getClaim.mockResolvedValue({ id: 5, practiceId: 1, status: 'draft' });

    const res = await request(app).patch('/api/claims/5').send({ paidAmount: '500.00' });

    expect(res.status).toBe(400);
    expect(mockStorage.updateClaim).not.toHaveBeenCalled();
  });

  it('still allows a legitimate edit to a draft claim', async () => {
    mockStorage.getClaim.mockResolvedValue({ id: 5, practiceId: 1, status: 'draft' });

    const res = await request(app)
      .patch('/api/claims/5')
      .send({ totalAmount: '250.00', authorizationNumber: 'AUTH-1' });

    expect(res.status).toBe(200);
    expect(mockStorage.updateClaim.mock.calls[0][1]).toEqual({
      totalAmount: '250.00',
      authorizationNumber: 'AUTH-1',
    });
  });
});
