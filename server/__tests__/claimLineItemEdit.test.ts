import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * PATCH / DELETE /api/claims/:id/line-items/:lineItemId
 *
 * A biller adding a code with the wrong units used to be unrecoverable —
 * there was no edit and no delete, so the only route was deleting the whole
 * claim. These routes fix that, and carry two rules worth locking in:
 *
 *   1. Draft claims only. Once a claim is submitted the payer holds the
 *      version we sent; amending ours would leave the two disagreeing.
 *   2. `amount` is always recomputed from rate × units, never taken from the
 *      caller — `amount` is what goes on the 837P and rate × units is what
 *      anyone checking the claim will compare it against.
 *
 * A per-line rate override is allowed (a one-off charge differing from the
 * fee schedule), but the schedule rate is preserved as `standardRate` so the
 * deviation stays visible in the record.
 */

const authCtx: { userRole: string; userPracticeId: number | null } = {
  userRole: 'billing',
  userPracticeId: 1,
};

const { storageStub } = vi.hoisted(() => ({
  storageStub: {
    getClaim: vi.fn(),
    getClaimLineItem: vi.fn(),
    updateClaimLineItem: vi.fn(),
    deleteClaimLineItem: vi.fn(),
    recalculateClaimTotal: vi.fn(),
    resolvePracticeCptRate: vi.fn(),
    getClaimLineItems: vi.fn(),
    getCptCodes: vi.fn(),
    createClaimLineItem: vi.fn(),
    updateClaim: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'user-1' } };
    req.userRole = authCtx.userRole;
    req.userPracticeId = authCtx.userPracticeId;
    next();
  },
}));

import claimsRouter from '../routes/claims';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/claims', claimsRouter);
  return app;
}

const CLAIM_ID = 42;
const LINE_ID = 7;

const draftClaim = (over: any = {}) => ({
  id: CLAIM_ID, practiceId: 1, status: 'draft', ...over,
});
const line = (over: any = {}) => ({
  id: LINE_ID, claimId: CLAIM_ID, cptCodeId: 3, units: 2,
  rate: '289.00', amount: '578.00', standardRate: '289.00',
  rateOverrideReason: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  authCtx.userRole = 'billing';
  authCtx.userPracticeId = 1;
  storageStub.getClaim.mockResolvedValue(draftClaim());
  storageStub.getClaimLineItem.mockResolvedValue(line());
  storageStub.updateClaimLineItem.mockImplementation(async (_id: number, patch: any) => ({
    ...line(), ...patch,
  }));
  storageStub.recalculateClaimTotal.mockResolvedValue('578.00');
  storageStub.resolvePracticeCptRate.mockResolvedValue('289.00');
});

describe('PATCH claim line item', () => {
  it('updates units and recomputes the claim total', async () => {
    const res = await request(makeApp())
      .patch(`/api/claims/${CLAIM_ID}/line-items/${LINE_ID}`)
      .send({ units: 4 });
    expect(res.status).toBe(200);
    expect(storageStub.updateClaimLineItem).toHaveBeenCalledWith(
      LINE_ID, expect.objectContaining({ units: 4 }),
    );
    expect(storageStub.recalculateClaimTotal).toHaveBeenCalledWith(CLAIM_ID);
  });

  it('accepts a per-line rate override with a reason', async () => {
    const res = await request(makeApp())
      .patch(`/api/claims/${CLAIM_ID}/line-items/${LINE_ID}`)
      .send({ rate: '325.50', rateOverrideReason: 'Extended session' });
    expect(res.status).toBe(200);
    expect(storageStub.updateClaimLineItem).toHaveBeenCalledWith(
      LINE_ID,
      expect.objectContaining({ rate: '325.50', rateOverrideReason: 'Extended session' }),
    );
  });

  it('clearing the rate reverts the line to the fee schedule', async () => {
    storageStub.getClaimLineItem.mockResolvedValue(
      line({ rate: '400.00', rateOverrideReason: 'one-off' }),
    );
    const res = await request(makeApp())
      .patch(`/api/claims/${CLAIM_ID}/line-items/${LINE_ID}`)
      .send({ rate: null });
    expect(res.status).toBe(200);
    expect(storageStub.updateClaimLineItem).toHaveBeenCalledWith(
      LINE_ID,
      expect.objectContaining({ rate: '289.00', rateOverrideReason: null }),
    );
  });

  it.each([
    ['not a number', 'abc'],
    ['negative', -5],
    ['absurdly large', 250000],
  ])('rejects a %s rate', async (_label, rate) => {
    const res = await request(makeApp())
      .patch(`/api/claims/${CLAIM_ID}/line-items/${LINE_ID}`)
      .send({ rate });
    expect(res.status).toBe(400);
    expect(storageStub.updateClaimLineItem).not.toHaveBeenCalled();
  });

  it.each([
    ['zero', 0],
    ['fractional', 1.5],
    ['fractional as a string', '2.5'],
    ['over the cap', 1000],
  ])('rejects %s units', async (_label, units) => {
    const res = await request(makeApp())
      .patch(`/api/claims/${CLAIM_ID}/line-items/${LINE_ID}`)
      .send({ units });
    expect(res.status).toBe(400);
    expect(storageStub.updateClaimLineItem).not.toHaveBeenCalled();
  });

  it('refuses to edit a submitted claim', async () => {
    storageStub.getClaim.mockResolvedValue(draftClaim({ status: 'submitted' }));
    const res = await request(makeApp())
      .patch(`/api/claims/${CLAIM_ID}/line-items/${LINE_ID}`)
      .send({ units: 3 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/corrected claim/i);
    expect(storageStub.updateClaimLineItem).not.toHaveBeenCalled();
  });

  // The router-level tenant guard (added 2026-06-11) answers 404 rather than
  // 403 for a cross-tenant claim, on purpose: a 403 would confirm the claim
  // exists. Asserting 404 here locks in the non-disclosure.
  it('refuses a claim belonging to another practice without confirming it exists', async () => {
    storageStub.getClaim.mockResolvedValue(draftClaim({ practiceId: 99 }));
    const res = await request(makeApp())
      .patch(`/api/claims/${CLAIM_ID}/line-items/${LINE_ID}`)
      .send({ units: 3 });
    expect(res.status).toBe(404);
    expect(res.body.message).not.toMatch(/access denied|permission/i);
    expect(storageStub.updateClaimLineItem).not.toHaveBeenCalled();
  });

  it('refuses a line item that belongs to a different claim', async () => {
    storageStub.getClaimLineItem.mockResolvedValue(line({ claimId: 999 }));
    const res = await request(makeApp())
      .patch(`/api/claims/${CLAIM_ID}/line-items/${LINE_ID}`)
      .send({ units: 3 });
    expect(res.status).toBe(404);
    expect(storageStub.updateClaimLineItem).not.toHaveBeenCalled();
  });

  it('rejects an empty patch', async () => {
    const res = await request(makeApp())
      .patch(`/api/claims/${CLAIM_ID}/line-items/${LINE_ID}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE claim line item', () => {
  it('removes the line and recomputes the total', async () => {
    storageStub.recalculateClaimTotal.mockResolvedValue('0.00');
    const res = await request(makeApp())
      .delete(`/api/claims/${CLAIM_ID}/line-items/${LINE_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, claimTotal: '0.00' });
    expect(storageStub.deleteClaimLineItem).toHaveBeenCalledWith(LINE_ID);
    expect(storageStub.recalculateClaimTotal).toHaveBeenCalledWith(CLAIM_ID);
  });

  it('refuses to delete from a submitted claim', async () => {
    storageStub.getClaim.mockResolvedValue(draftClaim({ status: 'submitted' }));
    const res = await request(makeApp())
      .delete(`/api/claims/${CLAIM_ID}/line-items/${LINE_ID}`);
    expect(res.status).toBe(400);
    expect(storageStub.deleteClaimLineItem).not.toHaveBeenCalled();
  });

  it('refuses a claim belonging to another practice without confirming it exists', async () => {
    storageStub.getClaim.mockResolvedValue(draftClaim({ practiceId: 99 }));
    const res = await request(makeApp())
      .delete(`/api/claims/${CLAIM_ID}/line-items/${LINE_ID}`);
    expect(res.status).toBe(404);
    expect(storageStub.deleteClaimLineItem).not.toHaveBeenCalled();
  });
});
