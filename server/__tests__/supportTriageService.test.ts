/**
 * Triage agent — locks down the poller discipline and the approval gate:
 *   1. verdicts create DRAFT agent replies and mark the ticket triaged
 *   2. unparseable model output still marks triaged (no token-burning loop)
 *      and creates no draft
 *   3. a ticket with an existing agent reply is skipped but marked triaged
 *   4. escalate=true sends the escalation email; false does not
 *   5. kill switch and missing AI config short-circuit the run
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = {
    ticketRows: [] as any[],
    replyRows: [] as any[],
    updates: [] as any[],
    modelText: '',
    modelError: null as Error | null,
  };
  const messagesCreate = vi.fn(async () => {
    if (state.modelError) throw state.modelError;
    return { content: [{ type: 'text', text: state.modelText }] };
  });
  const db = {
    select: vi.fn((projection?: unknown) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          // First select in a run is the ticket scan (no projection object);
          // per-ticket existing-reply checks pass a projection.
          const rows = projection ? state.replyRows : state.ticketRows;
          return Object.assign(Promise.resolve(rows), {
            orderBy: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve(rows)) })),
            limit: vi.fn(() => Promise.resolve(rows)),
          });
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((s: any) => {
        state.updates.push(s);
        return { where: vi.fn(() => Promise.resolve()) };
      }),
    })),
  };
  return {
    state,
    db,
    messagesCreate,
    addTicketReply: vi.fn(async () => ({ id: 55, status: 'draft' })),
    searchHelp: vi.fn(() => ({ results: [{ section: 'S', question: 'Q', answer: 'A' }] })),
    getSystemStatus: vi.fn(async () => ({
      overall: 'healthy',
      release: 'abc',
      uptimeSeconds: 1,
      database: { status: 'healthy' },
      redis: { status: 'not_configured' },
      clearinghouseConfigured: true,
      catalogs: { icd10: true, cpt: true },
    })),
    sendEmail: vi.fn(async () => undefined),
    isAiConfigured: vi.fn(() => true),
  };
});

vi.mock('../db', () => ({ db: mocks.db }));
vi.mock('../services/aiProvider', () => ({
  isAiConfigured: mocks.isAiConfigured,
  createAiClient: vi.fn(() => ({ messages: { create: mocks.messagesCreate } })),
}));
vi.mock('../services/supportAssistService', () => ({
  searchHelp: mocks.searchHelp,
  getSystemStatus: mocks.getSystemStatus,
}));
vi.mock('../services/supportTicketService', () => ({ addTicketReply: mocks.addTicketReply }));
vi.mock('../email', () => ({ isEmailConfigured: () => true }));
vi.mock('../services/emailService', () => ({ sendEmail: mocks.sendEmail }));

import { triageOpenTickets } from '../services/supportTriageService';

const TICKET = {
  id: 42,
  practiceId: 1,
  userId: 'u1',
  userRole: 'therapist',
  severity: 'normal',
  description: 'The claims page shows a spinner forever.',
  page: '/claims',
  release: 'abc1234',
  source: 'app',
  status: 'open',
  notes: null,
  triageCategory: null,
  triagedAt: null,
};

const VERDICT = {
  category: 'bug',
  draftReply: 'Thanks for the report. We are looking at the claims page now.',
  internalNote: 'Likely a slow query; check Sentry.',
  escalate: false,
  escalationReason: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.ticketRows = [];
  mocks.state.replyRows = [];
  mocks.state.updates = [];
  mocks.state.modelText = JSON.stringify(VERDICT);
  mocks.state.modelError = null;
  process.env.SUPPORT_NOTIFY_EMAIL = 'daniel@example.com';
  delete process.env.SUPPORT_TRIAGE_DISABLED;
});

afterEach(() => {
  delete process.env.SUPPORT_NOTIFY_EMAIL;
});

describe('triageOpenTickets', () => {
  it('drafts an agent reply and marks the ticket triaged', async () => {
    mocks.state.ticketRows = [TICKET];
    const summary = await triageOpenTickets();
    expect(summary).toMatchObject({ scanned: 1, triaged: 1, drafted: 1, escalated: 0, failures: 0 });
    expect(mocks.addTicketReply).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 42, authorType: 'agent', asDraft: true })
    );
    const update = mocks.state.updates[0];
    expect(update.triageCategory).toBe('bug');
    expect(update.triagedAt).toBeInstanceOf(Date);
    expect(update.notes).toContain('[triage]');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('marks triaged with no draft when the model output is unparseable', async () => {
    mocks.state.ticketRows = [TICKET];
    mocks.state.modelText = 'I refuse to answer in JSON today.';
    const summary = await triageOpenTickets();
    expect(summary).toMatchObject({ triaged: 1, drafted: 0, failures: 1 });
    expect(mocks.addTicketReply).not.toHaveBeenCalled();
    expect(mocks.state.updates[0].triagedAt).toBeInstanceOf(Date);
  });

  it('skips tickets that already have an agent reply but still marks them triaged', async () => {
    mocks.state.ticketRows = [TICKET];
    mocks.state.replyRows = [{ id: 9 }];
    const summary = await triageOpenTickets();
    expect(summary).toMatchObject({ triaged: 1, drafted: 0 });
    expect(mocks.messagesCreate).not.toHaveBeenCalled();
    expect(mocks.addTicketReply).not.toHaveBeenCalled();
  });

  it('sends the escalation email when the verdict says escalate', async () => {
    mocks.state.ticketRows = [TICKET];
    mocks.state.modelText = JSON.stringify({
      ...VERDICT,
      escalate: true,
      escalationReason: 'Reporter cannot save clinical notes.',
    });
    const summary = await triageOpenTickets();
    expect(summary.escalated).toBe(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('[ESCALATION]') })
    );
  });

  it('a per-ticket model failure leaves the ticket untriaged for the next run', async () => {
    mocks.state.ticketRows = [TICKET];
    mocks.state.modelError = new Error('api down');
    const summary = await triageOpenTickets();
    expect(summary).toMatchObject({ triaged: 0, failures: 1 });
    expect(mocks.state.updates).toHaveLength(0);
  });

  it('honors the kill switch', async () => {
    process.env.SUPPORT_TRIAGE_DISABLED = '1';
    const summary = await triageOpenTickets();
    expect(summary.skipped).toBe('disabled');
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('short-circuits when AI is not configured', async () => {
    mocks.isAiConfigured.mockReturnValue(false);
    const summary = await triageOpenTickets();
    expect(summary.skipped).toBe('ai_not_configured');
  });
});
