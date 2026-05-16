import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * Phase 4 backend: proposal store + confirm-tool endpoint.
 *
 * Verifies:
 *   - summarizeProposal produces user-readable text per tool
 *   - POST /api/ai/confirm-tool: confirm runs executeTool, cancel doesn't,
 *     mismatched practice/user returns 404, unknown id returns 404, missing
 *     fields return 400, double-confirm returns 404 (one-shot)
 */

const { contextHolder, storageStub } = vi.hoisted(() => ({
  contextHolder: {
    current: { userId: 'user-a', practiceId: 7, role: 'admin' } as {
      userId: string;
      practiceId: number;
      role: string;
    } | null,
  },
  storageStub: {
    getPractice: vi.fn(),
    createPatient: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/practiceContext', () => ({
  getUserPracticeContext: vi.fn(async () => contextHolder.current),
}));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/aiLearningService', () => ({}));

import aiAssistantRouter, {
  __proposalStoreTest,
  summarizeProposal,
} from '../routes/ai-assistant';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiAssistantRouter);
  return app;
}

beforeEach(() => {
  __proposalStoreTest.clear();
  storageStub.getPractice.mockReset();
  storageStub.createPatient.mockReset();
  storageStub.createPatient.mockResolvedValue({
    id: 555,
    firstName: 'Jane',
    lastName: 'Doe',
  });
  contextHolder.current = { userId: 'user-a', practiceId: 7, role: 'admin' };
});

describe('summarizeProposal', () => {
  it('renders patient creation with a name', () => {
    expect(summarizeProposal('create_patient', { firstName: 'Jane', lastName: 'Doe' }))
      .toBe('Create patient Jane Doe');
  });

  it('falls back gracefully when no name is in args', () => {
    expect(summarizeProposal('create_patient', {})).toBe('Create a new patient');
  });

  it('describes a portal invite with email', () => {
    expect(summarizeProposal('send_patient_portal_invite', {
      patientName: 'Jane Doe',
      email: 'jane@example.com',
    })).toBe('Send portal invite to Jane Doe (jane@example.com)');
  });

  it('describes a claim submission with id', () => {
    expect(summarizeProposal('submit_claim', { claimId: 42 }))
      .toBe('Submit claim #42 to the clearinghouse');
  });

  it('falls back to a generic phrase for unknown tools', () => {
    expect(summarizeProposal('weird_unknown_tool', {})).toBe('Run weird_unknown_tool');
  });
});

describe('POST /api/ai/confirm-tool', () => {
  it('confirm executes the staged tool and returns the result', async () => {
    const proposal = __proposalStoreTest.seed({
      userId: 'user-a',
      practiceId: 7,
      toolName: 'create_patient',
      args: { firstName: 'Jane', lastName: 'Doe' },
    });

    const res = await request(makeApp())
      .post('/api/ai/confirm-tool')
      .send({ proposalId: proposal.id, action: 'confirm' })
      .expect(200);

    expect(res.body.status).toBe('confirmed');
    expect(res.body.toolName).toBe('create_patient');
    expect(storageStub.createPatient).toHaveBeenCalledTimes(1);
    expect(storageStub.createPatient).toHaveBeenCalledWith(
      expect.objectContaining({
        practiceId: 7,
        firstName: 'Jane',
        lastName: 'Doe',
      }),
    );
  });

  it('cancel records cancellation and does NOT execute the tool', async () => {
    const proposal = __proposalStoreTest.seed({
      userId: 'user-a',
      practiceId: 7,
      toolName: 'create_patient',
      args: { firstName: 'X', lastName: 'Y' },
    });

    const res = await request(makeApp())
      .post('/api/ai/confirm-tool')
      .send({ proposalId: proposal.id, action: 'cancel' })
      .expect(200);

    expect(res.body.status).toBe('cancelled');
    expect(storageStub.createPatient).not.toHaveBeenCalled();
  });

  it('refuses a proposal owned by a different practice (404)', async () => {
    const proposal = __proposalStoreTest.seed({
      userId: 'user-a',
      practiceId: 99,  // <-- different from the caller's practice 7
      toolName: 'create_patient',
      args: { firstName: 'X', lastName: 'Y' },
    });

    await request(makeApp())
      .post('/api/ai/confirm-tool')
      .send({ proposalId: proposal.id, action: 'confirm' })
      .expect(404);

    expect(storageStub.createPatient).not.toHaveBeenCalled();
  });

  it('refuses a proposal owned by a different user even in the same practice', async () => {
    const proposal = __proposalStoreTest.seed({
      userId: 'user-different',
      practiceId: 7,
      toolName: 'create_patient',
      args: {},
    });

    await request(makeApp())
      .post('/api/ai/confirm-tool')
      .send({ proposalId: proposal.id, action: 'confirm' })
      .expect(404);

    expect(storageStub.createPatient).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown proposalId', async () => {
    await request(makeApp())
      .post('/api/ai/confirm-tool')
      .send({ proposalId: 'does-not-exist', action: 'confirm' })
      .expect(404);
  });

  it('proposals are one-shot: a second confirm returns 404', async () => {
    const proposal = __proposalStoreTest.seed({
      userId: 'user-a',
      practiceId: 7,
      toolName: 'create_patient',
      args: { firstName: 'Jane', lastName: 'Doe' },
    });

    await request(makeApp())
      .post('/api/ai/confirm-tool')
      .send({ proposalId: proposal.id, action: 'confirm' })
      .expect(200);

    await request(makeApp())
      .post('/api/ai/confirm-tool')
      .send({ proposalId: proposal.id, action: 'confirm' })
      .expect(404);

    expect(storageStub.createPatient).toHaveBeenCalledTimes(1);
  });

  it('rejects missing proposalId with 400', async () => {
    await request(makeApp())
      .post('/api/ai/confirm-tool')
      .send({ action: 'confirm' })
      .expect(400);
  });

  it('rejects unsupported action with 400', async () => {
    await request(makeApp())
      .post('/api/ai/confirm-tool')
      .send({ proposalId: 'x', action: 'maybe' })
      .expect(400);
  });
});
