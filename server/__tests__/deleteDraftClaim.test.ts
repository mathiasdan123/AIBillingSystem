/**
 * Removing a claim created in error.
 *
 * There was no delete route for claims at all — only for line items. So a
 * claim created by mistake was permanent. That became a real problem when a
 * bug made the New Claim dialog report "Failed to create claim" while the
 * claim had in fact been saved: several empty drafts accumulated, each with no
 * procedures and a $0 total, inflating "claims this month" and the
 * unsubmitted-review count with no way to clear them.
 *
 * Deletion is DRAFT ONLY, and that boundary is the point. A transmitted claim
 * is a record of something we told a payer; erasing it would leave our history
 * disagreeing with theirs, and a payer's record is the one that decides
 * whether a practice gets paid. A draft has been sent nowhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  claim: null as any,
  deleteDraftClaim: vi.fn(),
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
    getClaim: async () => H.claim,
    deleteDraftClaim: H.deleteDraftClaim,
  },
}));
vi.mock('../aiClaimOptimizer', () => ({ AiClaimOptimizer: class {} }));
vi.mock('../aiAppealGenerator', () => ({ appealGenerator: {} }));
vi.mock('../routes/payerContracts', () => ({ checkClaimUnderpayment: vi.fn() }));

import claimsRouter from '../routes/claims';

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  H.claim = { id: 42, practiceId: 1, status: 'draft', claimNumber: 'CLM-X', clearinghouseClaimId: null };
  app = express();
  app.use(express.json());
  app.use('/api/claims', claimsRouter);
});

describe('DELETE /api/claims/:id', () => {
  it('deletes a draft', async () => {
    const res = await request(app).delete('/api/claims/42');

    expect(res.status).toBe(200);
    expect(H.deleteDraftClaim).toHaveBeenCalledWith(42);
  });

  it('refuses a SUBMITTED claim', async () => {
    H.claim.status = 'submitted';

    const res = await request(app).delete('/api/claims/42');

    // Our record must not diverge from the payer's.
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('not_a_draft');
    expect(H.deleteDraftClaim).not.toHaveBeenCalled();
  });

  it('refuses a paid claim', async () => {
    H.claim.status = 'paid';

    const res = await request(app).delete('/api/claims/42');

    expect(res.status).toBe(400);
    expect(H.deleteDraftClaim).not.toHaveBeenCalled();
  });

  it('refuses a draft that carries a clearinghouse reference', async () => {
    H.claim.clearinghouseClaimId = 'stedi-abc';

    const res = await request(app).delete('/api/claims/42');

    // A "draft" that reached the clearinghouse is not really a draft; refuse
    // rather than erase evidence of a transmission.
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('transmitted');
    expect(H.deleteDraftClaim).not.toHaveBeenCalled();
  });

  it("refuses another practice's claim, without revealing it exists", async () => {
    H.claim.practiceId = 99;

    const res = await request(app).delete('/api/claims/42');

    // 404, not 403 — the router-level guard answers cross-tenant access the
    // same way it answers a nonexistent id, so the response cannot be used to
    // probe which claim ids are real.
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Claim not found');
    expect(H.deleteDraftClaim).not.toHaveBeenCalled();
  });

  it('404s on a claim that does not exist', async () => {
    H.claim = null;

    const res = await request(app).delete('/api/claims/42');

    expect(res.status).toBe(404);
    expect(H.deleteDraftClaim).not.toHaveBeenCalled();
  });
});
