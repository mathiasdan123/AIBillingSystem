/**
 * Demo practice submit simulation (demo billing test 2026-11-19, item 4).
 *
 * The Claims page showed the Sandbox banner ("submitting records the claim
 * here, sends nothing") while the submit route answered 400
 * demo_practice_refused for the demo practice, so a prospect could not try
 * the submit → denial → appeal flow at all. The route now simulates a
 * clearinghouse acceptance for a demo practice: same scrub and data checks,
 * claim marked submitted with clearinghouseStatus 'simulated', a labelled
 * timeline event, and — the invariant these tests pin — NO call into the
 * Stedi service, even with a clearinghouse key and an insurance attached.
 *
 * The guards that stop a demo practice transmitting a real 837P are not
 * relaxed: batch submit and the MCP submit tool still refuse it outright.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { storageStub, stediStub, scrubMock } = vi.hoisted(() => ({
  storageStub: {
    getUser: vi.fn(async () => ({ id: 'demo-admin', role: 'admin', practiceId: 1 })),
    getClaim: vi.fn(),
    updateClaim: vi.fn(async (id: number, data: any) => ({ id, practiceId: 1, ...data })),
    createClaimEvent: vi.fn(async (e: any) => ({ id: 1, createdAt: new Date(), ...e })),
    getClaimEvents: vi.fn(async () => []),
    createAuditLog: vi.fn(async () => ({})),
    getClaimLineItems: vi.fn(async () => [
      { id: 1, claimId: 73, cptCodeId: 10, icd10CodeId: 20, amount: '100.00', units: 1, dateOfService: '2026-11-17' },
    ]),
    getPatient: vi.fn(async () => ({
      id: 9, practiceId: 1, firstName: 'Ethan', lastName: 'Example', dateOfBirth: '2018-03-04',
      address: '1 Main St, Lakewood, NJ 08701', insuranceId: 'W123', insuranceRelationship: 'self',
    })),
    getPractice: vi.fn(),
    getInsurances: vi.fn(async () => [{ id: 1, name: 'Aetna', isActive: true, payerCode: '60054' }]),
    getCptCodes: vi.fn(async () => [{ id: 10, code: '97530', description: 'Therapeutic activities' }]),
    getIcd10Codes: vi.fn(async () => [{ id: 20, code: 'F82' }]),
    getSoapNoteBySession: vi.fn(async () => null),
    getPatientEligibility: vi.fn(async () => null),
  },
  stediStub: {
    submitClaim: vi.fn(async () => ({ success: true, status: 'accepted', stediClaimId: 'REAL-1' })),
    getStediApiKeyForPractice: vi.fn(async () => ({ apiKey: 'practice-key', source: 'practice' })),
    resolvePayerId: vi.fn(async () => ({ tradingPartnerId: '60054', routingSource: 'catalog' })),
    parseOneLineAddress: vi.fn(() => ({ line1: '1 Main St', city: 'Lakewood', state: 'NJ', zip: '08701' })),
    isCompleteAddress: vi.fn(() => true),
    describeIncompleteAddress: vi.fn(() => ''),
    toStediPhone: vi.fn(() => '7325551234'),
    toStediSex: vi.fn(() => 'U'),
    buildSubscriberFromPatient: vi.fn(() => undefined),
  },
  scrubMock: vi.fn(async () => ({ passed: true, errors: [], warnings: [] })),
}));

vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/stediService', () => stediStub);
vi.mock('../services/claimScrubber', () => ({ scrubClaim: scrubMock }));
vi.mock('../services/authorizationService', () => ({ getAuthorizations: vi.fn(async () => []) }));
vi.mock('../services/aiLearningService', () => ({ recordClaimOutcome: vi.fn(async () => ({})) }));
vi.mock('../aiAppealGenerator', () => ({ appealGenerator: { generateAppealWithClaude: vi.fn(), generateAppeal: vi.fn() } }));
vi.mock('../services/claimFollowUpService', () => ({ reclassifyDenialAppealFollowUps: vi.fn(async () => []) }));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'demo-admin' } };
    req.userRole = 'admin';
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

const DEMO_PRACTICE = {
  id: 1, name: 'Demo Practice', isDemo: true, sandboxMode: true, npi: '1234567890', taxId: '12-3456789',
  address: '2 Clinic Way, Lakewood, NJ 08701', phone: '7325551234',
};
const LIVE_PRACTICE = { ...DEMO_PRACTICE, isDemo: false, sandboxMode: false };

const draftClaim = (over: any = {}) => ({
  id: 73, practiceId: 1, claimNumber: 'CLM-MWNVFA08-DIJSKH', status: 'draft', patientId: 9, insuranceId: 1,
  totalAmount: '100.00', sessionId: null, authorizationNumber: 'AUTH-1', resubmissionCount: 0, isDemo: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STEDI_API_KEY = 'GLOBAL_KEY';
  storageStub.updateClaim.mockImplementation(async (id: number, data: any) => ({ id, practiceId: 1, ...data }));
  scrubMock.mockResolvedValue({ passed: true, errors: [], warnings: [] });
});

describe('POST /api/claims/:id/submit on the demo practice', () => {
  it('simulates an acceptance: claim submitted, status "simulated", nothing sent to Stedi', async () => {
    storageStub.getPractice.mockResolvedValue(DEMO_PRACTICE);
    storageStub.getClaim.mockResolvedValue(draftClaim());

    const res = await request(makeApp()).post('/api/claims/73/submit').send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, simulated: true, submissionMethod: 'demo_simulation' });
    expect(res.body.message).toMatch(/nothing was sent/i);
    expect(res.body.clearinghouse).toMatchObject({ success: true, simulated: true, status: 'simulated', stediClaimId: null });

    // The real-transmission guard: a demo practice never reaches the Stedi service.
    expect(stediStub.submitClaim).not.toHaveBeenCalled();
    expect(stediStub.resolvePayerId).not.toHaveBeenCalled();

    // The same pre-submission scrub a real claim gets still ran.
    expect(scrubMock).toHaveBeenCalledWith(73, 1);

    const update = storageStub.updateClaim.mock.calls.find((c) => c[1]?.status === 'submitted')?.[1];
    expect(update).toMatchObject({
      status: 'submitted',
      submittedAmount: '100.00',
      holdReason: null,
      clearinghouseClaimId: null,
      clearinghouseStatus: 'simulated',
    });
    expect(update.submittedAt).toBeInstanceOf(Date);

    const event = storageStub.createClaimEvent.mock.calls.find((c) => c[0].eventType === 'submitted')?.[0];
    expect(event).toMatchObject({
      claimId: 73,
      practiceId: 1,
      summary: 'Submission simulated (demo practice) — nothing was transmitted',
      metadata: { submissionMethod: 'demo_simulation', simulated: true, clearinghouseStatus: 'simulated' },
    });
  });

  it('still refuses a claim that fails scrubbing (the simulation is not a bypass)', async () => {
    storageStub.getPractice.mockResolvedValue(DEMO_PRACTICE);
    storageStub.getClaim.mockResolvedValue(draftClaim());
    scrubMock.mockResolvedValue({ passed: false, errors: ['Patient date of birth is missing'], warnings: [], holdReason: 'Patient date of birth is missing' });

    const res = await request(makeApp()).post('/api/claims/73/submit').send({});

    expect(res.status).toBe(422);
    expect(storageStub.updateClaim).toHaveBeenCalledWith(73, expect.objectContaining({ status: 'held' }));
    expect(storageStub.updateClaim).not.toHaveBeenCalledWith(73, expect.objectContaining({ status: 'submitted' }));
    expect(stediStub.submitClaim).not.toHaveBeenCalled();
  });

  it('still refuses a claim that is not draft or held', async () => {
    storageStub.getPractice.mockResolvedValue(DEMO_PRACTICE);
    storageStub.getClaim.mockResolvedValue(draftClaim({ status: 'submitted' }));

    const res = await request(makeApp()).post('/api/claims/73/submit').send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/only draft or held/i);
    expect(stediStub.submitClaim).not.toHaveBeenCalled();
  });

  it('dry run reports the local checks only, never an inconclusive 503 or a clearinghouse call', async () => {
    storageStub.getPractice.mockResolvedValue(DEMO_PRACTICE);
    storageStub.getClaim.mockResolvedValue(draftClaim());

    const res = await request(makeApp()).post('/api/claims/73/submit').send({ dryRun: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, dryRun: true, simulated: true, submissionMethod: 'demo_simulation' });
    expect(res.body.message).toMatch(/nothing was sent/i);
    expect(stediStub.submitClaim).not.toHaveBeenCalled();
    // A dry run leaves the record untouched.
    expect(storageStub.updateClaim).not.toHaveBeenCalled();
    expect(storageStub.createClaimEvent).not.toHaveBeenCalled();
  });

  it('a resubmission after reopen is labelled as a simulated resubmission', async () => {
    storageStub.getPractice.mockResolvedValue(DEMO_PRACTICE);
    storageStub.getClaim.mockResolvedValue(draftClaim({ resubmissionCount: 1 }));

    const res = await request(makeApp()).post('/api/claims/73/submit').send({});

    expect(res.status).toBe(200);
    const event = storageStub.createClaimEvent.mock.calls.find((c) => c[0].eventType === 'submitted')?.[0];
    expect(event.summary).toBe('Resubmission simulated (demo practice) — nothing was transmitted');
    expect(event.metadata).toMatchObject({ isResubmission: true, simulated: true });
    expect(stediStub.submitClaim).not.toHaveBeenCalled();
  });
});

describe('POST /api/claims/:id/submit on a live practice (unchanged)', () => {
  it('goes to the Stedi service and is not marked simulated', async () => {
    storageStub.getPractice.mockResolvedValue(LIVE_PRACTICE);
    storageStub.getClaim.mockResolvedValue(draftClaim());

    const res = await request(makeApp()).post('/api/claims/73/submit').send({});

    expect(res.status).toBe(200);
    expect(stediStub.submitClaim).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({ success: true, simulated: false, submissionMethod: 'stedi' });
    expect(storageStub.updateClaim).toHaveBeenCalledWith(73, expect.objectContaining({ status: 'submitted', clearinghouseStatus: 'accepted', clearinghouseClaimId: 'REAL-1' }));
  });
});

describe('POST /api/claims/batch-submit on the demo practice', () => {
  it('is still refused outright — only the single-claim route simulates', async () => {
    storageStub.getPractice.mockResolvedValue(DEMO_PRACTICE);

    const res = await request(makeApp()).post('/api/claims/batch-submit').send({ claimIds: [73] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('demo_practice_refused');
    expect(stediStub.submitClaim).not.toHaveBeenCalled();
  });
});
