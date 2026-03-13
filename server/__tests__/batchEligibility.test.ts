import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock db
const mockReturning = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();

vi.mock('../db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: mockOrderBy,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mockReturning,
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: mockReturning,
        })),
      })),
    })),
  },
}));

vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../services/stediService', () => ({
  isStediConfigured: vi.fn(() => true),
  checkEligibility: vi.fn(() =>
    Promise.resolve({
      status: 'active',
      raw: { test: true },
      copay: { primary: 25 },
      deductible: { individual: 500 },
      coinsurance: 20,
    })
  ),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ op: 'eq', a, b })),
  and: vi.fn((...args: any[]) => ({ op: 'and', args })),
  lt: vi.fn((a, b) => ({ op: 'lt', a, b })),
  desc: vi.fn((col) => ({ op: 'desc', col })),
  isNotNull: vi.fn((col) => ({ op: 'isNotNull', col })),
  relations: vi.fn(() => ({})),
}));

// Import after mocks
import {
  queueEligibilityCheck,
  getQueueStatus,
  processBatchEligibility,
  getEligibilityHistory,
  getExpiringEligibility,
  clearQueue,
} from '../services/batchEligibilityService';

describe('Batch Eligibility Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear all queues between tests
    clearQueue(1);
    clearQueue(2);
    clearQueue(99);
  });

  describe('queueEligibilityCheck', () => {
    it('should queue a new eligibility check and return position 1', () => {
      const result = queueEligibilityCheck(10, 1, 100);
      expect(result.queued).toBe(true);
      expect(result.position).toBe(1);
    });

    it('should assign incrementing positions for multiple items', () => {
      const result1 = queueEligibilityCheck(10, 1, 100);
      const result2 = queueEligibilityCheck(20, 1, 200);
      const result3 = queueEligibilityCheck(30, 1, 300);

      expect(result1.position).toBe(1);
      expect(result2.position).toBe(2);
      expect(result3.position).toBe(3);
    });

    it('should not queue a duplicate patient+insurance combination', () => {
      const first = queueEligibilityCheck(10, 1, 100);
      const duplicate = queueEligibilityCheck(10, 1, 100);

      expect(first.queued).toBe(true);
      expect(duplicate.queued).toBe(false);
      expect(duplicate.position).toBe(1);
    });

    it('should allow same patient with different insurance', () => {
      const result1 = queueEligibilityCheck(10, 1, 100);
      const result2 = queueEligibilityCheck(10, 1, 200);

      expect(result1.queued).toBe(true);
      expect(result2.queued).toBe(true);
      expect(result2.position).toBe(2);
    });

    it('should keep separate queues per practice', () => {
      queueEligibilityCheck(10, 1, 100);
      queueEligibilityCheck(20, 1, 200);
      const resultPractice2 = queueEligibilityCheck(30, 2, 300);

      expect(resultPractice2.position).toBe(1); // First item in practice 2's queue

      const status1 = getQueueStatus(1);
      const status2 = getQueueStatus(2);

      expect(status1.queueLength).toBe(2);
      expect(status2.queueLength).toBe(1);
    });
  });

  describe('getQueueStatus', () => {
    it('should return empty status for a practice with no queue', () => {
      const status = getQueueStatus(99);
      expect(status.queueLength).toBe(0);
      expect(status.isProcessing).toBe(false);
      expect(status.items).toEqual([]);
    });

    it('should return correct queue length and items', () => {
      queueEligibilityCheck(10, 1, 100);
      queueEligibilityCheck(20, 1, 200);

      const status = getQueueStatus(1);
      expect(status.queueLength).toBe(2);
      expect(status.isProcessing).toBe(false);
      expect(status.items).toHaveLength(2);
      expect(status.items[0].patientId).toBe(10);
      expect(status.items[1].patientId).toBe(20);
    });
  });

  describe('clearQueue', () => {
    it('should clear all items from a practice queue and return count', () => {
      queueEligibilityCheck(10, 1, 100);
      queueEligibilityCheck(20, 1, 200);

      const cleared = clearQueue(1);
      expect(cleared).toBe(2);

      const status = getQueueStatus(1);
      expect(status.queueLength).toBe(0);
    });

    it('should return 0 when clearing an empty queue', () => {
      const cleared = clearQueue(99);
      expect(cleared).toBe(0);
    });
  });

  describe('processBatchEligibility', () => {
    it('should return zero counts for empty queue', async () => {
      const result = await processBatchEligibility(1);
      expect(result.processed).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should process queued items and clear the queue', async () => {
      // Setup: mock the DB calls for processSingleCheck
      mockReturning.mockResolvedValue([{ id: 1 }]);
      const { db } = await import('../db');
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValueOnce([
            { id: 10, firstName: 'John', lastName: 'Doe', dateOfBirth: '1990-01-01', insuranceId: 'MEM123', policyNumber: 'POL456' },
          ]).mockResolvedValueOnce([
            { id: 100, name: 'Aetna', payerCode: '60054' },
          ]),
        }),
      });
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      queueEligibilityCheck(10, 1, 100);

      const result = await processBatchEligibility(1);
      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);

      // Queue should be empty after processing
      const status = getQueueStatus(1);
      expect(status.queueLength).toBe(0);
    });

    it('should throw if batch processing is already running for the same practice', async () => {
      // Queue an item that will take a while to process
      queueEligibilityCheck(10, 1, 100);

      mockReturning.mockResolvedValue([{ id: 1 }]);
      const { db } = await import('../db');
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() =>
            new Promise((resolve) => setTimeout(() => resolve([
              { id: 10, firstName: 'John', lastName: 'Doe', dateOfBirth: '1990-01-01', insuranceId: 'MEM123', policyNumber: 'POL456' },
            ]), 500))
          ),
        }),
      });
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      // Start first processing (don't await)
      const firstProcess = processBatchEligibility(1);

      // Re-queue so second call has something to attempt
      queueEligibilityCheck(20, 1, 200);

      // Second call should throw
      await expect(processBatchEligibility(1)).rejects.toThrow(
        'Batch processing is already running for this practice'
      );

      // Wait for first to complete
      await firstProcess;
    });
  });

  describe('getEligibilityHistory', () => {
    it('should call db with correct patient and practice filters', async () => {
      const mockResults = [
        { id: 1, patientId: 10, practiceId: 1, processingStatus: 'completed', eligible: true },
        { id: 2, patientId: 10, practiceId: 1, processingStatus: 'completed', eligible: false },
      ];

      mockOrderBy.mockResolvedValue(mockResults);
      const { db } = await import('../db');
      const mockWhereLocal = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: mockWhereLocal,
        }),
      });

      const history = await getEligibilityHistory(10, 1);
      expect(history).toEqual(mockResults);
      expect(db.select).toHaveBeenCalled();
    });

    it('should return empty array when no history exists', async () => {
      mockOrderBy.mockResolvedValue([]);
      const { db } = await import('../db');
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ orderBy: mockOrderBy }),
        }),
      });

      const history = await getEligibilityHistory(999, 1);
      expect(history).toEqual([]);
    });
  });

  describe('getExpiringEligibility', () => {
    it('should return patients with stale eligibility checks', async () => {
      const oldCheck = {
        id: 1,
        patientId: 10,
        practiceId: 1,
        status: 'completed',
        eligible: true,
        checkedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
      };

      mockOrderBy.mockResolvedValue([oldCheck]);
      const { db } = await import('../db');
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ orderBy: mockOrderBy }),
        }),
      });

      const expiring = await getExpiringEligibility(1, 30);
      expect(expiring).toHaveLength(1);
      expect(expiring[0].patientId).toBe(10);
    });

    it('should deduplicate by patient, keeping only the most recent check', async () => {
      const olderCheck = {
        id: 1,
        patientId: 10,
        practiceId: 1,
        status: 'completed',
        eligible: true,
        checkedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      };
      const newerCheck = {
        id: 2,
        patientId: 10,
        practiceId: 1,
        status: 'completed',
        eligible: false,
        checkedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
      };

      // Results come ordered desc by checkedAt, so newerCheck first
      mockOrderBy.mockResolvedValue([newerCheck, olderCheck]);
      const { db } = await import('../db');
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ orderBy: mockOrderBy }),
        }),
      });

      const expiring = await getExpiringEligibility(1, 30);
      expect(expiring).toHaveLength(1);
      expect(expiring[0].id).toBe(2); // Should keep the newer check
    });

    it('should use default 30 days when daysAhead is not specified', async () => {
      mockOrderBy.mockResolvedValue([]);
      const { db } = await import('../db');
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ orderBy: mockOrderBy }),
        }),
      });

      const { lt } = await import('drizzle-orm');

      await getExpiringEligibility(1);
      // Verify lt was called (meaning the cutoff date filter was applied)
      expect(lt).toHaveBeenCalled();
    });
  });

  describe('queue isolation', () => {
    it('should not affect other practices when clearing a queue', () => {
      queueEligibilityCheck(10, 1, 100);
      queueEligibilityCheck(20, 2, 200);

      clearQueue(1);

      expect(getQueueStatus(1).queueLength).toBe(0);
      expect(getQueueStatus(2).queueLength).toBe(1);
    });
  });
});
