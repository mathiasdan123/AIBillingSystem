import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so mock fns are available to vi.mock factories (which are hoisted)
const {
  mockSelect, mockFrom, mockWhere, mockGroupBy, mockOrderBy, mockInnerJoin, chain,
} = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  const mockWhere = vi.fn();
  const mockGroupBy = vi.fn();
  const mockOrderBy = vi.fn();
  const mockInnerJoin = vi.fn();

  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: mockSelect,
    from: mockFrom,
    where: mockWhere,
    groupBy: mockGroupBy,
    orderBy: mockOrderBy,
    innerJoin: mockInnerJoin,
  };

  mockSelect.mockReturnValue(chain);
  mockFrom.mockReturnValue(chain);
  mockWhere.mockReturnValue(chain);
  mockGroupBy.mockReturnValue(chain);
  mockOrderBy.mockReturnValue(chain);
  mockInnerJoin.mockReturnValue(chain);

  return { mockSelect, mockFrom, mockWhere, mockGroupBy, mockOrderBy, mockInnerJoin, chain };
});

vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue({
    select: mockSelect,
  }),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: any[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: any[]) => ({ type: 'and', args })),
  gte: vi.fn((...args: any[]) => ({ type: 'gte', args })),
  lte: vi.fn((...args: any[]) => ({ type: 'lte', args })),
  sql: vi.fn((strings: TemplateStringsArray, ..._values: any[]) => strings.join('')),
  count: vi.fn(() => 'count'),
  sum: vi.fn(() => 'sum'),
  avg: vi.fn(() => 'avg'),
  isNotNull: vi.fn(() => 'isNotNull'),
}));

vi.mock('@shared/schema', () => ({
  claims: { id: 'claims.id', practiceId: 'claims.practiceId', status: 'claims.status', totalAmount: 'claims.totalAmount', paidAmount: 'claims.paidAmount', submittedAt: 'claims.submittedAt', paidAt: 'claims.paidAt', createdAt: 'claims.createdAt', insuranceId: 'claims.insuranceId', sessionId: 'claims.sessionId', denialReason: 'claims.denialReason' },
  claimLineItems: { id: 'cli.id', claimId: 'cli.claimId', cptCodeId: 'cli.cptCodeId', amount: 'cli.amount' },
  cptCodes: { id: 'cpt.id', code: 'cpt.code', description: 'cpt.description' },
  insurances: { id: 'ins.id', name: 'ins.name' },
  users: { id: 'users.id', firstName: 'users.firstName', lastName: 'users.lastName', practiceId: 'users.practiceId', role: 'users.role' },
  appointments: { id: 'appt.id', therapistId: 'appt.therapistId', practiceId: 'appt.practiceId', startTime: 'appt.startTime', status: 'appt.status' },
  treatmentSessions: { id: 'ts.id', therapistId: 'ts.therapistId', practiceId: 'ts.practiceId', patientId: 'ts.patientId', sessionDate: 'ts.sessionDate' },
}));

import {
  getRevenueBreakdown,
  getClaimMetrics,
  getProviderProductivity,
  getPayerPerformance,
  getTrendData,
} from '../services/practiceAnalyticsService';

const startDate = new Date('2025-01-01');
const endDate = new Date('2025-12-31');
const practiceId = 1;

describe('PracticeAnalyticsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish chain returns after clearAllMocks
    mockSelect.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    mockWhere.mockReturnValue(chain);
    mockGroupBy.mockReturnValue(chain);
    mockOrderBy.mockReturnValue(chain);
    mockInnerJoin.mockReturnValue(chain);
  });

  // ==================== getRevenueBreakdown ====================

  describe('getRevenueBreakdown', () => {
    it('should return revenue breakdown with byPayer, byCpt, byProvider, and totals', async () => {
      mockGroupBy.mockResolvedValueOnce([
        { payerId: 1, payerName: 'Aetna', totalBilled: '5000.00', totalPaid: '4200.00', claimCount: 10 },
        { payerId: 2, payerName: 'BlueCross', totalBilled: '3000.00', totalPaid: '2800.00', claimCount: 6 },
      ]);
      mockGroupBy.mockResolvedValueOnce([
        { cptCode: '90837', description: 'Psychotherapy 60 min', totalBilled: '4000.00', totalPaid: '3500.00', claimCount: 8 },
      ]);
      mockGroupBy.mockResolvedValueOnce([
        { providerId: 'p1', firstName: 'Jane', lastName: 'Doe', totalBilled: '8000.00', totalPaid: '7000.00', claimCount: 16 },
      ]);

      const result = await getRevenueBreakdown(practiceId, startDate, endDate);

      expect(result.byPayer).toHaveLength(2);
      expect(result.byPayer[0].payerName).toBe('Aetna');
      expect(result.byPayer[0].totalBilled).toBe(5000);
      expect(result.byPayer[0].totalPaid).toBe(4200);
      expect(result.byCpt).toHaveLength(1);
      expect(result.byCpt[0].cptCode).toBe('90837');
      expect(result.byProvider).toHaveLength(1);
      expect(result.byProvider[0].providerName).toBe('Jane Doe');
      expect(result.totalBilled).toBe(8000);
      expect(result.totalPaid).toBe(7000);
    });

    it('should return empty arrays and zero totals when no data exists', async () => {
      mockGroupBy.mockResolvedValueOnce([]);
      mockGroupBy.mockResolvedValueOnce([]);
      mockGroupBy.mockResolvedValueOnce([]);

      const result = await getRevenueBreakdown(practiceId, startDate, endDate);

      expect(result.byPayer).toHaveLength(0);
      expect(result.byCpt).toHaveLength(0);
      expect(result.byProvider).toHaveLength(0);
      expect(result.totalBilled).toBe(0);
      expect(result.totalPaid).toBe(0);
    });

    it('should handle providers with missing name fields', async () => {
      mockGroupBy.mockResolvedValueOnce([]);
      mockGroupBy.mockResolvedValueOnce([]);
      mockGroupBy.mockResolvedValueOnce([
        { providerId: 'p1', firstName: null, lastName: null, totalBilled: '100.00', totalPaid: '80.00', claimCount: 1 },
      ]);

      const result = await getRevenueBreakdown(practiceId, startDate, endDate);

      expect(result.byProvider[0].providerName).toBe('Unknown');
    });
  });

  // ==================== getClaimMetrics ====================

  describe('getClaimMetrics', () => {
    it('should return correct claim metrics', async () => {
      mockWhere.mockResolvedValueOnce([
        { totalSubmitted: 100, totalPaid: 80, totalDenied: 10, cleanClaims: 75, firstPassPaid: 75 },
      ]);
      mockWhere.mockResolvedValueOnce([
        { avgDays: '14.50' },
      ]);

      const result = await getClaimMetrics(practiceId, startDate, endDate);

      expect(result.totalSubmitted).toBe(100);
      expect(result.totalPaid).toBe(80);
      expect(result.totalDenied).toBe(10);
      expect(result.denialRate).toBe(10);
      expect(result.cleanClaimRate).toBe(75);
      expect(result.firstPassResolutionRate).toBe(93.75);
      expect(result.avgSubmissionToPaymentDays).toBe(14.5);
    });

    it('should return zero rates when no claims exist', async () => {
      mockWhere.mockResolvedValueOnce([
        { totalSubmitted: 0, totalPaid: 0, totalDenied: 0, cleanClaims: 0, firstPassPaid: 0 },
      ]);
      mockWhere.mockResolvedValueOnce([
        { avgDays: '0' },
      ]);

      const result = await getClaimMetrics(practiceId, startDate, endDate);

      expect(result.denialRate).toBe(0);
      expect(result.cleanClaimRate).toBe(0);
      expect(result.firstPassResolutionRate).toBe(0);
      expect(result.avgSubmissionToPaymentDays).toBe(0);
    });

    it('should handle null result rows gracefully', async () => {
      mockWhere.mockResolvedValueOnce([]);
      mockWhere.mockResolvedValueOnce([]);

      const result = await getClaimMetrics(practiceId, startDate, endDate);

      expect(result.totalSubmitted).toBe(0);
      expect(result.totalPaid).toBe(0);
      expect(result.totalDenied).toBe(0);
    });
  });

  // ==================== getProviderProductivity ====================

  describe('getProviderProductivity', () => {
    it('should return productivity data for each provider', async () => {
      mockWhere.mockResolvedValueOnce([
        { id: 'p1', firstName: 'Alice', lastName: 'Smith' },
      ]);
      mockWhere.mockResolvedValueOnce([
        { total: 25 },
      ]);
      mockWhere.mockResolvedValueOnce([
        { claimsSubmitted: 20, totalRevenue: '3500.00', avgClaimValue: '175.00' },
      ]);

      const result = await getProviderProductivity(practiceId, startDate, endDate);

      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('p1');
      expect(result[0].providerName).toBe('Alice Smith');
      expect(result[0].appointmentsCount).toBe(25);
      expect(result[0].claimsSubmitted).toBe(20);
      expect(result[0].totalRevenue).toBe(3500);
      expect(result[0].avgClaimValue).toBe(175);
    });

    it('should return empty array when no providers exist', async () => {
      mockWhere.mockResolvedValueOnce([]);

      const result = await getProviderProductivity(practiceId, startDate, endDate);

      expect(result).toHaveLength(0);
    });

    it('should handle providers with zero claims', async () => {
      mockWhere.mockResolvedValueOnce([
        { id: 'p2', firstName: 'Bob', lastName: 'Jones' },
      ]);
      mockWhere.mockResolvedValueOnce([
        { total: 5 },
      ]);
      mockWhere.mockResolvedValueOnce([
        { claimsSubmitted: 0, totalRevenue: '0', avgClaimValue: '0' },
      ]);

      const result = await getProviderProductivity(practiceId, startDate, endDate);

      expect(result[0].claimsSubmitted).toBe(0);
      expect(result[0].totalRevenue).toBe(0);
      expect(result[0].avgClaimValue).toBe(0);
    });
  });

  // ==================== getPayerPerformance ====================

  describe('getPayerPerformance', () => {
    it('should return payer performance metrics', async () => {
      mockGroupBy.mockResolvedValueOnce([
        {
          payerId: 1,
          payerName: 'Aetna',
          totalClaims: 50,
          totalDenied: 5,
          avgPaymentDays: '21.30',
          avgReimbursementRate: '85.50',
        },
        {
          payerId: 2,
          payerName: 'Cigna',
          totalClaims: 30,
          totalDenied: 9,
          avgPaymentDays: '35.00',
          avgReimbursementRate: '72.00',
        },
      ]);

      const result = await getPayerPerformance(practiceId, startDate, endDate);

      expect(result).toHaveLength(2);
      expect(result[0].payerName).toBe('Aetna');
      expect(result[0].avgPaymentTimeDays).toBe(21.3);
      expect(result[0].denialRate).toBe(10);
      expect(result[0].avgReimbursementRate).toBe(85.5);
      expect(result[1].payerName).toBe('Cigna');
      expect(result[1].denialRate).toBe(30);
    });

    it('should return empty array when no payer data exists', async () => {
      mockGroupBy.mockResolvedValueOnce([]);

      const result = await getPayerPerformance(practiceId, startDate, endDate);

      expect(result).toHaveLength(0);
    });
  });

  // ==================== getTrendData ====================

  describe('getTrendData', () => {
    it('should return monthly trend data points', async () => {
      mockOrderBy.mockResolvedValueOnce([
        { month: '2025-01', revenue: '5000.00', claimVolume: 20, deniedCount: 2 },
        { month: '2025-02', revenue: '6000.00', claimVolume: 25, deniedCount: 3 },
        { month: '2025-03', revenue: '5500.00', claimVolume: 22, deniedCount: 0 },
      ]);

      const result = await getTrendData(practiceId, 12);

      expect(result).toHaveLength(3);
      expect(result[0].month).toBe('2025-01');
      expect(result[0].revenue).toBe(5000);
      expect(result[0].claimVolume).toBe(20);
      expect(result[0].denialRate).toBe(10);
      expect(result[2].denialRate).toBe(0);
    });

    it('should return empty array when no trend data exists', async () => {
      mockOrderBy.mockResolvedValueOnce([]);

      const result = await getTrendData(practiceId, 6);

      expect(result).toHaveLength(0);
    });

    it('should default to 12 months when months parameter is not provided', async () => {
      mockOrderBy.mockResolvedValueOnce([]);

      await getTrendData(practiceId);

      expect(mockSelect).toHaveBeenCalled();
    });

    it('should handle zero claim volumes without division errors', async () => {
      mockOrderBy.mockResolvedValueOnce([
        { month: '2025-01', revenue: '0', claimVolume: 0, deniedCount: 0 },
      ]);

      const result = await getTrendData(practiceId, 3);

      expect(result[0].denialRate).toBe(0);
      expect(result[0].revenue).toBe(0);
    });
  });

  // ==================== Date filtering ====================

  describe('date filtering', () => {
    it('should pass date range to revenue breakdown queries', async () => {
      mockGroupBy.mockResolvedValueOnce([]);
      mockGroupBy.mockResolvedValueOnce([]);
      mockGroupBy.mockResolvedValueOnce([]);

      const customStart = new Date('2025-06-01');
      const customEnd = new Date('2025-06-30');

      await getRevenueBreakdown(practiceId, customStart, customEnd);

      expect(mockSelect).toHaveBeenCalledTimes(3);
    });

    it('should pass date range to claim metrics queries', async () => {
      mockWhere.mockResolvedValueOnce([
        { totalSubmitted: 0, totalPaid: 0, totalDenied: 0, cleanClaims: 0, firstPassPaid: 0 },
      ]);
      mockWhere.mockResolvedValueOnce([{ avgDays: '0' }]);

      const customStart = new Date('2025-03-01');
      const customEnd = new Date('2025-03-31');

      const result = await getClaimMetrics(practiceId, customStart, customEnd);

      expect(result.totalSubmitted).toBe(0);
      expect(mockSelect).toHaveBeenCalledTimes(2);
    });
  });
});
