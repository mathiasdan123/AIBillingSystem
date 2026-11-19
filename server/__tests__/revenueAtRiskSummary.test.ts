/**
 * Revenue at Risk headline figures (QA demo pass 2026-11-19, item 3): the
 * cards are derived from the open queue, so "Total at Risk" can never be $0
 * above a queue listing denials, a past-due item counts as overdue, a
 * denial task on a reopened draft reads as a correction, and a denial item
 * carries the appeal's payer deadline next to its own due date.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { storageStub, followUpStub, dbStub } = vi.hoisted(() => ({
  storageStub: {
    getAppealsDashboard: vi.fn(async () => ({
      totalDeniedAwaitingAppeal: 0, appealsPendingSubmission: 1, appealsPastDeadline: 0,
      totalRecovered: 0, last90DaysWon: 0, successRate: 0,
    })),
    getDaysInAR: vi.fn(async () => ({ byBucket: [{ bucket: '61-90', amount: 100 }, { bucket: '0-30', amount: 999 }] })),
  },
  followUpStub: { getFollowUpSummary: vi.fn(async () => ({ total: 2, byPriority: { high: 2 }, byStatus: {} })) },
  dbStub: { rows: [] as any[], appeals: [] as any[] },
}));

vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../services/claimFollowUpService', () => followUpStub);
vi.mock('../services/phiEncryptionService', () => ({ decryptField: (v: any) => v }));
vi.mock('../db', () => ({
  db: {
    select: () => ({
      from: (table: any) => {
        const isAppeals = table === 'APPEALS';
        const chain: any = {
          innerJoin: () => chain,
          leftJoin: () => chain,
          where: async () => (isAppeals ? dbStub.appeals : dbStub.rows),
        };
        return chain;
      },
    }),
  },
}));
vi.mock('../../shared/schema', () => ({
  claimFollowUps: { id: 'fu.id', followUpType: 'fu.type', priority: 'fu.priority', dueDate: 'fu.due', notes: 'fu.notes', status: 'fu.status', snoozedUntil: 'fu.snoozed', completedAt: 'fu.completed', practiceId: 'fu.practice', claimId: 'fu.claim' },
  claims: { id: 'c.id', claimNumber: 'c.number', status: 'c.status', totalAmount: 'c.total', patientId: 'c.patient' },
  patients: { id: 'p.id', firstName: 'p.first', lastName: 'p.last' },
  appeals: 'APPEALS',
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(), and: vi.fn(), inArray: vi.fn(), notInArray: vi.fn(), or: vi.fn(), isNull: vi.fn(), lte: vi.fn(), gt: vi.fn(), gte: vi.fn(),
}));

import { getRevenueAtRiskSummary, summarizeOpenQueue, presentFollowUpType, isPastDue } from '../services/revenueAtRiskService';

const row = (over: Record<string, unknown> = {}) => ({
  followUpId: 1, followUpType: 'denial_appeal', priority: 'high', dueDate: new Date('2026-11-16T00:00:00.000Z'),
  notes: null, status: 'pending', snoozedUntil: null, completedAt: null,
  claimId: 1006, claimNumber: 'DEMO-2-1006', claimStatus: 'appeal', totalAmount: '216.00',
  patientFirstName: 'Ava', patientLastName: 'Sample', ...over,
});

describe('pure helpers', () => {
  it('presents a denial task on a reopened draft as a correction', () => {
    expect(presentFollowUpType('denial_appeal', 'draft')).toBe('correction_resubmit');
    expect(presentFollowUpType('denial_appeal', 'appeal')).toBe('denial_appeal');
    expect(presentFollowUpType('aging_30', 'draft')).toBe('aging_30');
  });

  it('sums open denials once per claim and counts overdue items', () => {
    const { openDenials, overdue } = summarizeOpenQueue([
      { claimId: 1, followUpType: 'denial_appeal', amount: 150, overdue: true },
      { claimId: 1, followUpType: 'correction_resubmit', amount: 150, overdue: false },
      { claimId: 2, followUpType: 'correction_resubmit', amount: 216, overdue: true },
      { claimId: 3, followUpType: 'aging_60', amount: 500, overdue: false },
    ]);
    expect(openDenials).toBe(366);
    expect(overdue).toBe(2);
  });

  it('compares the stored due day with today as calendar days', () => {
    expect(isPastDue(new Date('2026-11-16T00:00:00.000Z'), '2026-11-19')).toBe(true);
    expect(isPastDue('2026-11-19T00:00:00.000Z', '2026-11-19')).toBe(false);
    expect(isPastDue(null, '2026-11-19')).toBe(false);
  });
});

describe('getRevenueAtRiskSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbStub.rows = [
      row(),
      row({ followUpId: 2, claimId: 1005, claimNumber: 'DEMO-2-1005', claimStatus: 'draft', totalAmount: '150.00', dueDate: new Date('2027-01-01T00:00:00.000Z') }),
    ];
    dbStub.appeals = [{ id: 7, claimId: 1006, status: 'ready', deadlineDate: '2027-01-16' }];
  });

  it('derives Total at Risk and overdue from the open queue, not from claims still in status denied', async () => {
    const s = await getRevenueAtRiskSummary(7);
    expect(s.atRisk.deniedAwaitingAppeal).toBe(366);
    expect(s.atRisk.aging61Plus).toBe(100);
    expect(s.atRisk.total).toBe(466);
    expect(s.followUps.overdue).toBe(1);
    expect(s.appeals.pastDeadline).toBe(0);
  });

  it('labels the reopened draft as a correction and attaches the payer deadline to the denial item', async () => {
    const s = await getRevenueAtRiskSummary(7);
    const denial = s.actionQueue.find((i) => i.claimId === 1006)!;
    const correction = s.actionQueue.find((i) => i.claimId === 1005)!;
    expect(denial.followUpType).toBe('denial_appeal');
    expect(denial.appealId).toBe(7);
    expect(denial.appealStatus).toBe('ready');
    expect(denial.appealDeadline).toBe('2027-01-16');
    expect(denial.overdue).toBe(true);
    expect(correction.followUpType).toBe('correction_resubmit');
    expect(correction.claimStatus).toBe('draft');
    expect(correction.appealId).toBeUndefined();
    expect(correction.overdue).toBe(false);
  });

  it('keeps the headline on the open queue when the page looks at another slice', async () => {
    const s = await getRevenueAtRiskSummary(7, { queue: 'completed' });
    expect(s.atRisk.total).toBe(466);
    expect(s.actionQueue.every((i) => i.overdue === false)).toBe(true);
  });
});
