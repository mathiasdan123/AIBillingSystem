/**
 * Demo-only forceFallback fixture on POST /api/ai/generate-soap-billing
 * (therapybill-qa #2).
 *
 * The flag exists so the fallback generator (what every practice gets when the
 * AI is unavailable) can be exercised in the demo without taking the AI down.
 * The whole point of these tests is the gate: the flag must reach the service
 * ONLY when the caller's practice is a demo practice. A real practice sending
 * it must get ordinary AI generation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, mockGenerate } = vi.hoisted(() => ({
  mockStorage: {
    getUser: vi.fn(),
    getPractice: vi.fn(),
  },
  mockGenerate: vi.fn(),
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'u1' } };
    next();
  },
}));
vi.mock('../services/aiSoapBillingService', () => ({
  generateSoapNoteAndBilling: mockGenerate,
}));

import aiRouter from '../routes/ai';

const BODY = { patientId: 7, activities: ['Obstacle Course'], duration: 45 };

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
    totalReimbursement: 0, billingRationale: '', generationMode: 'fallback',
  });
});

const optionsPassed = () => mockGenerate.mock.calls[0][1];

describe('POST /api/ai/generate-soap-billing — demo-only forceFallback', () => {
  it('passes forceFallback=true to the service for a DEMO practice', async () => {
    mockStorage.getPractice.mockResolvedValue({ id: 1, isDemo: true });

    await request(app).post('/api/ai/generate-soap-billing').send({ ...BODY, forceFallback: true }).expect(200);

    expect(mockStorage.getPractice).toHaveBeenCalledWith(1);
    expect(optionsPassed().forceFallback).toBe(true);
  });

  it('ignores forceFallback for a REAL practice: the service gets false', async () => {
    mockStorage.getPractice.mockResolvedValue({ id: 1, isDemo: false });

    await request(app).post('/api/ai/generate-soap-billing').send({ ...BODY, forceFallback: true }).expect(200);

    expect(optionsPassed().forceFallback).toBe(false);
  });

  it('ignores forceFallback when the practice row cannot be found', async () => {
    mockStorage.getPractice.mockResolvedValue(undefined);

    await request(app).post('/api/ai/generate-soap-billing').send({ ...BODY, forceFallback: true }).expect(200);

    expect(optionsPassed().forceFallback).toBe(false);
  });

  it('does not look up the practice or set the flag when the body omits it', async () => {
    await request(app).post('/api/ai/generate-soap-billing').send(BODY).expect(200);

    expect(mockStorage.getPractice).not.toHaveBeenCalled();
    expect(optionsPassed().forceFallback).toBe(false);
  });

  it('only accepts a literal boolean true (no "true" strings, no 1)', async () => {
    mockStorage.getPractice.mockResolvedValue({ id: 1, isDemo: true });

    await request(app).post('/api/ai/generate-soap-billing').send({ ...BODY, forceFallback: 'true' }).expect(200);
    expect(mockStorage.getPractice).not.toHaveBeenCalled();
    expect(optionsPassed().forceFallback).toBe(false);
  });
});
