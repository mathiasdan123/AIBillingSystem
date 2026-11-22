/**
 * PUT/GET /api/soap-drafts carry the suggested billing with the draft.
 *
 * QA sweep 2026-11-18: the draft stored only the four prose sections, so a
 * restore after visiting another page brought the text back with $0 / 0
 * units. The route now whitelists a `billing` object (and only an object).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    upsertSoapDraft: vi.fn(),
    getSoapDraftForTherapistPatient: vi.fn(),
    deleteSoapDraft: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'therapist-a' } };
    req.userPracticeId = 1;
    next();
  },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import soapDraftsRouter from '../routes/soap-drafts';

const BILLING = {
  v: 1,
  cptCodes: [{ code: '97110', name: 'Therapeutic Exercise', units: 3, rationale: 'r', reimbursement: 300 }],
  activityCptPairings: [],
  timeBlocks: [{ blockNumber: 1, startMinute: 0, endMinute: 45, code: '97110', codeName: 'Therapeutic Exercise', rate: 100, activities: ['Trampoline - Strengthening'] }],
  billingRationale: '3 units of timed exercise',
  auditNotes: [],
  totalReimbursement: 300,
  generationMode: 'ai',
};

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/api/soap-drafts', soapDraftsRouter);
  mockStorage.upsertSoapDraft.mockImplementation(async (d: any) => ({ id: 7, lastSavedAt: new Date().toISOString(), ...d }));
});

describe('PUT /api/soap-drafts billing', () => {
  it('stores the billing object with the draft and echoes it back', async () => {
    const res = await request(app)
      .put('/api/soap-drafts')
      .send({ patientId: 42, subjective: 'S', objective: 'O', assessment: 'A', plan: 'P', billing: BILLING });

    expect(res.status).toBe(200);
    const stored = mockStorage.upsertSoapDraft.mock.calls[0][0];
    expect(stored.billing).toEqual(BILLING);
    expect(stored.billing.cptCodes[0].units).toBe(3);
    expect(stored.billing.totalReimbursement).toBe(300);
    expect(res.body.billing).toEqual(BILLING);
    // Scope still comes from the session, never the body.
    expect(stored.practiceId).toBe(1);
    expect(stored.therapistId).toBe('therapist-a');
  });

  it('stores null billing when none is sent (pre-billing clients keep working)', async () => {
    const res = await request(app).put('/api/soap-drafts').send({ patientId: 42, subjective: 'S' });
    expect(res.status).toBe(200);
    expect(mockStorage.upsertSoapDraft.mock.calls[0][0].billing).toBeNull();
  });

  it('drops a non-object billing payload instead of storing arbitrary JSON', async () => {
    for (const bad of ['string', 12, true, [1, 2, 3]]) {
      mockStorage.upsertSoapDraft.mockClear();
      const res = await request(app).put('/api/soap-drafts').send({ patientId: 42, subjective: 'S', billing: bad });
      expect(res.status).toBe(200);
      expect(mockStorage.upsertSoapDraft.mock.calls[0][0].billing).toBeNull();
    }
  });
});

describe('GET /api/soap-drafts billing', () => {
  it('returns the stored billing so the page can restore codes and totals', async () => {
    mockStorage.getSoapDraftForTherapistPatient.mockResolvedValue({
      id: 7, patientId: 42, subjective: 'S', objective: 'O', assessment: 'A', plan: 'P', billing: BILLING, lastSavedAt: null,
    });
    const res = await request(app).get('/api/soap-drafts?patientId=42');
    expect(res.status).toBe(200);
    expect(res.body.billing).toEqual(BILLING);
    expect(mockStorage.getSoapDraftForTherapistPatient).toHaveBeenCalledWith(1, 'therapist-a', 42);
  });
});
