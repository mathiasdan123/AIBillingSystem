/**
 * The HIPAA PHI-access audit trail must actually record access.
 *
 * It did not. auditMiddleware is mounted with `app.use('/api', ...)`, and
 * Express strips the mount prefix from req.path — so for a request to
 * /api/patients, req.path inside the middleware was '/patients'. The guard
 * `if (!path.startsWith('/api')) return next()` therefore fired on EVERY
 * request and the middleware returned before writing anything. No PHI access,
 * staff or patient, was ever logged, and the tamper-evident integrity hash
 * chain was protecting an empty table (164.312(b)).
 *
 * These tests mount the middleware the way production does — at '/api', not
 * at the root — because mounting it at the root in a test would pass while
 * production stayed silent. That is precisely how this survived.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { createAuditLog } = vi.hoisted(() => ({ createAuditLog: vi.fn(async () => ({ id: 1 })) }));

vi.mock('../storage/audit', () => ({ createAuditLog }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { auditMiddleware } from '../middleware/auditMiddleware';

/** Mounted exactly as production does it (server/routes.ts). */
function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', auditMiddleware);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/patients', (_req, res) => res.json([]));
  app.get('/api/patients/42', (_req, res) => res.json({ id: 42 }));
  app.get('/api/claims/7', (_req, res) => res.json({ id: 7 }));
  app.get('/api/patient-portal/dashboard', (_req, res) => res.json({ ok: true }));
  app.post('/api/public/telehealth/join/ABC123', (_req, res) => res.json({ ok: true }));
  app.get('/api/analytics/revenue', (_req, res) => res.json({}));
  return app;
}

const lastCall = () => createAuditLog.mock.calls.at(-1)?.[0] as any;

beforeEach(() => vi.clearAllMocks());

describe('auditMiddleware writes a record when mounted at /api', () => {
  it('records a staff PHI read — the case that silently wrote nothing', async () => {
    await request(makeApp()).get('/api/patients').expect(200);

    expect(createAuditLog).toHaveBeenCalledTimes(1);
    const entry = lastCall();
    expect(entry.eventCategory).toBe('phi_access');
    expect(entry.resourceType).toBe('patient');
    expect(entry.eventType).toBe('view');
  });

  it('classifies rather than falling back to system/null', async () => {
    await request(makeApp()).get('/api/claims/7').expect(200);

    const entry = lastCall();
    // Fixing the guard WITHOUT rebuilding the path yields these two values,
    // which look like coverage but record nothing useful.
    expect(entry.resourceType).not.toBe('system');
    expect(entry.eventCategory).not.toBe('system');
    expect(entry.resourceType).toBe('claim');
    expect(entry.resourceId).toBe('7');
  });

  it('captures the resource id from the full path', async () => {
    await request(makeApp()).get('/api/patients/42').expect(200);
    expect(lastCall().resourceId).toBe('42');
  });

  it('records the full path, not the mount-stripped one', async () => {
    await request(makeApp()).get('/api/patients/42').expect(200);
    expect(lastCall().details.path).toBe('/api/patients/42');
  });

  it('still skips the health check', async () => {
    await request(makeApp()).get('/api/health').expect(200);
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

describe('patient-portal access is recorded as PHI access', () => {
  it('logs a portal chart read', async () => {
    await request(makeApp()).get('/api/patient-portal/dashboard').expect(200);

    const entry = lastCall();
    expect(entry.eventCategory).toBe('phi_access');
    expect(entry.resourceType).toBe('patient_portal');
  });

  it('logs an unauthenticated telehealth join', async () => {
    await request(makeApp()).post('/api/public/telehealth/join/ABC123').expect(200);

    const entry = lastCall();
    expect(entry.eventCategory).toBe('phi_access');
    expect(entry.resourceType).toBe('telehealth_join');
  });
});

describe('the audit record never becomes a credential store', () => {
  it('does not write the portal token from the query string', async () => {
    await request(makeApp())
      .get('/api/patient-portal/dashboard?token=live-portal-secret-abc123')
      .expect(200);

    const serialized = JSON.stringify(lastCall());
    // Query KEYS are useful context; the values are not, and one of them is a
    // live 90-day PHI credential.
    expect(serialized).not.toContain('live-portal-secret-abc123');
    expect(lastCall().details.queryParams).toEqual(['token']);
  });
});

describe('failures are recorded too', () => {
  it('marks a 403 as unsuccessful rather than dropping it', async () => {
    const app = express();
    app.use('/api', auditMiddleware);
    app.get('/api/patients', (_req, res) => res.status(403).json({ message: 'denied' }));

    await request(app).get('/api/patients').expect(403);

    const entry = lastCall();
    expect(entry.success).toBe(false);
    // A denied PHI read is exactly what a breach investigation looks for.
    expect(entry.eventCategory).toBe('phi_access');
  });
});
