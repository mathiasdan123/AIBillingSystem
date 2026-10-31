/**
 * server/routes/ai.ts (POST /api/ai/generate-soap-billing) used to default a
 * blank Mood or Plan Next Steps field to a plausible-sounding value --
 * `mood || 'Cooperative'`, `planNextSteps || 'Continue Current Goals'` --
 * before calling generateSoapNoteAndBilling. That fabricates therapist input
 * the service never actually received as blank, which silently defeats two
 * independent safeguards at once:
 *   - buildUserPrompt's own "(not recorded — omit this detail)" instruction,
 *     which only fires when the field is genuinely falsy.
 *   - the mood-fabrication backstop (stripUnsupportedMoodClause), whose
 *     `hasMood = !!request.mood` check treats any truthy value as a real,
 *     therapist-supplied mood that's safe to keep.
 *
 * Confirmed in production (Mia Example, clean-room patient, Mood/Behavior
 * and Plan Next Steps both left blank in the UI): the generated note still
 * said "Mia presented as cooperative during today's session" and the Plan
 * said "Continue current treatment frequency" -- both "supported" only
 * because this route had invented the supporting input itself.
 *
 * The same anti-pattern existed independently in the Blanche AI-assistant
 * tool-call path (server/routes/ai-assistant.ts) -- see
 * blancheSoapBlankFieldPassthrough.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, mockGenerate } = vi.hoisted(() => ({
  mockStorage: {
    getUser: vi.fn(),
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
    totalReimbursement: 0, billingRationale: '',
  });
});

describe('POST /api/ai/generate-soap-billing — blank field passthrough', () => {
  it('does not default an omitted mood to a fabricated value', async () => {
    await request(app)
      .post('/api/ai/generate-soap-billing')
      .send({ patientId: 1, activities: ['obstacle course'], duration: 45 });

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const sentRequest = mockGenerate.mock.calls[0][0];
    expect(sentRequest.mood).toBe('');
    expect(sentRequest.mood).not.toBe('Cooperative');
  });

  it('does not default an omitted planNextSteps to a fabricated value', async () => {
    await request(app)
      .post('/api/ai/generate-soap-billing')
      .send({ patientId: 1, activities: ['obstacle course'], duration: 45 });

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const sentRequest = mockGenerate.mock.calls[0][0];
    expect(sentRequest.planNextSteps).toBe('');
    expect(sentRequest.planNextSteps).not.toBe('Continue Current Goals');
  });

  it('still passes through a real, therapist-supplied mood and plan unchanged', async () => {
    await request(app)
      .post('/api/ai/generate-soap-billing')
      .send({
        patientId: 1,
        activities: ['obstacle course'],
        duration: 45,
        mood: 'Anxious',
        planNextSteps: 'Work on bilateral coordination',
      });

    const sentRequest = mockGenerate.mock.calls[0][0];
    expect(sentRequest.mood).toBe('Anxious');
    expect(sentRequest.planNextSteps).toBe('Work on bilateral coordination');
  });
});
