import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────

let selectCallIndex = 0;
let selectResults: any[][] = [];

function resetSelectResults(results: any[][]) {
  selectCallIndex = 0;
  selectResults = results;
}

const mockSelectFn = vi.fn();

vi.mock('../db', () => {
  return {
    db: {
      get select() {
        return mockSelectFn;
      },
    },
  };
});

vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Import after mocks are set up
import {
  getAuditLogs,
  getAuditSummary,
  getUserActivityReport,
  getPhiAccessReport,
  exportAuditLog,
  getSecurityEvents,
} from '../services/auditReportService';

// ── Chain builder helper ────────────────────────────────────────────────

function buildChain(result: any) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.groupBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.offset = vi.fn().mockReturnValue(chain);
  // Make thenable
  chain.then = (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject);
  chain.catch = (fn: any) => Promise.resolve(result).catch(fn);
  return chain;
}

// ── Test Data ───────────────────────────────────────────────────────────

const sampleLogs = [
  {
    id: 1,
    eventCategory: 'phi_access',
    eventType: 'view',
    resourceType: 'patient',
    resourceId: '42',
    userId: 'user-1',
    practiceId: 1,
    ipAddress: '10.0.0.1',
    userAgent: 'Mozilla/5.0',
    details: { method: 'GET', path: '/api/patients/42' },
    success: true,
    integrityHash: null,
    createdAt: new Date('2026-03-10T10:00:00Z'),
  },
  {
    id: 2,
    eventCategory: 'auth',
    eventType: 'login',
    resourceType: 'auth',
    resourceId: null,
    userId: 'user-2',
    practiceId: 1,
    ipAddress: '10.0.0.2',
    userAgent: 'Mozilla/5.0',
    details: { method: 'POST', path: '/api/login' },
    success: false,
    integrityHash: null,
    createdAt: new Date('2026-03-10T11:00:00Z'),
  },
  {
    id: 3,
    eventCategory: 'phi_access',
    eventType: 'create',
    resourceType: 'soap_note',
    resourceId: '7',
    userId: 'user-1',
    practiceId: 1,
    ipAddress: '10.0.0.1',
    userAgent: 'Mozilla/5.0',
    details: { method: 'POST', path: '/api/soap-notes' },
    success: true,
    integrityHash: null,
    createdAt: new Date('2026-03-11T09:00:00Z'),
  },
];

// ── Tests ───────────────────────────────────────────────────────────────

describe('Audit Report Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallIndex = 0;
    selectResults = [];

    // Configure the mock select function to return chained results
    mockSelectFn.mockImplementation((_selectArg?: any) => {
      const idx = selectCallIndex++;
      const result = selectResults[idx] ?? [];
      return buildChain(result);
    });
  });

  // 1. getAuditLogs returns paginated data
  it('getAuditLogs returns paginated results', async () => {
    resetSelectResults([sampleLogs, [{ count: 3 }]]);

    const result = await getAuditLogs(1);

    expect(result.data).toEqual(sampleLogs);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.pageSize).toBe(50);
    expect(result.pagination.total).toBe(3);
    expect(result.pagination.totalPages).toBe(1);
  });

  // 2. getAuditLogs with filters
  it('getAuditLogs applies userId filter', async () => {
    resetSelectResults([[sampleLogs[0]], [{ count: 1 }]]);

    const result = await getAuditLogs(1, { userId: 'user-1' });

    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
    expect(mockSelectFn).toHaveBeenCalledTimes(2);
  });

  // 3. getAuditLogs with pagination params
  it('getAuditLogs respects page and pageSize', async () => {
    resetSelectResults([[sampleLogs[2]], [{ count: 3 }]]);

    const result = await getAuditLogs(1, { page: 2, pageSize: 2 });

    expect(result.pagination.page).toBe(2);
    expect(result.pagination.pageSize).toBe(2);
    expect(result.pagination.totalPages).toBe(2);
  });

  // 4. getAuditLogs with date range filter
  it('getAuditLogs supports date range filtering', async () => {
    resetSelectResults([[sampleLogs[0]], [{ count: 1 }]]);

    const result = await getAuditLogs(1, {
      dateFrom: '2026-03-10T00:00:00Z',
      dateTo: '2026-03-10T23:59:59Z',
    });

    expect(result.data).toHaveLength(1);
    expect(mockSelectFn).toHaveBeenCalledTimes(2);
  });

  // 5. getAuditLogs with ipAddress filter
  it('getAuditLogs filters by IP address', async () => {
    resetSelectResults([[sampleLogs[0], sampleLogs[2]], [{ count: 2 }]]);

    const result = await getAuditLogs(1, { ipAddress: '10.0.0.1' });

    expect(result.data).toHaveLength(2);
  });

  // 6. getAuditSummary returns aggregated counts
  it('getAuditSummary returns aggregated data', async () => {
    resetSelectResults([
      [{ action: 'view', count: 5 }, { action: 'create', count: 3 }],
      [{ userId: 'user-1', count: 6 }, { userId: 'user-2', count: 2 }],
      [{ resourceType: 'patient', count: 4 }, { resourceType: 'soap_note', count: 4 }],
      [{ count: 8 }],
    ]);

    const result = await getAuditSummary(1, '2026-03-01', '2026-03-31');

    expect(result.byAction).toHaveLength(2);
    expect(result.byUser).toHaveLength(2);
    expect(result.byResourceType).toHaveLength(2);
    expect(result.totalEvents).toBe(8);
  });

  // 7. getAuditSummary handles null userId
  it('getAuditSummary maps null userId to unknown', async () => {
    resetSelectResults([
      [{ action: 'view', count: 1 }],
      [{ userId: null, count: 1 }],
      [{ resourceType: null, count: 1 }],
      [{ count: 1 }],
    ]);

    const result = await getAuditSummary(1, '2026-03-01', '2026-03-31');

    expect(result.byUser[0].userId).toBe('unknown');
    expect(result.byResourceType[0].resourceType).toBe('unknown');
  });

  // 8. getUserActivityReport returns user-specific entries
  it('getUserActivityReport returns entries for a specific user', async () => {
    const userLogs = sampleLogs.filter((l) => l.userId === 'user-1');
    resetSelectResults([userLogs]);

    const result = await getUserActivityReport('user-1', 1, '2026-03-01', '2026-03-31');

    expect(result).toEqual(userLogs);
    expect(result).toHaveLength(2);
  });

  // 9. getPhiAccessReport returns only phi_access events
  it('getPhiAccessReport returns PHI access events only', async () => {
    const phiLogs = sampleLogs.filter((l) => l.eventCategory === 'phi_access');
    resetSelectResults([phiLogs]);

    const result = await getPhiAccessReport(1, '2026-03-01', '2026-03-31');

    expect(result).toHaveLength(2);
    result.forEach((entry: any) => {
      expect(entry.eventCategory).toBe('phi_access');
    });
  });

  // 10. exportAuditLog generates CSV with headers
  it('exportAuditLog generates valid CSV output', async () => {
    resetSelectResults([sampleLogs]);

    const csv = await exportAuditLog(1);

    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'id,eventCategory,eventType,resourceType,resourceId,userId,practiceId,ipAddress,userAgent,details,success,integrityHash,createdAt',
    );
    expect(lines.length).toBe(sampleLogs.length + 1);
    expect(lines[1]).toMatch(/^1,/);
  });

  // 11. exportAuditLog supports JSON format
  it('exportAuditLog generates valid JSON output', async () => {
    resetSelectResults([sampleLogs]);

    const json = await exportAuditLog(1, undefined, 'json');

    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
  });

  // 12. getSecurityEvents returns categorized security data
  it('getSecurityEvents returns failed logins, MFA events, and failed requests', async () => {
    const failedLogin = [sampleLogs[1]];
    const mfaEvent = [{
      ...sampleLogs[0],
      id: 4,
      eventCategory: 'auth',
      resourceType: 'mfa',
      eventType: 'create',
    }];
    const allFailed = [sampleLogs[1]];

    resetSelectResults([failedLogin, mfaEvent, allFailed]);

    const result = await getSecurityEvents(1, '2026-03-01', '2026-03-31');

    expect(result.failedLogins).toEqual(failedLogin);
    expect(result.mfaEvents).toEqual(mfaEvent);
    expect(result.failedRequests).toEqual(allFailed);
    expect(result.summary.totalFailedLogins).toBe(1);
    expect(result.summary.totalMfaEvents).toBe(1);
    expect(result.summary.totalFailedRequests).toBe(1);
  });

  // 13. exportAuditLog escapes CSV values containing commas
  it('exportAuditLog properly escapes CSV fields with special characters', async () => {
    const logWithComma = [{
      ...sampleLogs[0],
      userAgent: 'Mozilla/5.0, Chrome',
      details: { key: 'value, with comma' },
    }];
    resetSelectResults([logWithComma]);

    const csv = await exportAuditLog(1);
    const lines = csv.split('\n');

    expect(lines[1]).toContain('"Mozilla/5.0, Chrome"');
  });

  // 14. getAuditLogs with action filter
  it('getAuditLogs filters by action (eventType)', async () => {
    resetSelectResults([[sampleLogs[0]], [{ count: 1 }]]);

    const result = await getAuditLogs(1, { action: 'view' });

    expect(result.data).toHaveLength(1);
    expect(mockSelectFn).toHaveBeenCalledTimes(2);
  });

  // 15. getAuditLogs with resourceType filter
  it('getAuditLogs filters by resourceType', async () => {
    resetSelectResults([[sampleLogs[0]], [{ count: 1 }]]);

    const result = await getAuditLogs(1, { resourceType: 'patient' });

    expect(result.data).toHaveLength(1);
  });
});
