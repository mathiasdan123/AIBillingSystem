import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * Tenant scoping: every single-appeal route under /api/appeals/:id must refuse
 * to act on an appeal that belongs to a different practice than the caller's.
 * The route should return 404 (not 403) to avoid leaking the existence of
 * cross-practice records.
 */

const { storageStub, generateAppealMock } = vi.hoisted(() => ({
  storageStub: {
    getAppealById: vi.fn(),
    getClaim: vi.fn(async () => ({ id: 1, patientId: 1 })),
    getPatient: vi.fn(async () => ({ id: 1, firstName: 'X', lastName: 'Y' })),
    getClaimLineItems: vi.fn(async () => []),
    getPractice: vi.fn(async () => ({ id: 99, name: 'P', npi: '1', address: 'A', phone: 'P' })),
    updateAppealRecord: vi.fn(async (id: number, data: any) => ({ id, ...data })),
    updateClaim: vi.fn(async () => ({})),
    submitAppeal: vi.fn(async (id: number) => ({ id, status: 'submitted' })),
    createAppeal: vi.fn(async (data: any) => ({ id: 999, ...data })),
  },
  generateAppealMock: vi.fn(async () => ({
    appealLetter: 'X',
    denialCategory: null,
    keyArguments: [],
  })),
}));

vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/appealOutcomeLearningService', () => ({
  recordAppealOutcome: vi.fn(),
}));
vi.mock('../aiAppealGenerator', () => ({
  appealGenerator: { generateAppeal: generateAppealMock },
}));
vi.mock('../services/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// Simulate an authenticated user belonging to practice 7.
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'user-1' } };
    req.userPracticeId = 7;
    req.userRole = 'therapist';
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

beforeEach(() => {
  Object.values(storageStub).forEach((fn) => (fn as any).mockReset?.());
  generateAppealMock.mockClear();

  // Re-arm safe defaults after mockReset.
  storageStub.getClaim.mockResolvedValue({ id: 1, patientId: 1 } as any);
  storageStub.getPatient.mockResolvedValue({ id: 1, firstName: 'X', lastName: 'Y' } as any);
  storageStub.getClaimLineItems.mockResolvedValue([] as any);
  storageStub.getPractice.mockResolvedValue({ id: 7, name: 'P', npi: '1' } as any);
  storageStub.updateAppealRecord.mockImplementation(async (id: number, data: any) => ({ id, ...data }) as any);
  storageStub.updateClaim.mockResolvedValue({} as any);
  storageStub.submitAppeal.mockImplementation(async (id: number) => ({ id, status: 'submitted' }) as any);
});

const FOREIGN_APPEAL = {
  id: 42,
  practiceId: 99, // <-- belongs to a DIFFERENT practice
  claimId: 1,
  status: 'pending',
  appealLetter: 'old',
  resolvedDate: null,
};

const OWN_APPEAL = {
  id: 42,
  practiceId: 7, // <-- same practice as the authenticated user
  claimId: 1,
  status: 'pending',
  appealLetter: 'old',
  resolvedDate: null,
};

describe('appeals tenant scoping — cross-practice access returns 404', () => {
  // (method, path, body) — covers every single-appeal route.
  const cases: Array<[string, string, any]> = [
    ['get', '/api/appeals/42', undefined],
    ['patch', '/api/appeals/42', { notes: 'edit' }],
    ['post', '/api/appeals/42/submit', {}],
    ['post', '/api/appeals/42/resolve', { outcome: 'won' }],
    ['post', '/api/appeals/42/escalate', {}],
    ['post', '/api/appeals/42/regenerate-letter', { additionalContext: '' }],
  ];

  for (const [method, path, body] of cases) {
    it(`${method.toUpperCase()} ${path} returns 404 when the appeal belongs to another practice`, async () => {
      storageStub.getAppealById.mockResolvedValueOnce(FOREIGN_APPEAL as any);
      const req = (request(makeApp()) as any)[method](path);
      const res = await (method === 'get' ? req : req.send(body ?? {}));
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'Appeal not found' });
      // None of the mutation paths should have fired.
      expect(storageStub.updateAppealRecord).not.toHaveBeenCalled();
      expect(storageStub.submitAppeal).not.toHaveBeenCalled();
      expect(storageStub.createAppeal).not.toHaveBeenCalled();
      expect(generateAppealMock).not.toHaveBeenCalled();
    });
  }

  it('GET /api/appeals/:id returns 200 when the appeal is in the caller’s practice', async () => {
    storageStub.getAppealById.mockResolvedValueOnce(OWN_APPEAL as any);
    const res = await request(makeApp()).get('/api/appeals/42');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(42);
  });

  it('returns 404 (not 403) — must not leak existence', async () => {
    storageStub.getAppealById.mockResolvedValueOnce(FOREIGN_APPEAL as any);
    const res = await request(makeApp()).get('/api/appeals/42');
    expect(res.status).not.toBe(403);
    expect(res.body.message).toBe('Appeal not found'); // identical to "no such id" wording
  });
});
