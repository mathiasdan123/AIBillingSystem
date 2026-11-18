import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * Claim timeline events + reopen handoff (QA 2026-11-18, denial follow-up
 * sweep). The claims row keeps only the latest state, so the Status tab
 * showed Created/Submitted and nothing else, and Reopen to Draft erased the
 * denial reason while leaving the "Denial — appeal" follow-up pointing at a
 * claim with no appeal path. These routes now:
 *   - append a claim_events row on deny and on reopen (reopen carries the
 *     previous denial reason), and
 *   - on reopen, reclassify the open denial_appeal follow-up to a
 *     correction/resubmit task scoped to the caller's practice.
 * Also pins two tenant checks added in the same change: /deny and
 * /:id/appeals used to act on any claim id.
 */

const { storageStub, reclassifyMock, generateMock } = vi.hoisted(() => ({
  storageStub: {
    // isAdminOrBilling (on /deny) resolves the caller's role through storage.
    getUser: vi.fn(async () => ({ id: 'biller-1', role: 'billing', practiceId: 1 })),
    getClaim: vi.fn(),
    updateClaim: vi.fn(async (id: number, data: any) => ({ id, practiceId: 1, ...data })),
    createClaimEvent: vi.fn(async (e: any) => ({ id: 1, createdAt: new Date(), ...e })),
    getClaimEvents: vi.fn(async () => []),
    getClaimAppeals: vi.fn(async () => []),
    createAuditLog: vi.fn(async () => ({})),
    getClaimLineItems: vi.fn(async () => []),
    getPatient: vi.fn(async () => null),
    getPractice: vi.fn(async () => null),
    getCptCodes: vi.fn(async () => []),
    getIcd10Codes: vi.fn(async () => []),
    createReimbursementOptimization: vi.fn(async () => ({})),
  },
  reclassifyMock: vi.fn(async () => []),
  generateMock: vi.fn(),
}));

vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/aiLearningService', () => ({ recordClaimOutcome: vi.fn(async () => ({})) }));
vi.mock('../aiAppealGenerator', () => ({ appealGenerator: { generateAppealWithClaude: generateMock, generateAppeal: generateMock } }));
vi.mock('../services/claimFollowUpService', () => ({ reclassifyDenialAppealFollowUps: reclassifyMock }));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'biller-1' } };
    req.userRole = 'billing';
    req.userPracticeId = 1;
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

const claim = (over: any = {}) => ({
  id: 42, practiceId: 1, claimNumber: 'DEMO-2-1006', status: 'denied',
  denialReason: 'CO-197: precertification absent', totalAmount: '216.00', patientId: 9, resubmissionCount: 0, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  storageStub.updateClaim.mockImplementation(async (id: number, data: any) => ({ id, practiceId: 1, ...data }));
  storageStub.getClaimEvents.mockResolvedValue([]);
});

describe('POST /api/claims/:id/deny', () => {
  it('records a "denied" timeline event carrying the reason', async () => {
    storageStub.getClaim.mockResolvedValue(claim({ status: 'submitted', denialReason: null }));
    const res = await request(makeApp()).post('/api/claims/42/deny').send({ denialReason: 'CO-197: precertification absent' });
    expect(res.status).toBe(200);
    expect(storageStub.createClaimEvent).toHaveBeenCalledTimes(1);
    expect(storageStub.createClaimEvent.mock.calls[0][0]).toMatchObject({
      claimId: 42,
      practiceId: 1,
      eventType: 'denied',
      summary: 'Denied: CO-197: precertification absent',
      metadata: { denialReason: 'CO-197: precertification absent', previousStatus: 'submitted' },
      createdBy: 'biller-1',
    });
  });

  it("refuses another practice's claim (tenant check) and writes nothing", async () => {
    // The router-level /:id ownership guard answers 404 first; the in-route
    // check added alongside the event write is defense in depth behind it.
    storageStub.getClaim.mockResolvedValue(claim({ practiceId: 7, status: 'submitted' }));
    const res = await request(makeApp()).post('/api/claims/42/deny').send({ denialReason: 'x' });
    expect(res.status).toBe(404);
    expect(storageStub.updateClaim).not.toHaveBeenCalled();
    expect(storageStub.createClaimEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/claims/:id/reopen', () => {
  it('clears denialReason on the row but keeps it in a "reopened" event, and reclassifies the denial follow-up', async () => {
    storageStub.getClaim.mockResolvedValue(claim());
    const res = await request(makeApp()).post('/api/claims/42/reopen').send({ reason: 'add prior auth number' });
    expect(res.status).toBe(200);

    // Row: back to draft, denial cleared (unchanged behaviour).
    expect(storageStub.updateClaim.mock.calls[0][1]).toMatchObject({ status: 'draft', denialReason: null, resubmissionCount: 1 });

    // History: the old denial reason travels with the event.
    const ev = storageStub.createClaimEvent.mock.calls.find((c) => c[0].eventType === 'reopened')?.[0];
    expect(ev).toBeDefined();
    expect(ev).toMatchObject({
      claimId: 42,
      practiceId: 1,
      summary: 'Reopened to draft for correction: add prior auth number',
      metadata: {
        reason: 'add prior auth number',
        previousStatus: 'denied',
        previousDenialReason: 'CO-197: precertification absent',
        resubmissionCount: 1,
      },
    });

    // Follow-up: the open "Denial — appeal" task becomes a correction task,
    // scoped to the caller's practice, carrying the old denial reason.
    expect(reclassifyMock).toHaveBeenCalledTimes(1);
    expect(reclassifyMock).toHaveBeenCalledWith(42, 1, {
      reason: 'add prior auth number',
      previousDenialReason: 'CO-197: precertification absent',
      claimNumber: 'DEMO-2-1006',
    });
  });

  it('still reopens when the follow-up reclassification fails (best-effort, logged)', async () => {
    storageStub.getClaim.mockResolvedValue(claim());
    reclassifyMock.mockRejectedValueOnce(new Error('task table down'));
    const res = await request(makeApp()).post('/api/claims/42/reopen').send({ reason: 'fix modifier' });
    expect(res.status).toBe(200);
    expect(res.body.claim.status).toBe('draft');
  });

  it("does not touch another practice's claim or tasks", async () => {
    storageStub.getClaim.mockResolvedValue(claim({ practiceId: 7 }));
    const res = await request(makeApp()).post('/api/claims/42/reopen').send({ reason: 'fix modifier' });
    expect(res.status).toBe(404); // router-level /:id ownership guard
    expect(reclassifyMock).not.toHaveBeenCalled();
    expect(storageStub.createClaimEvent).not.toHaveBeenCalled();
  });
});

describe('GET /api/claims/:id/events', () => {
  it('returns the practice-scoped event history, oldest first as stored', async () => {
    storageStub.getClaim.mockResolvedValue(claim());
    storageStub.getClaimEvents.mockResolvedValue([
      { id: 1, eventType: 'denied', summary: 'Denied: CO-197', createdAt: '2026-11-18T14:00:00.000Z' },
      { id: 2, eventType: 'appeal_created', summary: 'Appeal created (initial)', metadata: { appealId: 3 }, createdAt: '2026-11-18T15:00:00.000Z' },
    ]);
    const res = await request(makeApp()).get('/api/claims/42/events');
    expect(res.status).toBe(200);
    expect(storageStub.getClaimEvents).toHaveBeenCalledWith(1, 42);
    expect(res.body.map((e: any) => e.eventType)).toEqual(['denied', 'appeal_created']);
  });

  it("404s for another practice's claim without querying events", async () => {
    storageStub.getClaim.mockResolvedValue(claim({ practiceId: 7 }));
    const res = await request(makeApp()).get('/api/claims/42/events');
    expect(res.status).toBe(404);
    expect(storageStub.getClaimEvents).not.toHaveBeenCalled();
  });
});

describe('GET /api/claims/:id/appeals (AI recommendations)', () => {
  it("404s for another practice's claim instead of returning its appeal letters", async () => {
    storageStub.getClaim.mockResolvedValue(claim({ practiceId: 7 }));
    const res = await request(makeApp()).get('/api/claims/42/appeals');
    expect(res.status).toBe(404);
    expect(storageStub.getClaimAppeals).not.toHaveBeenCalled();
  });

  it('serves the caller\'s own claim', async () => {
    storageStub.getClaim.mockResolvedValue(claim());
    storageStub.getClaimAppeals.mockResolvedValue([{ id: 1, optimizationNotes: '{"successProbability":70}' }]);
    const res = await request(makeApp()).get('/api/claims/42/appeals');
    expect(res.status).toBe(200);
    expect(res.body[0].parsedNotes.successProbability).toBe(70);
  });
});
