/**
 * GET /api/practices/:id returned the whole practice row, for any id, to any
 * authenticated user — and getPractice DECRYPTS taxId and stediApiKey. So a
 * user at one practice could read another practice's EIN and its live
 * clearinghouse credential, then file claims under their identity.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: { getPractice: vi.fn(), updatePractice: vi.fn(), getUser: vi.fn() },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'u1' } };
    req.userPracticeId = 1;
    req.userRole = 'admin';
    req.isPlatformAdmin = req.headers['x-platform'] === '1';
    next();
  },
}));

import practicesRouter from '../routes/practices';

const PRACTICE = {
  id: 1,
  name: 'Wonder Kids',
  taxId: '123456789',
  stediApiKey: 'live_secret_clearinghouse_key',
  ownerSignature: 'Blanche Buchwald',
  npi: '1023896321',
};

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/api/practices', practicesRouter);
  mockStorage.getPractice.mockImplementation(async (id: number) => ({ ...PRACTICE, id }));
});

describe('GET /api/practices/:id', () => {
  it("refuses another practice, without confirming it exists", async () => {
    const res = await request(app).get('/api/practices/2');

    expect(res.status).toBe(404);
    // Must not have even loaded the row.
    expect(mockStorage.getPractice).not.toHaveBeenCalled();
  });

  it('never returns the clearinghouse credential, even for your own practice', async () => {
    const res = await request(app).get('/api/practices/1');

    expect(res.status).toBe(200);
    expect(res.body.stediApiKey).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('live_secret_clearinghouse_key');
    // The UI only needs to know whether one is configured.
    expect(res.body.stediApiKeySet).toBe(true);
  });

  it('reports no key configured as false rather than omitting the field', async () => {
    mockStorage.getPractice.mockResolvedValue({ ...PRACTICE, stediApiKey: null });

    const res = await request(app).get('/api/practices/1');

    expect(res.body.stediApiKeySet).toBe(false);
  });

  it('does not return the owner signature', async () => {
    const res = await request(app).get('/api/practices/1');
    expect(res.body.ownerSignature).toBeUndefined();
  });

  it('still returns the fields the settings form edits', async () => {
    const res = await request(app).get('/api/practices/1');

    expect(res.body.name).toBe('Wonder Kids');
    expect(res.body.npi).toBe('1023896321');
    // taxId stays for the practice's own admin — it is their EIN and the
    // settings form edits it. The cross-tenant read is what was dangerous.
    expect(res.body.taxId).toBe('123456789');
  });

  it('lets a platform admin read another practice (support/ops)', async () => {
    const res = await request(app).get('/api/practices/2').set({ 'x-platform': '1' });

    expect(res.status).toBe(200);
    // Still no credential, even for the operator.
    expect(res.body.stediApiKey).toBeUndefined();
  });
});
