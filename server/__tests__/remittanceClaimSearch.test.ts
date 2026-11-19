/**
 * Manual ERA match: claim search (demo billing test 2026-11-19, item 3).
 * Patient names are encrypted at rest, so the endpoint resolves names from
 * the practice's decrypted patient list, matches claim numbers in SQL, and
 * returns decrypted names, never ciphertext.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { storageStub, dbStub } = vi.hoisted(() => ({
  storageStub: { getPatients: vi.fn() },
  dbStub: { rows: [] as any[], lastWhere: null as any, selectCalls: 0 },
}));
vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'biller-1' } };
    req.userPracticeId = 7;
    req.userRole = 'billing';
    next();
  },
}));
vi.mock('../db', () => ({
  db: {
    select: () => {
      dbStub.selectCalls++;
      return {
        from: () => ({
          where: (cond: any) => {
            dbStub.lastWhere = cond;
            return { orderBy: () => ({ limit: async () => dbStub.rows }) };
          },
        }),
      };
    },
  },
}));

import remittanceRouter from '../routes/remittance';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/remittance', remittanceRouter);
  return app;
}

describe('GET /api/remittance/claims/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbStub.rows = [];
    dbStub.lastWhere = null;
    dbStub.selectCalls = 0;
    storageStub.getPatients.mockResolvedValue([
      { id: 86, firstName: 'Ethan', lastName: 'Example' },
      { id: 87, firstName: 'Riley', lastName: 'Nodob', archivedAt: null },
    ]);
  });

  it('finds a claim by patient name through the decrypted patient list and returns decrypted names', async () => {
    dbStub.rows = [{ id: 73, claimNumber: 'CLM-MWNVFA08-DIJSKH', patientId: 86, totalAmount: '100.00', status: 'draft', createdAt: new Date('2026-11-19T13:00:00.000Z') }];
    const res = await request(makeApp()).get('/api/remittance/claims/search?q=Ethan%20Example').expect(200);
    expect(storageStub.getPatients).toHaveBeenCalledWith(7, { archived: 'include' });
    expect(res.body).toEqual([
      expect.objectContaining({ id: 73, claimNumber: 'CLM-MWNVFA08-DIJSKH', patientId: 86, patientFirstName: 'Ethan', patientLastName: 'Example', status: 'draft' }),
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/ciphertext/);
    // The claim query ran once, with a where clause (name hits become an id list in SQL).
    expect(dbStub.selectCalls).toBe(1);
    expect(dbStub.lastWhere).toBeTruthy();
  });

  it('matches "Last, First" and partial names, case-insensitively', async () => {
    dbStub.rows = [{ id: 73, claimNumber: 'CLM-1', patientId: 86, totalAmount: '100.00', status: 'submitted', createdAt: new Date() }];
    for (const q of ['example, ethan', 'ETHAN', 'exam']) {
      const res = await request(makeApp()).get(`/api/remittance/claims/search?q=${encodeURIComponent(q)}`).expect(200);
      expect(res.body[0].patientLastName).toBe('Example');
    }
  });

  it('still finds a claim by its number when no patient name matches', async () => {
    dbStub.rows = [{ id: 73, claimNumber: 'CLM-MWNVFA08-DIJSKH', patientId: 86, totalAmount: '100.00', status: 'draft', createdAt: new Date() }];
    const res = await request(makeApp()).get('/api/remittance/claims/search?q=MWNVFA08').expect(200);
    expect(res.body[0]).toMatchObject({ claimNumber: 'CLM-MWNVFA08-DIJSKH', patientFirstName: 'Ethan' });
  });

  it('labels a claim whose patient is not in the list as unknown rather than leaking anything', async () => {
    dbStub.rows = [{ id: 74, claimNumber: 'CLM-ORPHAN', patientId: 999, totalAmount: '50.00', status: 'draft', createdAt: new Date() }];
    const res = await request(makeApp()).get('/api/remittance/claims/search?q=ORPHAN').expect(200);
    expect(res.body[0]).toMatchObject({ patientFirstName: null, patientLastName: null });
  });

  it('requires at least two characters and a string', async () => {
    expect((await request(makeApp()).get('/api/remittance/claims/search?q=E').expect(200)).body).toEqual([]);
    expect((await request(makeApp()).get('/api/remittance/claims/search?q=Ethan&q=Example').expect(200)).body).toEqual([]);
    expect(dbStub.selectCalls).toBe(0);
  });
});
