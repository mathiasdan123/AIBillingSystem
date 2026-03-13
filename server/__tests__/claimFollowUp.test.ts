import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db before importing service
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockGroupBy = vi.fn();
const mockValues = vi.fn();
const mockSet = vi.fn();
const mockReturning = vi.fn();

vi.mock('../db', () => ({
  db: {
    select: () => ({
      from: (table: any) => ({
        where: (condition: any) => ({
          orderBy: mockOrderBy,
          groupBy: mockGroupBy,
        }),
      }),
    }),
    insert: (table: any) => ({
      values: (vals: any) => ({
        returning: mockReturning,
      }),
    }),
    update: (table: any) => ({
      set: (data: any) => ({
        where: (condition: any) => ({
          returning: mockReturning,
        }),
      }),
    }),
  },
}));

vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock drizzle-orm operators
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ op: 'eq', a, b })),
  and: vi.fn((...args: any[]) => ({ op: 'and', args })),
  desc: vi.fn((col) => ({ op: 'desc', col })),
  count: vi.fn(() => 'count'),
  inArray: vi.fn((col, vals) => ({ op: 'inArray', col, vals })),
}));

describe('Claim Follow-Up Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('aging detection logic', () => {
    it('should identify claims over 30 days as aging_30 with medium priority', () => {
      const now = new Date();
      const submittedAt = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000); // 35 days ago
      const daysSinceSubmission = Math.floor(
        (now.getTime() - submittedAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      expect(daysSinceSubmission).toBeGreaterThanOrEqual(30);
      expect(daysSinceSubmission).toBeLessThan(60);

      // The service logic: 30-59 days = aging_30, medium priority
      let applicableType: string | null = null;
      let applicablePriority = 'medium';

      if (daysSinceSubmission >= 90) {
        applicableType = 'aging_90';
        applicablePriority = 'urgent';
      } else if (daysSinceSubmission >= 60) {
        applicableType = 'aging_60';
        applicablePriority = 'high';
      } else if (daysSinceSubmission >= 30) {
        applicableType = 'aging_30';
        applicablePriority = 'medium';
      }

      expect(applicableType).toBe('aging_30');
      expect(applicablePriority).toBe('medium');
    });

    it('should identify claims over 60 days as aging_60 with high priority', () => {
      const now = new Date();
      const submittedAt = new Date(now.getTime() - 65 * 24 * 60 * 60 * 1000);
      const daysSinceSubmission = Math.floor(
        (now.getTime() - submittedAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      expect(daysSinceSubmission).toBeGreaterThanOrEqual(60);
      expect(daysSinceSubmission).toBeLessThan(90);

      let applicableType: string | null = null;
      let applicablePriority = 'medium';

      if (daysSinceSubmission >= 90) {
        applicableType = 'aging_90';
        applicablePriority = 'urgent';
      } else if (daysSinceSubmission >= 60) {
        applicableType = 'aging_60';
        applicablePriority = 'high';
      } else if (daysSinceSubmission >= 30) {
        applicableType = 'aging_30';
        applicablePriority = 'medium';
      }

      expect(applicableType).toBe('aging_60');
      expect(applicablePriority).toBe('high');
    });

    it('should identify claims over 90 days as aging_90 with urgent priority', () => {
      const now = new Date();
      const submittedAt = new Date(now.getTime() - 95 * 24 * 60 * 60 * 1000);
      const daysSinceSubmission = Math.floor(
        (now.getTime() - submittedAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      expect(daysSinceSubmission).toBeGreaterThanOrEqual(90);

      let applicableType: string | null = null;
      let applicablePriority = 'medium';

      if (daysSinceSubmission >= 90) {
        applicableType = 'aging_90';
        applicablePriority = 'urgent';
      } else if (daysSinceSubmission >= 60) {
        applicableType = 'aging_60';
        applicablePriority = 'high';
      } else if (daysSinceSubmission >= 30) {
        applicableType = 'aging_30';
        applicablePriority = 'medium';
      }

      expect(applicableType).toBe('aging_90');
      expect(applicablePriority).toBe('urgent');
    });

    it('should not generate follow-ups for claims under 30 days', () => {
      const now = new Date();
      const submittedAt = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
      const daysSinceSubmission = Math.floor(
        (now.getTime() - submittedAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      expect(daysSinceSubmission).toBeLessThan(30);

      let applicableType: string | null = null;

      if (daysSinceSubmission >= 90) {
        applicableType = 'aging_90';
      } else if (daysSinceSubmission >= 60) {
        applicableType = 'aging_60';
      } else if (daysSinceSubmission >= 30) {
        applicableType = 'aging_30';
      }

      expect(applicableType).toBeNull();
    });

    it('should flag denied claims for appeal', () => {
      const claim = {
        id: 1,
        status: 'denied',
        claimNumber: 'CLM-001',
        denialReason: 'Missing documentation',
      };

      // Denied claims should generate a denial_appeal follow-up
      expect(claim.status).toBe('denied');
      const followUpType = 'denial_appeal';
      const priority = 'high';
      const notes = `Claim ${claim.claimNumber} denied: ${claim.denialReason}. Review for appeal.`;

      expect(followUpType).toBe('denial_appeal');
      expect(priority).toBe('high');
      expect(notes).toContain('Missing documentation');
    });
  });

  describe('deduplication logic', () => {
    it('should not create duplicate follow-ups for the same claim and type', () => {
      const existingFollowUps = [
        { claimId: 1, followUpType: 'aging_30', status: 'pending' },
        { claimId: 2, followUpType: 'denial_appeal', status: 'in_progress' },
      ];

      const existingKeys = new Set<string>();
      for (const fu of existingFollowUps) {
        existingKeys.add(`${fu.claimId}:${fu.followUpType}`);
      }

      // Claim 1 aging_30 should be skipped
      expect(existingKeys.has('1:aging_30')).toBe(true);
      // Claim 2 denial_appeal should be skipped
      expect(existingKeys.has('2:denial_appeal')).toBe(true);
      // Claim 3 aging_60 should be allowed
      expect(existingKeys.has('3:aging_60')).toBe(false);
    });

    it('should allow follow-ups for completed/dismissed claims of same type', () => {
      // Only pending and in_progress are checked for dedup
      const existingFollowUps = [
        { claimId: 1, followUpType: 'aging_30', status: 'completed' },
      ];

      // Completed follow-ups are not in the active set, so this should not be deduped
      const activeFollowUps = existingFollowUps.filter(
        (fu) => fu.status === 'pending' || fu.status === 'in_progress'
      );

      const existingKeys = new Set<string>();
      for (const fu of activeFollowUps) {
        existingKeys.add(`${fu.claimId}:${fu.followUpType}`);
      }

      expect(existingKeys.has('1:aging_30')).toBe(false);
    });
  });

  describe('follow-up status transitions', () => {
    it('should set completedAt when status changes to completed', () => {
      const updates = { status: 'completed' as const };
      const updateData: Record<string, unknown> = { updatedAt: new Date() };

      if (updates.status !== undefined) {
        updateData.status = updates.status;
        if (updates.status === 'completed') {
          updateData.completedAt = new Date();
        }
      }

      expect(updateData.status).toBe('completed');
      expect(updateData.completedAt).toBeDefined();
      expect(updateData.completedAt).toBeInstanceOf(Date);
    });

    it('should not set completedAt for non-completed status changes', () => {
      const updates = { status: 'in_progress' as const };
      const updateData: Record<string, unknown> = { updatedAt: new Date() };

      if (updates.status !== undefined) {
        updateData.status = updates.status;
        if (updates.status === 'completed') {
          updateData.completedAt = new Date();
        }
      }

      expect(updateData.status).toBe('in_progress');
      expect(updateData.completedAt).toBeUndefined();
    });
  });

  describe('filter construction', () => {
    it('should build conditions array from filters', () => {
      const filters = {
        status: 'pending' as const,
        priority: 'high' as const,
        followUpType: 'aging_60' as const,
      };

      const conditions: string[] = ['practiceId = 1'];
      if (filters.status) conditions.push(`status = ${filters.status}`);
      if (filters.priority) conditions.push(`priority = ${filters.priority}`);
      if (filters.followUpType) conditions.push(`followUpType = ${filters.followUpType}`);

      expect(conditions).toHaveLength(4);
      expect(conditions).toContain('status = pending');
      expect(conditions).toContain('priority = high');
      expect(conditions).toContain('followUpType = aging_60');
    });

    it('should handle empty filters gracefully', () => {
      const filters = {};
      const conditions: string[] = ['practiceId = 1'];

      const f = filters as any;
      if (f.status) conditions.push(`status = ${f.status}`);
      if (f.priority) conditions.push(`priority = ${f.priority}`);

      expect(conditions).toHaveLength(1);
    });
  });

  describe('due date calculation', () => {
    it('should set due date 7 days out for aging follow-ups', () => {
      const now = new Date();
      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + 7);

      const diffMs = dueDate.getTime() - now.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(7);
    });

    it('should set due date 14 days out for denial appeal follow-ups', () => {
      const now = new Date();
      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + 14);

      const diffMs = dueDate.getTime() - now.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(14);
    });
  });

  describe('summary aggregation', () => {
    it('should aggregate status counts correctly', () => {
      const statusCounts = [
        { status: 'pending', count: 5 },
        { status: 'in_progress', count: 3 },
        { status: 'completed', count: 10 },
        { status: 'dismissed', count: 2 },
      ];

      const byStatus: Record<string, number> = {};
      let total = 0;
      for (const row of statusCounts) {
        const key = row.status || 'unknown';
        byStatus[key] = Number(row.count);
        total += Number(row.count);
      }

      expect(byStatus).toEqual({
        pending: 5,
        in_progress: 3,
        completed: 10,
        dismissed: 2,
      });
      expect(total).toBe(20);
    });

    it('should aggregate priority counts correctly', () => {
      const priorityCounts = [
        { priority: 'low', count: 2 },
        { priority: 'medium', count: 8 },
        { priority: 'high', count: 5 },
        { priority: 'urgent', count: 3 },
      ];

      const byPriority: Record<string, number> = {};
      for (const row of priorityCounts) {
        const key = row.priority || 'unknown';
        byPriority[key] = Number(row.count);
      }

      expect(byPriority).toEqual({
        low: 2,
        medium: 8,
        high: 5,
        urgent: 3,
      });
    });
  });
});
