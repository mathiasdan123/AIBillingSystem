import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * Regression: appeals routes must fetch the real practice (name, NPI, address,
 * phone) when generating letters — not the hardcoded { name: 'Practice', npi: null }
 * stub that used to ship to the AI prompt and end up in payer-facing letters.
 */

const { generateAppealMock, storageStub } = vi.hoisted(() => ({
  generateAppealMock: vi.fn(async () => ({
    appealLetter: 'LETTER_BODY',
    denialCategory: 'medical_necessity',
    keyArguments: [],
  })),
  storageStub: {
    getClaim: vi.fn(),
    getPatient: vi.fn(),
    getClaimLineItems: vi.fn(async () => []),
    getPractice: vi.fn(),
    createAppeal: vi.fn(async (data: any) => ({ id: 555, ...data })),
    getAppealById: vi.fn(),
    updateAppealRecord: vi.fn(async (id: number, data: any) => ({ id, ...data })),
    updateClaim: vi.fn(async () => ({})),
  },
}));

vi.mock('../aiAppealGenerator', () => ({
  appealGenerator: { generateAppeal: generateAppealMock },
}));

vi.mock('../storage', () => ({ storage: storageStub }));

// Block transitive imports from pulling in the real db connection.
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/appealOutcomeLearningService', () => ({
  recordAppealOutcome: vi.fn(),
}));

vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'user-1' } };
    req.userPracticeId = 7;
    req.userRole = 'therapist';
    next();
  },
}));

vi.mock('../services/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import appealsRouter from '../routes/appeals';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', appealsRouter);
  return app;
}

beforeEach(() => {
  generateAppealMock.mockClear();
  Object.values(storageStub).forEach((fn) => (fn as any).mockClear?.());
});

describe('POST /api/appeals — practice context', () => {
  it("populates practice name/NPI/address/phone from storage.getPractice (not the 'Practice' stub)", async () => {
    storageStub.getClaim.mockResolvedValueOnce({
      id: 42,
      status: 'denied',
      patientId: 99,
      denialReason: 'not medically necessary',
    });
    storageStub.getPatient.mockResolvedValueOnce({
      id: 99,
      firstName: 'Jane',
      lastName: 'Doe',
      dateOfBirth: '1990-01-01',
    });
    storageStub.getPractice.mockResolvedValueOnce({
      id: 7,
      name: 'Sunrise Therapy',
      npi: '1234567890',
      address: '500 Main St, Springfield, IL',
      phone: '555-0100',
    });

    await request(makeApp())
      .post('/api/appeals')
      .send({ claimId: 42, deadlineDate: '2026-07-01', notes: 'first level' })
      .expect(200);

    expect(storageStub.getPractice).toHaveBeenCalledWith(7);
    expect(generateAppealMock).toHaveBeenCalledTimes(1);
    const practiceArg = generateAppealMock.mock.calls[0][3];
    expect(practiceArg).toEqual({
      name: 'Sunrise Therapy',
      npi: '1234567890',
      address: '500 Main St, Springfield, IL',
      phone: '555-0100',
    });
  });

  it('falls back to safe placeholders when storage.getPractice returns null', async () => {
    storageStub.getClaim.mockResolvedValueOnce({
      id: 42,
      status: 'denied',
      patientId: 99,
      denialReason: 'x',
    });
    storageStub.getPatient.mockResolvedValueOnce({
      id: 99,
      firstName: 'Jane',
      lastName: 'Doe',
    });
    storageStub.getPractice.mockResolvedValueOnce(null);

    await request(makeApp()).post('/api/appeals').send({ claimId: 42 }).expect(200);

    const practiceArg = generateAppealMock.mock.calls[0][3];
    expect(practiceArg).toEqual({
      name: 'Practice',
      npi: null,
      address: null,
      phone: null,
    });
  });
});

describe('POST /api/appeals/:id/regenerate-letter — practice context', () => {
  it('fetches practice via appeal.practiceId and passes it to the generator', async () => {
    storageStub.getAppealById.mockResolvedValueOnce({
      id: 12,
      claimId: 42,
      practiceId: 11,
      status: 'pending',
    });
    storageStub.getClaim.mockResolvedValueOnce({
      id: 42,
      patientId: 99,
      denialReason: 'x',
    });
    storageStub.getPatient.mockResolvedValueOnce({
      id: 99,
      firstName: 'Jane',
      lastName: 'Doe',
    });
    storageStub.getPractice.mockResolvedValueOnce({
      id: 11,
      name: 'Big Practice',
      npi: '9999999999',
      address: '1 Plaza',
      phone: '555-9999',
    });

    await request(makeApp())
      .post('/api/appeals/12/regenerate-letter')
      .send({ additionalContext: '' })
      .expect(200);

    expect(storageStub.getPractice).toHaveBeenCalledWith(11);
    const practiceArg = generateAppealMock.mock.calls[0][3];
    expect(practiceArg.name).toBe('Big Practice');
    expect(practiceArg.npi).toBe('9999999999');
  });
});
