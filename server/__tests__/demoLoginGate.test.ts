/**
 * The public demo logins are off unless DEMO_LOGIN_ENABLED=true (#500):
 * POST /api/demo-login is covered in authRoutes.test.ts; this file covers
 * the gate itself and GET /api/patient-portal/demo-login.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage, ensureDemoPractice } = vi.hoisted(() => ({
  mockStorage: {
    getPatients: vi.fn(),
    getPatientPortalAccess: vi.fn(),
    createPatientPortalAccess: vi.fn(),
    updatePatientPortalAccess: vi.fn(),
  },
  ensureDemoPractice: vi.fn(async () => ({ id: 99, isDemo: true })),
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../middleware/auditMiddleware', () => ({ logAuditEvent: vi.fn() }));
vi.mock('../services/emailService', () => ({ sendEmail: vi.fn() }));
vi.mock('../email', () => ({ isEmailConfigured: () => false }));
vi.mock('../services/demoPractice', () => ({ ensureDemoPractice }));

import publicPortalRouter from '../routes/public-portal';
import { DEMO_LOGIN_ENV_VAR, isDemoLoginEnabled } from '../services/demoLoginGate';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', publicPortalRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEMO_LOGIN_ENABLED;
  mockStorage.getPatients.mockResolvedValue([{ id: 7, practiceId: 99, firstName: 'Ava', lastName: 'Sample' }]);
  mockStorage.getPatientPortalAccess.mockResolvedValue({
    id: 1, patientId: 7, portalToken: 'tok', portalTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
});
afterEach(() => { delete process.env.DEMO_LOGIN_ENABLED; });

describe('isDemoLoginEnabled', () => {
  it('is DEMO_LOGIN_ENABLED, exactly "true" (case-insensitive, trimmed); default off', () => {
    expect(DEMO_LOGIN_ENV_VAR).toBe('DEMO_LOGIN_ENABLED');
    expect(isDemoLoginEnabled({})).toBe(false);
    expect(isDemoLoginEnabled({ DEMO_LOGIN_ENABLED: 'true' })).toBe(true);
    expect(isDemoLoginEnabled({ DEMO_LOGIN_ENABLED: ' TRUE ' })).toBe(true);
    expect(isDemoLoginEnabled({ DEMO_LOGIN_ENABLED: 'false' })).toBe(false);
    expect(isDemoLoginEnabled({ DEMO_LOGIN_ENABLED: '1' })).toBe(false);
    expect(isDemoLoginEnabled({ DEMO_LOGIN_ENABLED: '' })).toBe(false);
  });
});

describe('GET /api/patient-portal/demo-login', () => {
  it('answers 404 and touches nothing when the variable is not set (the default)', async () => {
    const res = await request(buildApp()).get('/api/patient-portal/demo-login');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not found' });
    expect(ensureDemoPractice).not.toHaveBeenCalled();
    expect(mockStorage.getPatients).not.toHaveBeenCalled();
    expect(mockStorage.createPatientPortalAccess).not.toHaveBeenCalled();
  });

  it('serves the demo patient portal token when DEMO_LOGIN_ENABLED=true', async () => {
    process.env.DEMO_LOGIN_ENABLED = 'true';
    const res = await request(buildApp()).get('/api/patient-portal/demo-login');
    expect(res.status).toBe(200);
    expect(ensureDemoPractice).toHaveBeenCalledTimes(1);
    expect(mockStorage.getPatients).toHaveBeenCalledWith(99);
  });
});
