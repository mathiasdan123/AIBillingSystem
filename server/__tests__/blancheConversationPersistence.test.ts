import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * Server-side Blanche chat persistence: GET/DELETE /api/ai/conversation.
 *
 * Verifies the routes scope by (userId, practiceId), return [] when there is
 * no saved row, and that delete is idempotent.
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
    getBlancheConversation: vi.fn(),
    clearBlancheConversation: vi.fn(),
    saveBlancheConversation: vi.fn(),
    getPractice: vi.fn(),
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

import aiAssistantRouter from '../routes/ai-assistant';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiAssistantRouter);
  return app;
}

beforeEach(() => {
  storageStub.getBlancheConversation.mockReset();
  storageStub.clearBlancheConversation.mockReset();
  storageStub.saveBlancheConversation.mockReset();
  contextHolder.current = { userId: 'user-a', practiceId: 7, role: 'admin' };
});

describe('GET /api/ai/conversation', () => {
  it('returns the saved messages for the signed-in user', async () => {
    storageStub.getBlancheConversation.mockResolvedValue([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);

    const res = await request(makeApp()).get('/api/ai/conversation').expect(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0]).toEqual({ role: 'user', content: 'hi' });
    expect(storageStub.getBlancheConversation).toHaveBeenCalledWith('user-a', 7);
  });

  it('returns [] when there is no saved conversation', async () => {
    storageStub.getBlancheConversation.mockResolvedValue([]);
    const res = await request(makeApp()).get('/api/ai/conversation').expect(200);
    expect(res.body.messages).toEqual([]);
  });

  it('returns [] (not 500) when there is no practice context', async () => {
    contextHolder.current = null;
    const res = await request(makeApp()).get('/api/ai/conversation').expect(200);
    expect(res.body.messages).toEqual([]);
    expect(storageStub.getBlancheConversation).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/ai/conversation', () => {
  it('clears the saved conversation for the signed-in user', async () => {
    storageStub.clearBlancheConversation.mockResolvedValue(undefined);
    const res = await request(makeApp()).delete('/api/ai/conversation').expect(200);
    expect(res.body.ok).toBe(true);
    expect(storageStub.clearBlancheConversation).toHaveBeenCalledWith('user-a', 7);
  });

  it('is a no-op when there is no practice context (still 200)', async () => {
    contextHolder.current = null;
    const res = await request(makeApp()).delete('/api/ai/conversation').expect(200);
    expect(res.body.ok).toBe(true);
    expect(storageStub.clearBlancheConversation).not.toHaveBeenCalled();
  });
});
