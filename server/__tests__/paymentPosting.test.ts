import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing the service
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockSet = vi.fn();

vi.mock('../db', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
    select: (...args: any[]) => mockSelect(...args),
    update: (...args: any[]) => mockUpdate(...args),
  },
}));

vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  postPayment,
  getPaymentsForClaim,
  getPaymentSummary,
  getUnpostedClaims,
  reversePayment,
  getDailyPostingSummary,
} from '../services/paymentPostingService';

describe('PaymentPostingService', () => {
  const mockPracticeId = 1;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default chain: db.insert().values().returning()
    mockReturning.mockResolvedValue([]);
    mockValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockValues });

    // Default chain: db.select().from().where()
    mockWhere.mockResolvedValue([]);
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    // Default chain: db.update().set().where().returning()
    mockSet.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });
    mockUpdate.mockReturnValue({ set: mockSet });
  });

  describe('postPayment', () => {
    it('should post a payment and return the posting record', async () => {
      const mockClaim = {
        id: 10,
        practiceId: mockPracticeId,
        totalAmount: '200.00',
        status: 'submitted',
        paidAt: null,
      };

      const mockPosting = {
        id: 1,
        practiceId: mockPracticeId,
        claimId: 10,
        payerName: 'Aetna',
        paymentAmount: '200.00',
        paymentDate: '2026-03-01',
      };

      // First select: claim lookup
      // Second select: sum of payments
      let selectCallCount = 0;
      mockWhere.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return Promise.resolve([mockClaim]);
        }
        return Promise.resolve([{ totalPaid: '200.00' }]);
      });

      mockReturning.mockResolvedValueOnce([mockPosting]);

      const result = await postPayment(mockPracticeId, {
        claimId: 10,
        payerName: 'Aetna',
        paymentAmount: '200.00',
        paymentDate: '2026-03-01',
      });

      expect(result).toEqual(mockPosting);
      expect(mockInsert).toHaveBeenCalled();
    });

    it('should throw error if claim not found', async () => {
      mockWhere.mockResolvedValueOnce([]);

      await expect(
        postPayment(mockPracticeId, {
          claimId: 999,
          payerName: 'Aetna',
          paymentAmount: '100.00',
          paymentDate: '2026-03-01',
        }),
      ).rejects.toThrow('Claim 999 not found for practice 1');
    });

    it('should set claim status to paid when fully paid', async () => {
      const mockClaim = {
        id: 10,
        practiceId: mockPracticeId,
        totalAmount: '150.00',
        status: 'submitted',
        paidAt: null,
      };

      const mockPosting = {
        id: 2,
        practiceId: mockPracticeId,
        claimId: 10,
        payerName: 'BCBS',
        paymentAmount: '150.00',
        paymentDate: '2026-03-01',
      };

      let selectCallCount = 0;
      mockWhere.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return Promise.resolve([mockClaim]);
        return Promise.resolve([{ totalPaid: '150.00' }]);
      });

      mockReturning.mockResolvedValueOnce([mockPosting]);

      await postPayment(mockPracticeId, {
        claimId: 10,
        payerName: 'BCBS',
        paymentAmount: '150.00',
        paymentDate: '2026-03-01',
      });

      // Verify update was called (for claim status)
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should set claim status to partial when underpaid', async () => {
      const mockClaim = {
        id: 10,
        practiceId: mockPracticeId,
        totalAmount: '200.00',
        status: 'submitted',
        paidAt: null,
      };

      const mockPosting = {
        id: 3,
        practiceId: mockPracticeId,
        claimId: 10,
        payerName: 'Cigna',
        paymentAmount: '100.00',
        paymentDate: '2026-03-01',
      };

      let selectCallCount = 0;
      mockWhere.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return Promise.resolve([mockClaim]);
        return Promise.resolve([{ totalPaid: '100.00' }]);
      });

      mockReturning.mockResolvedValueOnce([mockPosting]);

      await postPayment(mockPracticeId, {
        claimId: 10,
        payerName: 'Cigna',
        paymentAmount: '100.00',
        paymentDate: '2026-03-01',
      });

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should throw error if insert returns empty', async () => {
      const mockClaim = {
        id: 10,
        practiceId: mockPracticeId,
        totalAmount: '200.00',
        status: 'submitted',
        paidAt: null,
      };

      mockWhere.mockResolvedValueOnce([mockClaim]);
      mockReturning.mockResolvedValueOnce([]);

      await expect(
        postPayment(mockPracticeId, {
          claimId: 10,
          payerName: 'Aetna',
          paymentAmount: '100.00',
          paymentDate: '2026-03-01',
        }),
      ).rejects.toThrow('Failed to insert payment posting');
    });
  });

  describe('getPaymentsForClaim', () => {
    it('should return all payments for a claim', async () => {
      const mockPayments = [
        { id: 1, claimId: 10, paymentAmount: '100.00' },
        { id: 2, claimId: 10, paymentAmount: '50.00' },
      ];

      mockWhere.mockResolvedValueOnce(mockPayments);

      const result = await getPaymentsForClaim(10, mockPracticeId);
      expect(result).toEqual(mockPayments);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should return empty array when no payments exist', async () => {
      mockWhere.mockResolvedValueOnce([]);

      const result = await getPaymentsForClaim(999, mockPracticeId);
      expect(result).toEqual([]);
    });
  });

  describe('getPaymentSummary', () => {
    it('should return aggregated payment summary for date range', async () => {
      mockWhere.mockResolvedValueOnce([
        {
          totalPayments: '5000.00',
          totalAdjustments: '200.00',
          totalPatientResponsibility: '300.00',
          paymentCount: '10',
        },
      ]);

      const result = await getPaymentSummary(
        mockPracticeId,
        new Date('2026-01-01'),
        new Date('2026-03-31'),
      );

      expect(result).toEqual({
        totalPayments: 5000,
        totalAdjustments: 200,
        totalPatientResponsibility: 300,
        paymentCount: 10,
      });
    });

    it('should return zeros when no payments in range', async () => {
      mockWhere.mockResolvedValueOnce([
        {
          totalPayments: '0',
          totalAdjustments: '0',
          totalPatientResponsibility: '0',
          paymentCount: '0',
        },
      ]);

      const result = await getPaymentSummary(
        mockPracticeId,
        new Date('2020-01-01'),
        new Date('2020-01-31'),
      );

      expect(result.totalPayments).toBe(0);
      expect(result.paymentCount).toBe(0);
    });
  });

  describe('getUnpostedClaims', () => {
    it('should return claims in submitted status older than 14 days', async () => {
      const mockClaims = [
        { id: 1, status: 'submitted', submittedAt: new Date('2026-02-01') },
        { id: 2, status: 'submitted', submittedAt: new Date('2026-02-10') },
      ];

      mockWhere.mockResolvedValueOnce(mockClaims);

      const result = await getUnpostedClaims(mockPracticeId);
      expect(result).toHaveLength(2);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should return empty array when all claims have payments', async () => {
      mockWhere.mockResolvedValueOnce([]);

      const result = await getUnpostedClaims(mockPracticeId);
      expect(result).toEqual([]);
    });
  });

  describe('reversePayment', () => {
    it('should reverse a payment and update claim status', async () => {
      const mockPayment = {
        id: 1,
        practiceId: mockPracticeId,
        claimId: 10,
        paymentAmount: '100.00',
        reversed: false,
      };

      const mockReversedPayment = {
        ...mockPayment,
        reversed: true,
        reversedAt: new Date(),
        reversalReason: 'Duplicate payment',
      };

      const mockClaim = {
        id: 10,
        totalAmount: '200.00',
      };

      // First select: payment lookup
      // Second select: recalculate totals
      // Third select: claim lookup
      let selectCallCount = 0;
      mockWhere.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return Promise.resolve([mockPayment]);
        if (selectCallCount === 2) return Promise.resolve([{ totalPaid: '0' }]);
        return Promise.resolve([mockClaim]);
      });

      // update().set().where().returning() - for the reversal
      const mockWhereReturning = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockReversedPayment]) });
      mockSet.mockReturnValueOnce({ where: mockWhereReturning });

      // Second update for claim status
      const mockWhereNoReturn = vi.fn().mockResolvedValue([]);
      mockSet.mockReturnValueOnce({ where: mockWhereNoReturn });

      const result = await reversePayment(1, mockPracticeId, 'Duplicate payment');
      expect(result).toEqual(mockReversedPayment);
    });

    it('should throw error if payment not found', async () => {
      mockWhere.mockResolvedValueOnce([]);

      await expect(
        reversePayment(999, mockPracticeId, 'Not found'),
      ).rejects.toThrow('Payment 999 not found for practice 1');
    });

    it('should throw error if payment already reversed', async () => {
      const mockPayment = {
        id: 1,
        practiceId: mockPracticeId,
        claimId: 10,
        reversed: true,
      };

      mockWhere.mockResolvedValueOnce([mockPayment]);

      await expect(
        reversePayment(1, mockPracticeId, 'Already reversed'),
      ).rejects.toThrow('Payment 1 has already been reversed');
    });
  });

  describe('getDailyPostingSummary', () => {
    it('should return summary for a specific day', async () => {
      mockWhere.mockResolvedValueOnce([
        {
          totalPayments: '1500.00',
          totalAdjustments: '50.00',
          totalPatientResponsibility: '100.00',
          postingCount: '3',
          claimsAffected: '2',
        },
      ]);

      const result = await getDailyPostingSummary(mockPracticeId, new Date('2026-03-13'));

      expect(result).toEqual({
        date: '2026-03-13',
        totalPayments: 1500,
        totalAdjustments: 50,
        totalPatientResponsibility: 100,
        postingCount: 3,
        claimsAffected: 2,
      });
    });

    it('should return zeros for a day with no postings', async () => {
      mockWhere.mockResolvedValueOnce([
        {
          totalPayments: '0',
          totalAdjustments: '0',
          totalPatientResponsibility: '0',
          postingCount: '0',
          claimsAffected: '0',
        },
      ]);

      const result = await getDailyPostingSummary(mockPracticeId, new Date('2026-01-01'));

      expect(result.totalPayments).toBe(0);
      expect(result.postingCount).toBe(0);
      expect(result.claimsAffected).toBe(0);
    });
  });
});
