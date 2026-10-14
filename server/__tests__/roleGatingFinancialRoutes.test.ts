/**
 * Role-gating audit — per-route financial gates (F1, F3, F4, F5, F10 + the
 * new /api/expenses router).
 *
 * Every gate added inside a router (as opposed to the routes.ts prefix
 * block, which roleGatingPrefixes.test.ts covers) gets a therapist-403
 * assertion here, plus the F1 tenant-scoping contract: the insurance-rates
 * routes must pass the caller's practiceId into storage on every read,
 * write and delete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, authCtx, dbState } = vi.hoisted(() => ({
  mockStorage: {
    getUser: vi.fn(),
    getInsuranceRates: vi.fn(async () => []),
    getUniqueInsuranceProviders: vi.fn(async () => []),
    upsertInsuranceRate: vi.fn(async (r: any) => ({ id: 1, ...r })),
    deleteInsuranceRate: vi.fn(async () => undefined),
    getExpenses: vi.fn(async () => []),
    createExpense: vi.fn(async (e: any) => ({ id: 7, ...e })),
  },
  authCtx: { role: 'therapist', practiceId: 1 as number | null },
  dbState: { result: [] as any[] },
}));

// Chainable, awaitable drizzle stub: any method call keeps chaining, awaiting
// resolves to dbState.result (same approach as sessionLog.test.ts, but
// generic so it tolerates arbitrary select/join/where/orderBy chains).
// The db OBJECT itself must not be thenable — `await getDb()` would resolve
// it away — so only the query chains are.
function fluent(): any {
  const target: any = () => {};
  const proxy: any = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: any, reject: any) => Promise.resolve(dbState.result).then(resolve, reject);
      }
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}
function fluentDb(): any {
  return {
    select: () => fluent(),
    selectDistinct: () => fluent(),
    insert: () => fluent(),
    update: () => fluent(),
    delete: () => fluent(),
    execute: async () => ({ rows: dbState.result }),
  };
}

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: fluentDb(),
  getDb: async () => fluentDb(),
  dbReady: Promise.resolve(),
}));
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'u1' } };
    req.userPracticeId = authCtx.practiceId;
    req.userRole = authCtx.role;
    next();
  },
}));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/cacheService', () => ({
  cache: { get: async () => null, set: async () => {}, del: async () => {} },
  CacheKeys: new Proxy({}, { get: () => () => 'cache-key' }),
  CacheTTL: new Proxy({}, { get: () => 60 }),
}));
vi.mock('../services/phiEncryptionService', () => ({
  decryptField: (v: any) => v,
  resolveEncryptedDob: (_enc: any, plain: any) => plain,
  decryptPatientRecord: (r: any) => r,
  decryptSoapNoteRecord: (r: any) => r,
  decryptTreatmentSessionRecord: (r: any) => r,
}));
// insurance.ts pulls several heavy services at module load — stub them.
vi.mock('../payer-integrations/adapters/payers/StediAdapter', () => ({ StediAdapter: class {} }));
vi.mock('../services/planDocumentParser', () => ({
  parsePlanDocument: vi.fn(),
  parsePlanDocumentFromPDF: vi.fn(),
  benefitsToInsertFormat: vi.fn(),
}));
vi.mock('../services/insuranceCostEstimator', () => ({
  parseInsuranceContract: vi.fn(),
  saveContractRates: vi.fn(async () => ({ saved: 0, errors: [] })),
  estimatePatientCost: vi.fn(),
  getQuickEstimate: vi.fn(),
}));
vi.mock('../services/oonReimbursementPredictor', () => ({
  predictOONReimbursement: vi.fn(),
}));
vi.mock('../middleware/rate-limiter', () => ({
  uploadLimiter: (_req: any, _res: any, next: any) => next(),
  exportLimiter: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../middleware/file-validator', () => ({
  createFileValidator: () => (_req: any, _res: any, next: any) => next(),
  FileValidationContexts: { INSURANCE_CONTRACT: 'insurance_contract' },
}));
vi.mock('../services/insightsReportService', () => ({
  generateDailyReport: vi.fn(),
  generateWeeklyReport: vi.fn(),
}));
vi.mock('../services/emailService', () => ({
  sendEmail: vi.fn(),
  isSmtpConfigured: () => false,
}));

import insuranceRouter from '../routes/insurance';
import exportRouter from '../routes/export';
import analyticsRouter from '../routes/analytics';
import cannedReportsRouter from '../routes/canned-reports';
import customReportsRouter from '../routes/reports';
import expensesRouter from '../routes/expenses';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  // Same mounts routes.ts uses for these routers.
  app.use('/api', insuranceRouter);
  app.use('/api/export', exportRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/reports/custom', customReportsRouter);
  app.use('/api/reports', cannedReportsRouter);
  app.use('/api/expenses', expensesRouter);
  return app;
}

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  authCtx.role = 'therapist';
  authCtx.practiceId = 1;
  dbState.result = [];
  mockStorage.getUser.mockImplementation(async () => ({ id: 'u1', role: authCtx.role, practiceId: authCtx.practiceId }));
  mockStorage.getInsuranceRates.mockResolvedValue([]);
  mockStorage.getUniqueInsuranceProviders.mockResolvedValue([]);
  mockStorage.upsertInsuranceRate.mockImplementation(async (r: any) => ({ id: 1, ...r }));
  mockStorage.getExpenses.mockResolvedValue([]);
  mockStorage.createExpense.mockImplementation(async (e: any) => ({ id: 7, ...e }));
  app = buildApp();
});

describe('F1 — /api/insurance-rates', () => {
  it.each([
    ['get', '/api/insurance-rates'],
    ['get', '/api/insurance-rates/providers'],
    ['post', '/api/insurance-rates'],
    ['delete', '/api/insurance-rates/5'],
    ['post', '/api/insurance-rates/parse-contract'],
    ['post', '/api/insurance-rates/save-parsed'],
  ] as const)('therapist gets 403 on %s %s', async (method, url) => {
    const res = await (request(app) as any)[method](url).send({});
    expect(res.status).toBe(403);
    expect(mockStorage.getInsuranceRates).not.toHaveBeenCalled();
    expect(mockStorage.upsertInsuranceRate).not.toHaveBeenCalled();
    expect(mockStorage.deleteInsuranceRate).not.toHaveBeenCalled();
  });

  it('scopes reads to the caller practice', async () => {
    authCtx.role = 'billing';
    const res = await request(app).get('/api/insurance-rates');
    expect(res.status).toBe(200);
    expect(mockStorage.getInsuranceRates).toHaveBeenCalledWith(undefined, 1);
  });

  it('stamps writes with the caller practice, ignoring a spoofed practiceId in the body', async () => {
    authCtx.role = 'billing';
    const res = await request(app)
      .post('/api/insurance-rates')
      .send({ insuranceProvider: 'Aetna', cptCode: '97530', inNetworkRate: '120.00', practiceId: 999 });
    expect(res.status).toBe(200);
    expect(mockStorage.upsertInsuranceRate).toHaveBeenCalledWith(
      expect.objectContaining({ insuranceProvider: 'Aetna', cptCode: '97530', practiceId: 1 }),
    );
  });

  it('scopes deletes to the caller practice', async () => {
    authCtx.role = 'billing';
    const res = await request(app).delete('/api/insurance-rates/5');
    expect(res.status).toBe(200);
    expect(mockStorage.deleteInsuranceRate).toHaveBeenCalledWith(5, 1);
  });
});

describe('F3 — /api/export', () => {
  it('therapist gets 403 on claims and statements exports', async () => {
    for (const url of ['/api/export/claims', '/api/export/statements']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(403);
    }
  });

  it('billing may export claims (gate is financial, not admin)', async () => {
    authCtx.role = 'billing';
    const res = await request(app).get('/api/export/claims');
    expect(res.status).toBe(200);
  });

  it('audit-log export is admin-only — even billing gets 403', async () => {
    for (const role of ['therapist', 'billing']) {
      authCtx.role = role;
      const res = await request(app).get('/api/export/audit-log');
      expect(res.status, role).toBe(403);
    }
    authCtx.role = 'admin';
    const res = await request(app).get('/api/export/audit-log');
    expect(res.status).toBe(200);
  });
});

describe('F4 — /api/reports/custom money report types', () => {
  it.each(['claims', 'revenue', 'payer_performance'])(
    'therapist gets 403 generating a %s report',
    async (reportType) => {
      const res = await request(app).post('/api/reports/custom/generate').send({ reportType });
      expect(res.status).toBe(403);
    },
  );

  it('therapist can still run clinical/operational report types', async () => {
    for (const reportType of ['appointments', 'clinical', 'operational']) {
      const res = await request(app).post('/api/reports/custom/generate').send({ reportType });
      expect(res.status, reportType).toBe(200);
    }
  });

  it('therapist gets 403 exporting a money report type', async () => {
    const res = await request(app).get('/api/reports/custom/export/csv?reportType=revenue');
    expect(res.status).toBe(403);
  });

  it('therapist gets 403 running a SAVED money report', async () => {
    dbState.result = [{ id: 3, reportType: 'claims', filters: null, groupBy: null }];
    const res = await request(app).get('/api/reports/custom/saved/3/run');
    expect(res.status).toBe(403);
  });

  it('billing can generate a money report', async () => {
    authCtx.role = 'billing';
    const res = await request(app).post('/api/reports/custom/generate').send({ reportType: 'revenue' });
    expect(res.status).toBe(200);
  });
});

describe('F5 — therapist productivity analytics', () => {
  it.each([
    '/api/analytics/therapist-productivity',
    '/api/analytics/therapist-productivity/trends',
  ])('therapist gets 403 on %s (consistent with Blanche FINANCIAL_TOOLS)', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(403);
  });

  it('billing passes the gate', async () => {
    authCtx.role = 'billing';
    const res = await request(app).get('/api/analytics/therapist-productivity');
    expect(res.status).toBe(200);
  });
});

describe('F10 — /api/reports/patient-credits', () => {
  it('therapist gets 403 (siblings timely-filing/adjustments already gated)', async () => {
    const res = await request(app).get('/api/reports/patient-credits');
    expect(res.status).toBe(403);
  });
});

describe('/api/expenses router (cleanup)', () => {
  // The role gate for /api/expenses lives in routes.ts as a prefix gate
  // (asserted by roleGatingPrefixes.test.ts); these cover tenant scoping.
  it('lists only the caller practice expenses', async () => {
    const res = await request(app).get('/api/expenses');
    expect(res.status).toBe(200);
    expect(mockStorage.getExpenses).toHaveBeenCalledWith(1);
  });

  it('forces practiceId and createdBy from the session on create', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .send({
        description: 'Therapy bands',
        amount: 42.5,
        category: 'supplies',
        expenseDate: '2026-10-01',
        practiceId: 999,
        createdBy: 'someone-else',
      });
    expect(res.status).toBe(201);
    expect(mockStorage.createExpense).toHaveBeenCalledWith(
      expect.objectContaining({ practiceId: 1, createdBy: 'u1', amount: '42.50' }),
    );
  });

  it('rejects malformed expense bodies', async () => {
    const res = await request(app).post('/api/expenses').send({ description: '', amount: -1 });
    expect(res.status).toBe(400);
    expect(mockStorage.createExpense).not.toHaveBeenCalled();
  });
});
