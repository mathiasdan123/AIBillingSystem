/**
 * GET /api/ai/appeal-prompt-preview/:claimId is admin-only, and every
 * practice's own admin has role 'admin', so the tenant check after it must
 * not be conditioned on the role. It now applies to everyone except the
 * platform admin and answers 404 for another practice's claim, like the
 * other claim guards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, authCtx, dbState } = vi.hoisted(() => ({
  mockStorage: {
    getClaim: vi.fn(),
    getPatient: vi.fn(async () => ({ id: 5, firstName: 'A', lastName: 'B' })),
    getPractice: vi.fn(async () => ({ id: 99, name: 'Other' })),
    getClaimLineItems: vi.fn(async () => []),
    getCptCodes: vi.fn(async () => []),
    getIcd10Codes: vi.fn(async () => []),
  },
  authCtx: { role: 'admin', practiceId: 2 as number | null, platformAdmin: false },
  dbState: { rows: [] as any[] },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => {
  const chain: any = { from: () => chain, where: () => chain, limit: () => Promise.resolve(dbState.rows) };
  return { db: { select: () => chain } };
});
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'u1' } };
    req.userPracticeId = authCtx.practiceId;
    req.userRole = authCtx.role;
    req.isPlatformAdmin = authCtx.platformAdmin;
    next();
  },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/claudeAppealService', () => ({ buildSystemPrompt: () => 'SYSTEM', buildUserPrompt: () => 'USER' }));
vi.mock('../services/claimPrecedentService', () => ({ findPrecedentsForDeniedClaim: vi.fn(async () => []) }));
vi.mock('../services/appealOutcomeLearningService', () => ({ getProvenArgumentsForContext: vi.fn(async () => []) }));
vi.mock('../storage/patients', () => ({ getPatientPlanBenefits: vi.fn(async () => null) }));

import aiAppealDebugRouter from '../routes/ai-appeal-debug';

const OTHER_PRACTICE_CLAIM = { id: 47, practiceId: 99, patientId: 5, claimNumber: 'CLM-47', denialReason: 'CO-197', totalAmount: '100.00', status: 'denied' };

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiAppealDebugRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  authCtx.role = 'admin';
  authCtx.practiceId = 2;
  authCtx.platformAdmin = false;
  dbState.rows = [OTHER_PRACTICE_CLAIM];
  mockStorage.getClaim.mockResolvedValue(OTHER_PRACTICE_CLAIM);
});

describe('GET /api/ai/appeal-prompt-preview/:claimId tenant guard', () => {
  it('a practice admin from another practice gets 404 and no prompt', async () => {
    const res = await request(buildApp()).get('/api/ai/appeal-prompt-preview/47');
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/);
    expect(res.body).not.toHaveProperty('systemPrompt');
    expect(mockStorage.getClaimLineItems).not.toHaveBeenCalled();
  });

  it('…also when the claim is looked up by claim number', async () => {
    const res = await request(buildApp()).get('/api/ai/appeal-prompt-preview/CLM-47');
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('systemPrompt');
  });

  it('a non-admin is refused before any lookup', async () => {
    authCtx.role = 'billing';
    const res = await request(buildApp()).get('/api/ai/appeal-prompt-preview/47');
    expect(res.status).toBe(403);
    expect(mockStorage.getClaim).not.toHaveBeenCalled();
  });

  it('a practice admin can preview their own practice\'s claim', async () => {
    authCtx.practiceId = 99;
    const res = await request(buildApp()).get('/api/ai/appeal-prompt-preview/47');
    expect(res.status).toBe(200);
    expect(res.body.systemPrompt).toBe('SYSTEM');
  });

  it('a platform admin can preview another practice\'s claim', async () => {
    authCtx.platformAdmin = true;
    const res = await request(buildApp()).get('/api/ai/appeal-prompt-preview/47');
    expect(res.status).toBe(200);
    expect(res.body.systemPrompt).toBe('SYSTEM');
  });
});
