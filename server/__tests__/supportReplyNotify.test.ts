/**
 * Reporter notification for support-ticket replies. Locks down:
 *   1. a staff reply emails the ticket's reporter
 *   2. the reporter's own ('user') replies never notify
 *   3. agent drafts never notify on creation — only when an admin publishes
 *   4. publishTicketReply emails the reporter with the published body
 *   5. email failure never fails the operation (SES sandbox reality)
 *   6. silently skips: no userId on ticket, user without email, kill switch
 *   7. HIPAA: the email never contains the ticket description
 *   8. reporter-facing copy contains no hyphens or dashes
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockDb = vi.hoisted(() => {
  const state = {
    insertedValues: null as any,
    insertReturning: [] as any[],
    // Each db.select() consumes the next entry; falls back to [] when empty.
    selectQueue: [] as any[][],
    updateSet: null as any,
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
          const rows = state.selectQueue.length ? state.selectQueue.shift()! : [];
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
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([{ id: 7, ticketId: 1, status: 'published', ...s }])),
          })),
        };
      }),
    })),
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
  };
  return { db, state };
});
const mockEmail = vi.hoisted(() => ({
  isEmailConfigured: vi.fn(() => true),
  sendEmail: vi.fn(() => Promise.resolve({ success: true })),
  getUser: vi.fn(),
}));

vi.mock('../db', () => ({ db: mockDb.db }));
vi.mock('../email', () => ({ isEmailConfigured: mockEmail.isEmailConfigured }));
vi.mock('../services/emailService', () => ({ sendEmail: mockEmail.sendEmail }));
vi.mock('../storage', () => ({ storage: { getUser: mockEmail.getUser } }));

import { addTicketReply, publishTicketReply } from '../services/supportTicketService';

const TICKET = {
  id: 1,
  practiceId: 1,
  userId: 'u1',
  description: 'PHI SENSITIVE original description typed by the reporter',
};
const REPORTER = { id: 'u1', email: 'reporter@example.com' };
const DRAFT = { id: 7, ticketId: 1, practiceId: 1, status: 'draft', body: 'Try a hard refresh.' };

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.state.insertedValues = null;
  mockDb.state.selectQueue = [];
  mockDb.state.updateSet = null;
  mockDb.state.insertReturning = [{ id: 9, ticketId: 1, status: 'published', body: 'We fixed it.' }];
  mockEmail.isEmailConfigured.mockReturnValue(true);
  mockEmail.sendEmail.mockResolvedValue({ success: true } as any);
  mockEmail.getUser.mockResolvedValue(REPORTER);
  delete process.env.SUPPORT_REPLY_NOTIFY_DISABLED;
});

afterEach(() => {
  delete process.env.SUPPORT_REPLY_NOTIFY_DISABLED;
});

describe('staff reply notification', () => {
  it('emails the reporter when a staff reply is created', async () => {
    mockDb.state.selectQueue = [[TICKET]]; // notify: ticket lookup
    await addTicketReply({ ticketId: 1, practiceId: 1, authorType: 'staff', authorUserId: 'admin', body: 'We fixed it.' });
    expect(mockEmail.getUser).toHaveBeenCalledWith('u1');
    expect(mockEmail.sendEmail).toHaveBeenCalledTimes(1);
    const args = mockEmail.sendEmail.mock.calls[0]![0] as any;
    expect(args.to).toBe('reporter@example.com');
    expect(args.subject).toContain('#1');
    expect(args.html).toContain('We fixed it.');
  });

  it('never includes the ticket description (may contain PHI)', async () => {
    mockDb.state.selectQueue = [[TICKET]];
    await addTicketReply({ ticketId: 1, practiceId: 1, authorType: 'staff', body: 'We fixed it.' });
    const args = mockEmail.sendEmail.mock.calls[0]![0] as any;
    expect(args.subject).not.toContain('PHI SENSITIVE');
    expect(args.html).not.toContain('PHI SENSITIVE');
    expect(args.text).not.toContain('PHI SENSITIVE');
  });

  it('reporter facing copy contains no hyphens or dashes', async () => {
    mockDb.state.selectQueue = [[TICKET]];
    await addTicketReply({ ticketId: 1, practiceId: 1, authorType: 'staff', body: 'All set now.' });
    const args = mockEmail.sendEmail.mock.calls[0]![0] as any;
    // Body text is hyphen free here, so any hyphen/dash would be ours.
    expect(args.subject).not.toMatch(/[-‐-―]/);
    expect(args.text).not.toMatch(/[-‐-―]/);
    expect(args.html).not.toMatch(/[-‐-―]/);
  });

  it("a 'user' reply does not notify (it is the reporter's own message)", async () => {
    await addTicketReply({ ticketId: 1, practiceId: 1, authorType: 'user', authorUserId: 'u1', body: 'Still broken.' });
    expect(mockEmail.sendEmail).not.toHaveBeenCalled();
    expect(mockDb.db.select).not.toHaveBeenCalled();
  });

  it('an agent draft does not notify', async () => {
    mockDb.state.insertReturning = [{ id: 9, ticketId: 1, status: 'draft', body: 'Draft answer.' }];
    await addTicketReply({ ticketId: 1, practiceId: 1, authorType: 'agent', body: 'Draft answer.' });
    expect(mockEmail.sendEmail).not.toHaveBeenCalled();
  });
});

describe('publish notification', () => {
  it('emails the reporter when an admin publishes an agent draft', async () => {
    mockDb.state.selectQueue = [
      [DRAFT], // publish: reply lookup
      [TICKET], // notify: ticket lookup
    ];
    const out = await publishTicketReply({ replyId: 7, practiceId: 1 });
    expect(out).not.toBeNull();
    expect(mockEmail.sendEmail).toHaveBeenCalledTimes(1);
    const args = mockEmail.sendEmail.mock.calls[0]![0] as any;
    expect(args.to).toBe('reporter@example.com');
    expect(args.html).toContain('Try a hard refresh.');
  });

  it('does not notify when publish refuses (non-draft)', async () => {
    mockDb.state.selectQueue = [[{ ...DRAFT, status: 'published' }]];
    const out = await publishTicketReply({ replyId: 7, practiceId: 1 });
    expect(out).toBeNull();
    expect(mockEmail.sendEmail).not.toHaveBeenCalled();
  });
});

describe('non-blocking and skip behavior', () => {
  it('email failure never fails the reply operation', async () => {
    mockDb.state.selectQueue = [[TICKET]];
    mockEmail.sendEmail.mockRejectedValue(new Error('SES sandbox: address not verified'));
    const reply = await addTicketReply({ ticketId: 1, practiceId: 1, authorType: 'staff', body: 'We fixed it.' });
    expect(reply.id).toBe(9);
  });

  it('reporter lookup failure never fails the reply operation', async () => {
    mockDb.state.selectQueue = [[TICKET]];
    mockEmail.getUser.mockRejectedValue(new Error('db down'));
    const reply = await addTicketReply({ ticketId: 1, practiceId: 1, authorType: 'staff', body: 'We fixed it.' });
    expect(reply.id).toBe(9);
  });

  it('skips silently when the ticket has no userId', async () => {
    mockDb.state.selectQueue = [[{ ...TICKET, userId: null }]];
    await addTicketReply({ ticketId: 1, practiceId: 1, authorType: 'staff', body: 'We fixed it.' });
    expect(mockEmail.getUser).not.toHaveBeenCalled();
    expect(mockEmail.sendEmail).not.toHaveBeenCalled();
  });

  it('skips silently when the reporter has no email', async () => {
    mockDb.state.selectQueue = [[TICKET]];
    mockEmail.getUser.mockResolvedValue({ id: 'u1', email: null });
    await addTicketReply({ ticketId: 1, practiceId: 1, authorType: 'staff', body: 'We fixed it.' });
    expect(mockEmail.sendEmail).not.toHaveBeenCalled();
  });

  it('skips when email transport is not configured', async () => {
    mockDb.state.selectQueue = [[TICKET]];
    mockEmail.isEmailConfigured.mockReturnValue(false);
    await addTicketReply({ ticketId: 1, practiceId: 1, authorType: 'staff', body: 'We fixed it.' });
    expect(mockEmail.sendEmail).not.toHaveBeenCalled();
  });

  it('kill switch SUPPORT_REPLY_NOTIFY_DISABLED=1 skips entirely', async () => {
    process.env.SUPPORT_REPLY_NOTIFY_DISABLED = '1';
    mockDb.state.selectQueue = [[TICKET]];
    await addTicketReply({ ticketId: 1, practiceId: 1, authorType: 'staff', body: 'We fixed it.' });
    expect(mockDb.db.select).not.toHaveBeenCalled();
    expect(mockEmail.sendEmail).not.toHaveBeenCalled();
  });
});
