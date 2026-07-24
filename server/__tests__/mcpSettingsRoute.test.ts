import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * PATCH /api/practices/:id/mcp-settings gates the MCP PHI kill-switch and the
 * mutation-confirmation flag. It must be admin-only and scoped to the caller's
 * OWN practice — the generic PATCH /:id is only isAuthenticated, so these
 * security-sensitive flags need their own guarded route. These tests lock in
 * that authorization behavior.
 */

// Mutable auth context the mocked isAuthenticated middleware applies per test.
const authCtx: { userRole: string; userPracticeId: number | null } = {
  userRole: 'admin',
  userPracticeId: 1,
};

const { storageStub } = vi.hoisted(() => ({
  storageStub: {
    updatePractice: vi.fn(async (id: number, updates: any) => ({
      id,
      mcpPhiEnabled: !!updates.mcpPhiEnabled,
      mcpRequiresConfirmation: !!updates.mcpRequiresConfirmation,
    })),
    getPractice: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'user-1' } };
    req.userRole = authCtx.userRole;
    req.userPracticeId = authCtx.userPracticeId;
    next();
  },
}));

import practicesRouter from '../routes/practices';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/practices', practicesRouter);
  return app;
}

beforeEach(() => {
  storageStub.updatePractice.mockClear();
  authCtx.userRole = 'admin';
  authCtx.userPracticeId = 1;
});

describe('PATCH /api/practices/:id/mcp-settings', () => {
  it('lets an admin flip PHI access on their own practice', async () => {
    const res = await request(makeApp())
      .patch('/api/practices/1/mcp-settings')
      .send({ mcpPhiEnabled: true });

    expect(res.status).toBe(200);
    expect(res.body.mcpPhiEnabled).toBe(true);
    expect(storageStub.updatePractice).toHaveBeenCalledWith(1, { mcpPhiEnabled: true });
  });

  it('rejects a non-admin', async () => {
    authCtx.userRole = 'therapist';
    const res = await request(makeApp())
      .patch('/api/practices/1/mcp-settings')
      .send({ mcpPhiEnabled: true });

    expect(res.status).toBe(403);
    expect(storageStub.updatePractice).not.toHaveBeenCalled();
  });

  it("rejects an admin acting on another practice", async () => {
    authCtx.userPracticeId = 2; // admin of practice 2 targeting practice 1
    const res = await request(makeApp())
      .patch('/api/practices/1/mcp-settings')
      .send({ mcpPhiEnabled: true });

    expect(res.status).toBe(403);
    expect(storageStub.updatePractice).not.toHaveBeenCalled();
  });

  it('ignores non-boolean / unknown fields and 400s when nothing valid is sent', async () => {
    const res = await request(makeApp())
      .patch('/api/practices/1/mcp-settings')
      .send({ mcpPhiEnabled: 'yes', isDemo: true, name: 'Hacked' });

    expect(res.status).toBe(400);
    expect(storageStub.updatePractice).not.toHaveBeenCalled();
  });

  it('updates the confirmation flag independently', async () => {
    const res = await request(makeApp())
      .patch('/api/practices/1/mcp-settings')
      .send({ mcpRequiresConfirmation: true });

    expect(res.status).toBe(200);
    expect(storageStub.updatePractice).toHaveBeenCalledWith(1, { mcpRequiresConfirmation: true });
  });
});

describe('PATCH /api/practices/:id — back-door hardening', () => {
  it('cannot flip mcpPhiEnabled / mcpRequiresConfirmation / isDemo via the generic route', async () => {
    // A non-admin sends the privileged flags through the unguarded endpoint.
    authCtx.userRole = 'therapist';
    const res = await request(makeApp())
      .patch('/api/practices/1')
      .send({ name: 'Legit Rename', mcpPhiEnabled: true, isDemo: true, mcpRequiresConfirmation: true });

    expect(res.status).toBe(200);
    // The legit field is written; the privileged flags are stripped.
    expect(storageStub.updatePractice).toHaveBeenCalledTimes(1);
    const [, passedUpdates] = storageStub.updatePractice.mock.calls[0];
    expect(passedUpdates).toEqual({ name: 'Legit Rename' });
    expect(passedUpdates).not.toHaveProperty('mcpPhiEnabled');
    expect(passedUpdates).not.toHaveProperty('mcpRequiresConfirmation');
    expect(passedUpdates).not.toHaveProperty('isDemo');
  });

  it('rejects editing another practice (cross-tenant) via the generic route', async () => {
    authCtx.userPracticeId = 5; // caller belongs to practice 5
    const res = await request(makeApp())
      .patch('/api/practices/1')
      .send({ name: 'Hostile Rename' });

    expect(res.status).toBe(403);
    expect(storageStub.updatePractice).not.toHaveBeenCalled();
  });
});
