/**
 * Appeal routes: deadline basis, manual edits, and the "ready" gate
 * (QA sweep 2026-11-18). The deadline used to be creation + 60 days with no
 * denial date or payer rule behind it, and any generated letter was stored
 * as "ready".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { generateAppealMock, storageStub } = vi.hoisted(() => ({
  generateAppealMock: vi.fn(async () => ({
    appealLetter: 'Bright Steps\n123 Demo Way\n(555) 010-0000\nNPI: 0000000001\n\nClaims Review Department\nHorizon\n500 Payer Rd\n\nDear Claims Review Department, please reconsider the enclosed session documentation.\n\nDemo Admin',
    denialCategory: 'auth_missing',
    keyArguments: ['The billed codes describe the services rendered'],
    successProbability: 55,
    suggestedActions: [],
  })),
  storageStub: {
    getClaim: vi.fn(),
    getPatient: vi.fn(),
    getClaimLineItems: vi.fn(async () => []),
    getPractice: vi.fn(),
    getUser: vi.fn(async () => ({ firstName: 'Demo', lastName: 'Admin' })),
    getPatientPlanBenefits: vi.fn(async () => null),
    getRecentSoapNotesForPatient: vi.fn(async () => [{ id: 1 }, { id: 2 }]),
    getProgressNotesForPatient: vi.fn(async () => []),
    getPatientInitialEvaluations: vi.fn(async () => []),
    getActiveTreatmentPlan: vi.fn(async () => undefined),
    getPatientDocuments: vi.fn(async () => []),
    createAppeal: vi.fn(async (data: any) => ({ id: 555, ...data })),
    getAppealById: vi.fn(),
    updateAppealRecord: vi.fn(async (id: number, data: any) => ({ id, ...data })),
    updateClaim: vi.fn(async () => ({})),
  },
}));

vi.mock('../aiAppealGenerator', () => ({ appealGenerator: { generateAppeal: generateAppealMock } }));
vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/authorizationService', () => ({ getAuthorizations: vi.fn(async () => []) }));
vi.mock('../services/appealOutcomeLearningService', () => ({ recordAppealOutcome: vi.fn() }));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'user-1' } };
    req.userPracticeId = 7;
    req.userRole = 'admin';
    next();
  },
}));
vi.mock('../services/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import appealsRouter from '../routes/appeals';

const PRACTICE = { id: 7, name: 'Bright Steps', npi: '0000000001', address: '123 Demo Way', phone: '(555) 010-0000', appealWindowDays: null };
// practiceId: the route refuses a claim outside the caller's practice (#469).
const CLAIM = { id: 42, practiceId: 7, status: 'denied', patientId: 99, claimNumber: 'DEMO-2-1006', totalAmount: '289.00', denialReason: 'prior authorization required' };
const PATIENT = { id: 99, firstName: 'Ava', lastName: 'Sample', dateOfBirth: '2018-04-11' };

function makeApp(): Express {
  const app = express();
  // The server mounts express.json with a 10mb limit; mirror that so the
  // oversized-letter case reaches the route's own 400, not the parser's 413.
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', appealsRouter);
  return app;
}

beforeEach(() => {
  Object.values(storageStub).forEach((fn) => (fn as any).mockClear?.());
  generateAppealMock.mockClear();
  storageStub.getClaim.mockResolvedValue(CLAIM);
  storageStub.getPatient.mockResolvedValue(PATIENT);
  storageStub.getPractice.mockResolvedValue(PRACTICE);
});

describe('POST /api/appeals — deadline basis', () => {
  it('denial date + practice default window, recorded as practice_default', async () => {
    storageStub.getPractice.mockResolvedValue({ ...PRACTICE, appealWindowDays: 90 });
    const res = await request(makeApp()).post('/api/appeals').send({ claimId: 42, denialDate: '2026-11-10' }).expect(200);
    const created = storageStub.createAppeal.mock.calls[0][0];
    expect(created).toMatchObject({ denialDate: '2026-11-10', deadlineDate: '2027-02-08', deadlineSource: 'practice_default', deadlinePolicyDays: 90 });
    expect(res.body.appeal.deadlineBasis).toBe('Denial date + 90 days (practice default — verify with payer)');
  });

  it('plan-document appeal rights win over the practice default', async () => {
    storageStub.getPractice.mockResolvedValue({ ...PRACTICE, appealWindowDays: 90 });
    storageStub.getPatientPlanBenefits.mockResolvedValueOnce({ rawExtractedData: { appeal_rights: { first_level_days: 180 } } });
    await request(makeApp()).post('/api/appeals').send({ claimId: 42, denialDate: '2026-11-10' }).expect(200);
    expect(storageStub.createAppeal.mock.calls[0][0]).toMatchObject({ deadlineDate: '2027-05-09', deadlineSource: 'payer_policy', deadlinePolicyDays: 180 });
  });

  it('with no denial date the deadline is a labeled estimate and readiness says the date is missing', async () => {
    const res = await request(makeApp()).post('/api/appeals').send({ claimId: 42 }).expect(200);
    const created = storageStub.createAppeal.mock.calls[0][0];
    expect(created.deadlineSource).toBe('estimated');
    expect(created.denialDate).toBeNull();
    expect(created.status).toBe('draft');
    expect(res.body.appeal.readinessIssues).toContain('Denial date not recorded (needed for the filing deadline)');
    expect(res.body.appeal.deadlineBasis).toContain('no denial date recorded');
  });

  it('a deadline typed in the form is stored as manual; an invalid one is a 400', async () => {
    await request(makeApp()).post('/api/appeals').send({ claimId: 42, denialDate: '2026-11-10', deadlineDate: '2027-03-01' }).expect(200);
    expect(storageStub.createAppeal.mock.calls[0][0]).toMatchObject({ deadlineDate: '2027-03-01', deadlineSource: 'manual', deadlinePolicyDays: null });
    await request(makeApp()).post('/api/appeals').send({ claimId: 42, deadlineDate: '2027-02-31' }).expect(400);
    await request(makeApp()).post('/api/appeals').send({ claimId: 42, denialDate: 'yesterday' }).expect(400);
  });

  it('records the biller inputs with the appeal and hands them to the generator as grounding', async () => {
    await request(makeApp()).post('/api/appeals')
      .send({ claimId: 42, denialDate: '2026-11-10', urgentService: true, retroAuthRequested: true, retroAuthReference: 'RA-9', additionalGrounds: 'Payer confirmed by phone.' })
      .expect(200);
    const grounding = generateAppealMock.mock.calls[0][4];
    expect(grounding.inputs).toMatchObject({ urgentService: true, retroAuthRequested: true, retroAuthReference: 'RA-9', additionalGrounds: 'Payer confirmed by phone.' });
    expect(grounding.hasSoapNotes).toBe(true);
    expect(storageStub.createAppeal.mock.calls[0][0].groundingInputs).toMatchObject({ urgentService: true, retroAuthRequested: true });
  });

  it('is stored ready only when the letter passes readiness (clean letter, denial date, records on file)', async () => {
    const res = await request(makeApp()).post('/api/appeals').send({ claimId: 42, denialDate: '2026-11-10' }).expect(200);
    expect(storageStub.createAppeal.mock.calls[0][0].status).toBe('ready');
    expect(res.body.appeal.readinessIssues).toEqual([]);
  });

  it('strips an unsupported assertion the generator produced, before storing, and holds the appeal as draft if any remain', async () => {
    generateAppealMock.mockResolvedValueOnce({
      appealLetter: 'Bright Steps\n123 Demo Way\n(555) 010-0000\nNPI: 0000000001\n\nClaims Review Department\nHorizon\n500 Payer Rd\n\nServices were emergent/urgent and required immediate intervention. Please reconsider.\n\nDemo Admin',
      denialCategory: 'auth_missing',
      keyArguments: ['Services were emergent/urgent', 'The billed codes describe the services rendered'],
      successProbability: 55,
      suggestedActions: [],
    });
    await request(makeApp()).post('/api/appeals').send({ claimId: 42, denialDate: '2026-11-10' }).expect(200);
    const created = storageStub.createAppeal.mock.calls[0][0];
    expect(created.appealLetter).not.toMatch(/urgent/i);
    expect(created.appealLetter).toContain('Please reconsider.');
    expect(created.keyArguments).toEqual(['The billed codes describe the services rendered']);
    expect(created.status).toBe('ready');
  });
});

describe('PATCH /api/appeals/:id — manual deadline and the ready gate', () => {
  const STORED = {
    id: 12, claimId: 42, practiceId: 7, status: 'draft',
    appealLetter: 'Bright Steps\n123 Demo Way\n(555) 010-0000\nNPI: 0000000001\n\nClaims Review Department\nHorizon\n[Insurance Address]\n\nPlease reconsider.\n\nDemo Admin',
    denialDate: '2026-11-10', deadlineDate: '2027-01-09', deadlineSource: 'estimated', deadlinePolicyDays: 60, groundingInputs: {},
  };

  it('a manual deadline edit is validated as date-only and recorded as manual', async () => {
    storageStub.getAppealById.mockResolvedValue(STORED);
    const res = await request(makeApp()).patch('/api/appeals/12').send({ deadlineDate: '2027-01-17' }).expect(200);
    expect(storageStub.updateAppealRecord).toHaveBeenCalledWith(12, expect.objectContaining({ deadlineDate: '2027-01-17', deadlineSource: 'manual', deadlinePolicyDays: null }));
    expect(res.body.deadlineBasis).toBe('Set manually');
    await request(makeApp()).patch('/api/appeals/12').send({ deadlineDate: '01/17/2027' }).expect(400);
    // An oversized or non-string letter body is refused before any lookup.
    await request(makeApp()).patch('/api/appeals/12').send({ appealLetter: 'x'.repeat(200_001) }).expect(400);
    await request(makeApp()).patch('/api/appeals/12').send({ appealLetter: 42 }).expect(400);
  });

  it('refuses "ready" while the letter still has a placeholder, listing the issues; accepts it once fixed', async () => {
    storageStub.getAppealById.mockResolvedValue(STORED);
    const refused = await request(makeApp()).patch('/api/appeals/12').send({ status: 'ready' }).expect(400);
    expect(refused.body.readinessIssues).toContain('Payer mailing address must be filled in');
    expect(storageStub.updateAppealRecord).not.toHaveBeenCalled();

    const fixed = STORED.appealLetter.replace('[Insurance Address]', '500 Payer Rd, Newark, NJ');
    await request(makeApp()).patch('/api/appeals/12').send({ status: 'ready', appealLetter: fixed }).expect(200);
    expect(storageStub.updateAppealRecord).toHaveBeenCalledWith(12, expect.objectContaining({ status: 'ready', appealLetter: fixed, readinessIssues: [] }));
  });

  it('an edited letter that re-introduces an unsupported assertion is saved but flagged, not promoted', async () => {
    storageStub.getAppealById.mockResolvedValue(STORED);
    const edited = STORED.appealLetter.replace('[Insurance Address]', '500 Payer Rd') + '\nTreatment followed AOTA practice guidelines.';
    await request(makeApp()).patch('/api/appeals/12').send({ appealLetter: edited }).expect(200);
    const update = storageStub.updateAppealRecord.mock.calls[0][1];
    expect(update.appealLetter).toBe(edited);
    expect(update.readinessIssues).toContain('Letter asserts something not on record: aota conformance');
    expect(update.status).toBeUndefined();
  });
});

describe('GET /api/appeals/:id', () => {
  it('returns the deadline basis label and readiness issues with the appeal', async () => {
    storageStub.getAppealById.mockResolvedValue({
      id: 12, claimId: 42, practiceId: 7, status: 'draft', deadlineDate: '2027-05-09', denialDate: '2026-11-10',
      deadlineSource: 'payer_policy', deadlinePolicyDays: 180, readinessIssues: ['Payer mailing address must be filled in'],
    });
    const res = await request(makeApp()).get('/api/appeals/12').expect(200);
    expect(res.body.deadlineBasis).toBe('Denial date + 180 days (payer plan appeal rights)');
    expect(res.body.readinessIssues).toEqual(['Payer mailing address must be filled in']);
    expect(res.body.deadlineDate).toBe('2027-05-09');
  });
});
