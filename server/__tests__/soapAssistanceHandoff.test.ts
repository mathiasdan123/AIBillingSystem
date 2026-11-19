/**
 * Structured ratings must reach generation (post-deploy retest of #464,
 * 2026-11-18, Riley Nodob): "Minimal Assist" chosen via "Apply to All" / per
 * exercise never appeared in either note and the AI audit said assistance
 * was not assessed. Two drops: the client's global `assessment` object stayed
 * blank (a different control), and the route mapped activityAssessments to
 * {name, response} only. These tests pin the route half: the generator gets
 * the per-activity ratings AND a global assistance derived from them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, mockGenerate } = vi.hoisted(() => ({
  mockStorage: { getUser: vi.fn(), getPractice: vi.fn() },
  mockGenerate: vi.fn(),
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'u1' } };
    next();
  },
}));
vi.mock('../services/aiSoapBillingService', () => ({ generateSoapNoteAndBilling: mockGenerate }));

import aiRouter from '../routes/ai';
import { deriveGlobalAssessment, normalizeActivityAssessments } from '../utils/soapAssessment';

// Exactly the shape client/src/pages/soap-notes.tsx sends: full activity
// objects with a per-exercise assessment, plus the (blank) global object.
const CLIENT_BODY = {
  patientId: 7,
  activities: ['Trampoline - Strengthening'],
  activityAssessments: [
    {
      name: 'Trampoline - Strengthening',
      response: 'five sets of ten jumps, one-minute pauses, no pain',
      assessment: { performance: '', assistance: 'Minimal Assist', strength: '', motorPlanning: '', sensoryRegulation: '' },
    },
  ],
  assessment: { performance: '', assistance: '', strength: '', motorPlanning: '', sensoryRegulation: '' },
  duration: 45,
  mood: '',
  location: 'Clinic',
};

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/api', aiRouter);
  mockStorage.getUser.mockResolvedValue({ id: 'u1', practiceId: 1 });
  mockGenerate.mockResolvedValue({
    subjective: '', objective: '', assessment: '', plan: '',
    cptCodes: [], activityCptPairings: [], timeBlocks: [],
    totalReimbursement: 0, billingRationale: '', generationMode: 'ai',
  });
});

const requestPassed = () => mockGenerate.mock.calls[0][0];

describe('POST /api/ai/generate-soap-billing — structured ratings reach the generator', () => {
  it('carries the per-exercise assistance level in activityDetails', async () => {
    await request(app).post('/api/ai/generate-soap-billing').send(CLIENT_BODY).expect(200);
    const req = requestPassed();
    expect(req.activityDetails).toEqual([
      { name: 'Trampoline - Strengthening', response: 'five sets of ten jumps, one-minute pauses, no pain', assistance: 'Minimal Assist' },
    ]);
  });

  it('derives the blank global assistance from per-exercise ratings that agree', async () => {
    await request(app).post('/api/ai/generate-soap-billing').send(CLIENT_BODY).expect(200);
    expect(requestPassed().assessment.assistance).toBe('Minimal Assist');
    // Fields nobody rated stay blank -- nothing is invented.
    expect(requestPassed().assessment.performance).toBe('');
    expect(requestPassed().assessment.strength).toBe('');
  });

  it('derives performance / strength / motor planning the same way, and never overwrites a typed global', async () => {
    const body = {
      ...CLIENT_BODY,
      activityAssessments: [
        { name: 'Trampoline - Strengthening', assessment: { performance: 'Improved', assistance: 'Minimal Assist', strength: 'Fair', motorPlanning: 'Mild Difficulty', sensoryRegulation: '' } },
        { name: 'Pegboard - Functional', assessment: { performance: 'Improved', assistance: 'Minimal Assist', strength: 'Fair', motorPlanning: 'Mild Difficulty', sensoryRegulation: '' } },
      ],
      assessment: { performance: '', assistance: 'Moderate Assist', strength: '', motorPlanning: '', sensoryRegulation: '' },
    };
    await request(app).post('/api/ai/generate-soap-billing').send(body).expect(200);
    const a = requestPassed().assessment;
    expect(a.assistance).toBe('Moderate Assist'); // typed global wins
    expect(a.performance).toBe('Improved');
    expect(a.strength).toBe('Fair');
    expect(a.motorPlanning).toBe('Mild Difficulty');
    expect(a.sensoryRegulation).toBe('');
  });

  it('leaves the global blank when exercises disagree (the per-exercise values still travel)', async () => {
    const body = {
      ...CLIENT_BODY,
      activityAssessments: [
        { name: 'Trampoline - Strengthening', assessment: { assistance: 'Minimal Assist' } },
        { name: 'Pegboard - Functional', assessment: { assistance: 'Independent' } },
      ],
    };
    await request(app).post('/api/ai/generate-soap-billing').send(body).expect(200);
    expect(requestPassed().assessment.assistance).toBe('');
    expect(requestPassed().activityDetails.map((d: any) => d.assistance)).toEqual(['Minimal Assist', 'Independent']);
  });

  it('still sends a blank assessment when nothing was rated anywhere (no defaults invented)', async () => {
    const body = { ...CLIENT_BODY, activityAssessments: [{ name: 'Trampoline - Strengthening', assessment: {} }], assessment: undefined };
    await request(app).post('/api/ai/generate-soap-billing').send(body).expect(200);
    expect(requestPassed().assessment).toEqual({ performance: '', assistance: '', strength: '', motorPlanning: '', sensoryRegulation: '' });
    expect(requestPassed().activityDetails).toEqual([{ name: 'Trampoline - Strengthening' }]);
  });

  it('drops unknown keys and caps lengths on the way in', async () => {
    const body = {
      ...CLIENT_BODY,
      activityAssessments: [
        { name: 'Trampoline - Strengthening', assessment: { assistance: '  Minimal Assist  ', bogus: 'x', cueingLevel: 'y'.repeat(300) }, extra: 1 },
      ],
    };
    await request(app).post('/api/ai/generate-soap-billing').send(body).expect(200);
    const d = requestPassed().activityDetails[0];
    expect(d.assistance).toBe('Minimal Assist');
    expect(d.cueingLevel).toHaveLength(100);
    expect(d).not.toHaveProperty('bogus');
    expect(d).not.toHaveProperty('extra');
  });
});

describe('soapAssessment helpers', () => {
  it('normalizeActivityAssessments tolerates junk', () => {
    expect(normalizeActivityAssessments(undefined)).toBeUndefined();
    expect(normalizeActivityAssessments('nope')).toBeUndefined();
    expect(normalizeActivityAssessments([null, 5, { noName: true }, { name: 'A', assessment: 'string' }])).toEqual([{ name: 'A' }]);
  });

  it('deriveGlobalAssessment keeps the full shape and only fills blanks', () => {
    const out = deriveGlobalAssessment({ assistance: '' }, [{ name: 'A', assistance: 'Independent' }, { name: 'B' }]);
    expect(out).toEqual({ performance: '', assistance: 'Independent', strength: '', motorPlanning: '', sensoryRegulation: '' });
  });
});
