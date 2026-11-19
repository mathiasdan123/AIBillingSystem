import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * Appeal routes append claim timeline events (QA 2026-11-18): appeal
 * created, internal note added, appeal submitted, appeal resolved. Also pins
 * the new ?claimId= filter on GET /api/appeals, which the claim detail's
 * Appeals tab uses to list the appeals actually filed on a claim.
 */

const { storageStub, generateAppealMock, createClaimEventMock } = vi.hoisted(() => ({
  createClaimEventMock: vi.fn(async (e: any) => ({ id: 1, ...e })),
  storageStub: {
    getAppealById: vi.fn(),
    getClaim: vi.fn(async () => ({ id: 42, practiceId: 7, patientId: 1, status: 'denied', denialReason: 'CO-197', totalAmount: '216.00' })),
    getPatient: vi.fn(async () => ({ id: 1, firstName: 'Ava', lastName: 'Sample', dateOfBirth: '2018-04-11' })),
    getClaimLineItems: vi.fn(async () => []),
    getPractice: vi.fn(async () => ({ id: 7, name: 'P', npi: '1', address: 'A', phone: 'P' })),
    updateAppealRecord: vi.fn(async (id: number, data: any) => ({ id, ...data })),
    updateClaim: vi.fn(async () => ({})),
    createAppeal: vi.fn(async (data: any) => ({ id: 999, ...data })),
    getAppeals: vi.fn(async () => []),
    getClaimsByIds: vi.fn(async () => new Map()),
    getPatientsByIds: vi.fn(async () => new Map()),
  },
  generateAppealMock: vi.fn(async () => ({ appealLetter: 'Letter', denialCategory: 'authorization', keyArguments: ['a'], successProbability: 60, suggestedActions: [] })),
}));

vi.mock('../storage', () => ({ storage: { ...storageStub, createClaimEvent: createClaimEventMock } }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/appealOutcomeLearningService', () => ({ recordAppealOutcome: vi.fn() }));
vi.mock('../aiAppealGenerator', () => ({ appealGenerator: { generateAppeal: generateAppealMock } }));
vi.mock('../services/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'biller-7' } };
    req.userPracticeId = 7;
    req.userRole = 'billing';
    next();
  },
}));

import appealsRouter from '../routes/appeals';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', appealsRouter);
  return app;
}

const ownAppeal = (over: any = {}) => ({
  id: 5, claimId: 42, practiceId: 7, appealLevel: 'initial', status: 'ready', appealLetter: 'Letter',
  appealedAmount: '216.00', notes: 'old note', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/appeals', () => {
  it('records an appeal_created event with the appeal id, level and deadline', async () => {
    const res = await request(makeApp()).post('/api/appeals').send({ claimId: 42, deadlineDate: '2027-01-17' });
    expect(res.status).toBe(200);
    expect(storageStub.updateClaim).toHaveBeenCalledWith(42, { status: 'appeal' });
    expect(createClaimEventMock).toHaveBeenCalledTimes(1);
    expect(createClaimEventMock.mock.calls[0][0]).toMatchObject({
      claimId: 42,
      practiceId: 7,
      eventType: 'appeal_created',
      metadata: { appealId: 999, appealLevel: 'initial', status: 'ready', deadlineDate: '2027-01-17' },
      createdBy: 'biller-7',
    });
    expect(createClaimEventMock.mock.calls[0][0].summary).toContain('2027-01-17');
  });

  it("refuses to open an appeal on another practice's claim", async () => {
    storageStub.getClaim.mockResolvedValueOnce({ id: 42, practiceId: 3, status: 'denied' });
    const res = await request(makeApp()).post('/api/appeals').send({ claimId: 42 });
    expect(res.status).toBe(404);
    expect(storageStub.createAppeal).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/appeals/:id (internal notes)', () => {
  it('records a note_added event with an excerpt when notes change', async () => {
    storageStub.getAppealById.mockResolvedValue(ownAppeal());
    const res = await request(makeApp()).patch('/api/appeals/5').send({ notes: 'Called Aetna; rep says auth was on file under old plan id.' });
    expect(res.status).toBe(200);
    expect(createClaimEventMock).toHaveBeenCalledTimes(1);
    expect(createClaimEventMock.mock.calls[0][0]).toMatchObject({
      claimId: 42,
      practiceId: 7,
      eventType: 'note_added',
      metadata: { appealId: 5, excerpt: 'Called Aetna; rep says auth was on file under old plan id.' },
    });
  });

  it('does not record a note event for a non-note update or an unchanged note', async () => {
    storageStub.getAppealById.mockResolvedValue(ownAppeal());
    await request(makeApp()).patch('/api/appeals/5').send({ deadlineDate: '2027-02-01' });
    await request(makeApp()).patch('/api/appeals/5').send({ notes: 'old note' });
    expect(createClaimEventMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/appeals/:id/submit and /resolve', () => {
  it('records appeal_submitted', async () => {
    storageStub.getAppealById.mockResolvedValue(ownAppeal());
    const res = await request(makeApp()).post('/api/appeals/5/submit');
    expect(res.status).toBe(200);
    expect(createClaimEventMock.mock.calls[0][0]).toMatchObject({ claimId: 42, practiceId: 7, eventType: 'appeal_submitted', metadata: { appealId: 5 } });
  });

  it('records appeal_resolved with the outcome', async () => {
    storageStub.getAppealById.mockResolvedValue(ownAppeal({ status: 'submitted' }));
    const res = await request(makeApp()).post('/api/appeals/5/resolve').send({ outcome: 'won', recoveredAmount: '216.00' });
    expect(res.status).toBe(200);
    expect(createClaimEventMock.mock.calls[0][0]).toMatchObject({
      eventType: 'appeal_resolved',
      metadata: { appealId: 5, outcome: 'won', recoveredAmount: '216.00' },
    });
  });
});

describe('GET /api/appeals?claimId=', () => {
  it('passes the claim filter to storage, scoped to the caller practice', async () => {
    const res = await request(makeApp()).get('/api/appeals?claimId=42');
    expect(res.status).toBe(200);
    expect(storageStub.getAppeals).toHaveBeenCalledWith(7, expect.objectContaining({ claimId: 42 }));
  });

  it('ignores a non-numeric claimId', async () => {
    await request(makeApp()).get('/api/appeals?claimId=abc');
    expect(storageStub.getAppeals.mock.calls[0][1]).not.toHaveProperty('claimId');
  });
});
