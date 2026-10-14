/**
 * Role-gating audit — admin gates and fail-closed practice context
 * (F2, F13, F14, F18 + the pdms2 platform-admin fallback).
 *
 * practices.ts (F12) is covered in mcpSettingsRoute.test.ts, auth.ts
 * (F16/F17) in authRoutes.test.ts, and soap-intervention-templates (F15) in
 * soapInterventionTemplates.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, authCtx, dbState } = vi.hoisted(() => ({
  mockStorage: {
    getUser: vi.fn(),
    getPdms2AssessmentsForPatient: vi.fn(async () => []),
    getPdms2Assessment: vi.fn(),
    getPatient: vi.fn(),
    createPdms2Assessment: vi.fn(),
    updatePdms2Assessment: vi.fn(),
  },
  authCtx: { role: 'therapist', practiceId: 1 as number | null, isPlatformAdmin: false },
  dbState: { result: [] as any[] },
}));

// Only query CHAINS are thenable — the db object itself must not be, or
// `await getDb()` would resolve it away.
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
    req.isPlatformAdmin = authCtx.isPlatformAdmin;
    next();
  },
}));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// ai.ts module-load dependencies.
vi.mock('../aiReimbursementPredictor', () => ({ default: class {} }));
vi.mock('../services/aiSoapBillingService', () => ({ generateSoapNoteAndBilling: vi.fn() }));
vi.mock('../services/voiceService', () => ({
  transcribeAudioBase64: vi.fn(),
  isVoiceTranscriptionAvailable: () => false,
}));
vi.mock('../services/sessionRecorderService', () => ({
  processSessionRecording: vi.fn(),
  processTranscriptionText: vi.fn(),
}));
vi.mock('../services/oonReimbursementPredictor', () => ({
  predictOONReimbursement: vi.fn(),
  predictMultipleOON: vi.fn(),
  getSupportedPayers: vi.fn(() => []),
  getSupportedCPTCodes: vi.fn(() => []),
}));
vi.mock('../services/textToSpeechService', () => ({
  textToSpeech: vi.fn(),
  isTextToSpeechAvailable: () => false,
  getAvailableVoices: vi.fn(),
  soapNoteToSpeech: vi.fn(),
  appealLetterToSpeech: vi.fn(),
  VOICE_PRESETS: {},
}));
vi.mock('../middleware/rate-limiter', () => ({
  uploadLimiter: (_req: any, _res: any, next: any) => next(),
  exportLimiter: (_req: any, _res: any, next: any) => next(),
}));
const { generateProgressReportMock } = vi.hoisted(() => ({ generateProgressReportMock: vi.fn() }));
vi.mock('../services/progressReportService', () => ({
  generateProgressReport: generateProgressReportMock,
}));
vi.mock('../services/pdms2ScoringService', () => ({ computeAssessmentState: vi.fn(() => ({})) }));

import payerCrosswalkRouter from '../routes/payer-crosswalk';
import dataImportRouter from '../routes/data-import';
import credentialingRouter from '../routes/credentialing';
import aiRouter from '../routes/ai';
import pdms2Router from '../routes/pdms2';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/payer-crosswalk', payerCrosswalkRouter);
  app.use('/api/data-import', dataImportRouter);
  app.use('/api/credentialing', credentialingRouter);
  app.use('/api', aiRouter);
  app.use('/api', pdms2Router);
  return app;
}

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  authCtx.role = 'therapist';
  authCtx.practiceId = 1;
  authCtx.isPlatformAdmin = false;
  dbState.result = [];
  mockStorage.getUser.mockImplementation(async () => ({ id: 'u1', role: authCtx.role, practiceId: authCtx.practiceId }));
  app = buildApp();
});

describe('F2 — /api/admin/payer-crosswalk is admin-only at the mount', () => {
  it.each(['therapist', 'billing'])('%s gets 403 on every method', async (role) => {
    authCtx.role = role;
    expect((await request(app).get('/api/admin/payer-crosswalk')).status).toBe(403);
    expect((await request(app).post('/api/admin/payer-crosswalk').send({})).status).toBe(403);
    expect((await request(app).put('/api/admin/payer-crosswalk/1').send({})).status).toBe(403);
    expect((await request(app).delete('/api/admin/payer-crosswalk/1')).status).toBe(403);
  });

  it('admin can list', async () => {
    authCtx.role = 'admin';
    const res = await request(app).get('/api/admin/payer-crosswalk');
    expect(res.status).toBe(200);
  });
});

describe('F13 — /api/data-import is admin-only at the mount', () => {
  it.each(['therapist', 'billing'])('%s gets 403', async (role) => {
    authCtx.role = role;
    expect((await request(app).get('/api/data-import/history')).status).toBe(403);
    expect((await request(app).post('/api/data-import/paste').send({})).status).toBe(403);
  });

  it('admin reaches the handlers', async () => {
    authCtx.role = 'admin';
    const res = await request(app).get('/api/data-import/history');
    expect(res.status).toBe(200);
  });
});

describe('F14 — credentialing writes are admin-only, reads stay open', () => {
  it('therapist gets 403 on create/edit/delete and document upload/delete', async () => {
    expect((await request(app).post('/api/credentialing').send({})).status).toBe(403);
    expect((await request(app).patch('/api/credentialing/1').send({})).status).toBe(403);
    expect((await request(app).delete('/api/credentialing/1')).status).toBe(403);
    expect((await request(app).post('/api/credentialing/1/documents').send({})).status).toBe(403);
    expect((await request(app).delete('/api/credentialing/1/documents/2')).status).toBe(403);
  });

  it('therapist can still read the at-risk list', async () => {
    const res = await request(app).get('/api/credentialing/at-risk');
    expect(res.status).toBe(200);
  });
});

describe('F18 — POST /api/ai/progress-report requires a practice', () => {
  it('403s a caller with no practiceId instead of generating cross-tenant PHI', async () => {
    authCtx.practiceId = null;
    mockStorage.getUser.mockResolvedValue({ id: 'u1', role: 'therapist', practiceId: null });

    const res = await request(app)
      .post('/api/ai/progress-report')
      .send({ patientId: 1, from: '2026-09-01', to: '2026-09-30' });

    expect(res.status).toBe(403);
    expect(generateProgressReportMock).not.toHaveBeenCalled();
  });

  it('passes the caller practiceId through when present', async () => {
    mockStorage.getUser.mockResolvedValue({ id: 'u1', role: 'therapist', practiceId: 7 });
    generateProgressReportMock.mockResolvedValue({ report: {}, meta: { sessionsReviewed: 1, from: 'a', to: 'b' } });

    const res = await request(app)
      .post('/api/ai/progress-report')
      .send({ patientId: 1, from: '2026-09-01', to: '2026-09-30' });

    expect(res.status).toBe(200);
    expect(generateProgressReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ practiceId: 7, patientId: 1 }),
    );
  });
});

describe('pdms2 — platform-admin practice fallback is a 400, not practice 1', () => {
  it('400s a platform admin with no practice and no ?practiceId', async () => {
    authCtx.role = 'admin';
    authCtx.isPlatformAdmin = true;
    authCtx.practiceId = null;

    const res = await request(app).get('/api/pdms2-assessments?patientId=1');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/practiceId is required/i);
    expect(mockStorage.getPdms2AssessmentsForPatient).not.toHaveBeenCalled();
  });

  it('a platform admin naming a practice still works', async () => {
    authCtx.role = 'admin';
    authCtx.isPlatformAdmin = true;
    authCtx.practiceId = null;

    const res = await request(app).get('/api/pdms2-assessments?patientId=1&practiceId=4');
    expect(res.status).toBe(200);
    expect(mockStorage.getPdms2AssessmentsForPatient).toHaveBeenCalledWith(1, 4);
  });
});
