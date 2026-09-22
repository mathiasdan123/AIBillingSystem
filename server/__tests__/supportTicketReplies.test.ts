/**
 * Reply thread on support tickets — the approval gate for the autonomous
 * support agent. Locks down:
 *   1. agent replies are born as drafts; user/staff replies are born published
 *   2. publish refuses non-drafts and cross-practice access (returns null)
 *   3. publish keeps the original body unless a real edit is provided
 *   4. discard only removes drafts
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => {
  const state = {
    insertedValues: null as any,
    insertReturning: [] as any[],
    selectRows: [] as any[],
    updateSet: null as any,
    deleted: false,
  };
  const db = {
    insert: vi.fn(() => ({
      values: vi.fn((v: any) => {
        state.insertedValues = v;
        return { returning: vi.fn(() => Promise.resolve(state.insertReturning)) };
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const rows = state.selectRows;
          // Thenable AND chainable: awaiting yields rows (publish/discard
          // lookups), .orderBy() yields rows (listTicketReplies).
          return Object.assign(Promise.resolve(rows), {
            orderBy: vi.fn(() => Promise.resolve(rows)),
          });
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((s: any) => {
        state.updateSet = s;
        return {
          where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([{ ...state.selectRows[0], ...s }])) })),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => {
        state.deleted = true;
        return Promise.resolve();
      }),
    })),
  };
  return { db, state };
});
vi.mock('../db', () => ({ db: mockDb.db }));
vi.mock('../email', () => ({ isEmailConfigured: () => false }));
vi.mock('../services/emailService', () => ({ sendEmail: vi.fn() }));

import {
  addTicketReply,
  publishTicketReply,
  discardDraftReply,
} from '../services/supportTicketService';

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.state.insertedValues = null;
  mockDb.state.selectRows = [];
  mockDb.state.updateSet = null;
  mockDb.state.deleted = false;
  mockDb.state.insertReturning = [{ id: 7, status: 'draft' }];
});

describe('addTicketReply', () => {
  it('agent replies are born as drafts with no publishedAt', async () => {
    await addTicketReply({ ticketId: 1, practiceId: 1, authorType: 'agent', body: 'Try a hard refresh.' });
    expect(mockDb.state.insertedValues.status).toBe('draft');
    expect(mockDb.state.insertedValues.publishedAt).toBeNull();
  });

  it('staff and user replies are born published', async () => {
    for (const authorType of ['staff', 'user'] as const) {
      await addTicketReply({ ticketId: 1, practiceId: 1, authorType, authorUserId: 'u1', body: 'On it.' });
      expect(mockDb.state.insertedValues.status).toBe('published');
      expect(mockDb.state.insertedValues.publishedAt).toBeInstanceOf(Date);
    }
  });

  it('rejects empty bodies without touching the db', async () => {
    await expect(
      addTicketReply({ ticketId: 1, practiceId: 1, authorType: 'staff', body: ' ' })
    ).rejects.toThrow(/Reply text/);
    expect(mockDb.db.insert).not.toHaveBeenCalled();
  });
});

describe('publishTicketReply', () => {
  const draft = { id: 7, ticketId: 1, practiceId: 1, status: 'draft', body: 'Original draft text.' };

  it('publishes a draft in the admin practice', async () => {
    mockDb.state.selectRows = [draft];
    const out = await publishTicketReply({ replyId: 7, practiceId: 1 });
    expect(out).not.toBeNull();
    expect(mockDb.state.updateSet.status).toBe('published');
    expect(mockDb.state.updateSet.body).toBe('Original draft text.'); // no edit given
  });

  it('applies an edited body when provided', async () => {
    mockDb.state.selectRows = [draft];
    await publishTicketReply({ replyId: 7, practiceId: 1, editedBody: 'Cleaned-up answer.' });
    expect(mockDb.state.updateSet.body).toBe('Cleaned-up answer.');
  });

  it('refuses cross-practice publish (null, no update)', async () => {
    mockDb.state.selectRows = [{ ...draft, practiceId: 2 }];
    const out = await publishTicketReply({ replyId: 7, practiceId: 1 });
    expect(out).toBeNull();
    expect(mockDb.db.update).not.toHaveBeenCalled();
  });

  it('refuses to re-publish an already-published reply', async () => {
    mockDb.state.selectRows = [{ ...draft, status: 'published' }];
    const out = await publishTicketReply({ replyId: 7, practiceId: 1 });
    expect(out).toBeNull();
    expect(mockDb.db.update).not.toHaveBeenCalled();
  });

  it('platform admin (practiceId null) can publish any practice', async () => {
    mockDb.state.selectRows = [{ ...draft, practiceId: 99 }];
    const out = await publishTicketReply({ replyId: 7, practiceId: null });
    expect(out).not.toBeNull();
  });
});

describe('discardDraftReply', () => {
  it('deletes a draft in scope', async () => {
    mockDb.state.selectRows = [{ id: 7, ticketId: 1, practiceId: 1, status: 'draft' }];
    expect(await discardDraftReply({ replyId: 7, practiceId: 1 })).toBe(true);
    expect(mockDb.state.deleted).toBe(true);
  });

  it('refuses to delete a published reply', async () => {
    mockDb.state.selectRows = [{ id: 7, ticketId: 1, practiceId: 1, status: 'published' }];
    expect(await discardDraftReply({ replyId: 7, practiceId: 1 })).toBe(false);
    expect(mockDb.state.deleted).toBe(false);
  });
});
