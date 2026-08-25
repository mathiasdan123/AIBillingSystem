/**
 * POST /api/claims answers with an ENVELOPE, not the claim.
 *
 * The route returns { message, claim }. The New Claim dialog did
 * `const claim = await response.json()` and then used `claim.id`, which is
 * undefined on the envelope — so every line item was posted to
 * /api/claims/undefined/line-items and rejected with 400 "Invalid claim ID".
 *
 * The failure was badly misleading. The claim itself was created successfully;
 * only its CPT codes were lost. The user saw a flat "Failed to create claim",
 * went looking for nothing, and found a real claim sitting in the list with no
 * procedures on it — then re-added the codes by hand on the detail page.
 *
 * This hits the real route so the contract cannot drift from the client again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({ createClaim: vi.fn() }));

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
vi.mock('../storage', () => ({
  storage: {
    createClaim: H.createClaim,
    getSoapNotes: vi.fn(async () => []),
    getPatients: vi.fn(async () => []),
  },
}));
vi.mock('../aiClaimOptimizer', () => ({
  AiClaimOptimizer: class {
    async optimizeClaim() {
      return { aiReviewScore: 90, aiReviewNotes: '' };
    }
  },
}));
vi.mock('../aiAppealGenerator', () => ({ appealGenerator: {} }));
// The route graph transitively pulls in db.ts, which throws at import time
// without DATABASE_URL. Stub it — this test is about an HTTP contract.
vi.mock('../db', () => ({ db: {}, getDb: () => ({}), getPool: async () => ({}) }));
vi.mock('./payerContracts', () => ({ checkClaimUnderpayment: vi.fn() }));
vi.mock('../routes/payerContracts', () => ({ checkClaimUnderpayment: vi.fn() }));

import claimsRouter from '../routes/claims';

/** Exactly what the New Claim dialog posts. */
const DIALOG_PAYLOAD = {
  patientId: 10,
  insuranceId: 3,
  sessionId: null,
  totalAmount: 867,
  submittedAmount: null,
};

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  H.createClaim.mockResolvedValue({
    id: 42,
    claimNumber: 'CLM-TEST',
    totalAmount: '867.00',
    status: 'draft',
  });

  app = express();
  app.use(express.json());
  app.use('/api/claims', claimsRouter);
});

describe('POST /api/claims', () => {
  it('creates the claim', async () => {
    const res = await request(app).post('/api/claims').send(DIALOG_PAYLOAD);

    expect(res.status).toBe(200);
    expect(H.createClaim).toHaveBeenCalledTimes(1);
  });

  it('returns the id nested under `claim`, not at the top level', async () => {
    const res = await request(app).post('/api/claims').send(DIALOG_PAYLOAD);

    // This is the whole bug: the client read res.body.id.
    expect(res.body.id).toBeUndefined();
    expect(res.body.claim.id).toBe(42);
  });

  it('the client unwrap handles this response', async () => {
    const res = await request(app).post('/api/claims').send(DIALOG_PAYLOAD);

    // Mirrors client/src/pages/claims.tsx createClaimMutation.
    const unwrap = (r: any) => r?.claim?.id ?? r?.id;

    expect(unwrap(res.body)).toBe(42);
    // Tolerant of the route being changed to return the claim directly, so
    // this cannot silently strand the line items a second time.
    expect(unwrap({ id: 7 })).toBe(7);
  });
});
