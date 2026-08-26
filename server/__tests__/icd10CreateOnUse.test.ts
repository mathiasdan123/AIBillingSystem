/**
 * Adding an ICD-10 code to the catalog on first use.
 *
 * The catalog seeds ~21 pediatric-therapy codes; the full set is ~70k and is
 * deliberately not preloaded. A therapist typing a legitimate code they use
 * daily must never be stuck behind "not in the list" — that is the same dead
 * end the empty catalog was on 2026-08-26, one layer up.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  existing: [] as any[],
  created: vi.fn(),
}));

vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.userPracticeId = 1;
    req.user = { claims: { sub: 'u1' } };
    next();
  },
}));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../db', () => ({ db: {}, getDb: () => ({}), getPool: async () => ({}) }));
vi.mock('../storage', () => ({
  storage: {
    getIcd10Codes: async () => H.existing,
    createIcd10Code: H.created,
    getPracticeCptCodes: async () => [],
  },
}));

import sessionsRouter from '../routes/sessions';

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  H.existing = [{ id: 5, code: 'F84.0', description: 'Autistic disorder' }];
  H.created.mockImplementation(async (d: any) => ({ id: 99, ...d }));
  app = express();
  app.use(express.json());
  app.use('/api', sessionsRouter);
});

describe('POST /api/icd10-codes', () => {
  it('creates a well-formed code, normalized to upper case', async () => {
    const res = await request(app).post('/api/icd10-codes').send({ code: 'r62.50' });

    expect(res.status).toBe(201);
    expect(H.created).toHaveBeenCalledWith({
      code: 'R62.50',
      description: 'ICD-10 R62.50',
      category: 'custom',
    });
  });

  it('is idempotent — an existing code returns the existing row', async () => {
    const res = await request(app).post('/api/icd10-codes').send({ code: 'f84.0' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(5);
    expect(H.created).not.toHaveBeenCalled();
  });

  it('rejects things that are not ICD-10 codes', async () => {
    for (const bad of ['autism', '123', 'F', 'U07.1', 'hello world', '']) {
      const res = await request(app).post('/api/icd10-codes').send({ code: bad });
      // 'U' codes are excluded by the format class ([A-TV-Z]) along with
      // free text — a typo must not become a permanent catalog entry.
      expect(res.status, `"${bad}" should be rejected`).toBe(400);
    }
    expect(H.created).not.toHaveBeenCalled();
  });

  it('accepts undotted-extension codes like F82', async () => {
    const res = await request(app).post('/api/icd10-codes').send({ code: 'F82' });
    expect(res.status).toBe(201);
  });
});
