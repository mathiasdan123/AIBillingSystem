/**
 * Blanche support tools backend (search_help / get_my_support_tickets /
 * get_system_status). Locks down:
 *   1. FAQ search: substring hit, multi-word fallback, empty-query TOC
 *   2. Ticket visibility: non-admins without a userId get nothing (no query),
 *      long descriptions are truncated, admin scope is practice-wide
 *   3. System status: a dead DB yields degraded, healthy probes yield healthy
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage, mockRedis, mockDbRows } = vi.hoisted(() => ({
  mockStorage: {
    getAllPracticeIds: vi.fn(),
    getIcd10Codes: vi.fn(),
    getCptCodes: vi.fn(),
  },
  mockRedis: {
    getRedisClient: vi.fn(() => null),
    isRedisReady: vi.fn(() => false),
  },
  // Each select consumes the next entry: [ticket rows, reply rows, ...].
  mockDbRows: { queue: [] as any[][], lastWhere: undefined as unknown },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/redisClient', () => mockRedis);
vi.mock('../services/stediService', () => ({ isStediConfigured: vi.fn(() => true) }));
vi.mock('../db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((cond: unknown) => {
          mockDbRows.lastWhere = cond;
          const rows = mockDbRows.queue.shift() ?? [];
          // Chain must satisfy both shapes: .orderBy().limit() (tickets) and
          // awaited .orderBy() (replies).
          return {
            orderBy: vi.fn(() =>
              Object.assign(Promise.resolve(rows), {
                limit: vi.fn(() => Promise.resolve(rows)),
              })
            ),
          };
        }),
      })),
    })),
  },
}));

import { searchHelp, listUserTickets, getSystemStatus } from '../services/supportAssistService';

beforeEach(() => {
  vi.clearAllMocks();
  mockDbRows.queue = [];
  mockDbRows.lastWhere = undefined;
  mockRedis.getRedisClient.mockReturnValue(null);
  mockStorage.getAllPracticeIds.mockResolvedValue([1]);
  mockStorage.getIcd10Codes.mockResolvedValue([{ id: 1 }]);
  mockStorage.getCptCodes.mockResolvedValue([{ id: 1 }]);
});

describe('searchHelp', () => {
  it('returns the table of contents for an empty query', () => {
    const res = searchHelp('');
    expect(res.results).toBeUndefined();
    expect(res.sections!.length).toBeGreaterThan(5);
    expect(res.sections![0]).toHaveProperty('title');
    expect(res.sections![0]).toHaveProperty('items');
  });

  it('finds the MFA reset answer by substring', () => {
    const res = searchHelp('MFA');
    expect(res.results!.some((r) => r.question.includes('lost my MFA device'))).toBe(true);
  });

  it('falls back to per-word matching for multi-word queries', () => {
    // No FAQ string contains this exact substring, but the words hit the
    // MFA-reset item.
    const res = searchHelp('reset my mfa device');
    expect(res.results!.length).toBeGreaterThan(0);
    expect(res.results![0].question.includes('MFA') || res.results![0].answer.includes('MFA')).toBe(
      true
    );
  });

  it('returns empty results (not the TOC) for gibberish', () => {
    const res = searchHelp('zzqxv');
    expect(res.results).toEqual([]);
    expect(res.sections).toBeUndefined();
  });
});

describe('listUserTickets', () => {
  const base = {
    id: 7,
    severity: 'normal',
    status: 'open',
    source: 'blanche',
    page: '/claims',
    notes: null,
    createdAt: new Date(),
    resolvedAt: null,
  };

  it('returns [] without querying when a non-admin has no userId', async () => {
    const res = await listUserTickets({ userId: null, practiceId: 1, isAdmin: false });
    expect(res).toEqual([]);
    expect(mockDbRows.lastWhere).toBeUndefined(); // db.select never reached
  });

  it('admin without a userId still queries (practice-wide scope)', async () => {
    mockDbRows.queue = [[{ ...base, description: 'short' }], []];
    const res = await listUserTickets({ userId: null, practiceId: 1, isAdmin: true });
    expect(res).toHaveLength(1);
    expect(mockDbRows.lastWhere).toBeDefined();
  });

  it('truncates long descriptions to 300 chars', async () => {
    mockDbRows.queue = [[{ ...base, description: 'x'.repeat(500) }], []];
    const res = await listUserTickets({ userId: 'u1', practiceId: 1, isAdmin: false });
    expect(res[0].description.length).toBeLessThanOrEqual(301); // 300 + ellipsis
    expect(res[0].description.endsWith('…')).toBe(true);
  });

  it('attaches published replies labeled by author side', async () => {
    mockDbRows.queue = [
      [{ ...base, description: 'short' }],
      [
        { ticketId: 7, authorType: 'agent', body: 'We are on it.', status: 'published', createdAt: new Date(), publishedAt: new Date() },
        { ticketId: 7, authorType: 'user', body: 'Thanks!', status: 'published', createdAt: new Date(), publishedAt: null },
      ],
    ];
    const res = await listUserTickets({ userId: 'u1', practiceId: 1, isAdmin: false });
    expect(res[0].replies).toHaveLength(2);
    expect(res[0].replies[0].from).toBe('support');
    expect(res[0].replies[1].from).toBe('you');
  });
});

describe('getSystemStatus', () => {
  it('reports healthy when every probe passes', async () => {
    const status = await getSystemStatus();
    expect(status.overall).toBe('healthy');
    expect(status.database.status).toBe('healthy');
    expect(status.redis.status).toBe('not_configured');
    expect(status.clearinghouseConfigured).toBe(true);
    expect(status.catalogs).toEqual({ icd10: true, cpt: true });
  });

  it('reports degraded when the database probe fails', async () => {
    mockStorage.getAllPracticeIds.mockRejectedValue(new Error('conn refused'));
    const status = await getSystemStatus();
    expect(status.overall).toBe('degraded');
    expect(status.database.status).toBe('unhealthy');
  });

  it('reports degraded when a catalog is empty', async () => {
    mockStorage.getIcd10Codes.mockResolvedValue([]);
    const status = await getSystemStatus();
    expect(status.overall).toBe('degraded');
    expect(status.catalogs.icd10).toBe(false);
  });
});
