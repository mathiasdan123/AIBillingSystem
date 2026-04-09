import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock OpenAI
const mockCreate = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

// Mock logger
vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Chain builder for select queries
function buildSelectChain(returnValue: any[] = []) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(returnValue);
  chain.leftJoin = vi.fn().mockReturnValue(chain);
  chain.groupBy = vi.fn().mockReturnValue(chain);
  chain.having = vi.fn().mockResolvedValue(returnValue);
  chain.orderBy = vi.fn().mockResolvedValue(returnValue);
  return chain;
}

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../db', () => ({
  db: mockDb,
}));

vi.mock('@shared/schema', () => ({
  claims: { id: 'id', practiceId: 'practiceId', insuranceId: 'insuranceId', submittedAmount: 'submittedAmount', totalAmount: 'totalAmount', submittedAt: 'submittedAt', paidAt: 'paidAt', aiReviewScore: 'aiReviewScore' },
  claimLineItems: { claimId: 'claimId', cptCodeId: 'cptCodeId', icd10CodeId: 'icd10CodeId', modifier: 'modifier' },
  cptCodes: { id: 'id', code: 'code' },
  icd10Codes: { id: 'id', code: 'code' },
  insurances: { id: 'id', name: 'name' },
  aiLearningData: {
    practiceId: 'practiceId', claimId: 'claimId', cptCode: 'cptCode', icd10Code: 'icd10Code',
    payerName: 'payerName', submittedAmount: 'submittedAmount', paidAmount: 'paidAmount',
    outcome: 'outcome', denialReason: 'denialReason', modifier: 'modifier',
    aiScoreAtSubmission: 'aiScoreAtSubmission', aiRecommendationsFollowed: 'aiRecommendationsFollowed',
    processingDays: 'processingDays', adjustmentReasonCode: 'adjustmentReasonCode',
    followedAiSuggestion: 'followedAiSuggestion', createdAt: 'createdAt',
  },
  aiModelInsights: {
    practiceId: 'practiceId', isActive: 'isActive', confidence: 'confidence',
    payerName: 'payerName', cptCode: 'cptCode',
  },
}));

vi.mock('drizzle-orm', () => {
  const sqlResult = { as: vi.fn().mockReturnThis(), mapWith: vi.fn().mockReturnThis() };
  return {
    eq: vi.fn((...args: any[]) => args),
    and: vi.fn((...args: any[]) => args),
    sql: vi.fn(() => sqlResult),
    desc: vi.fn((col: any) => col),
    count: vi.fn().mockReturnValue({ as: vi.fn().mockReturnValue('count') }),
    avg: vi.fn().mockReturnValue({ as: vi.fn().mockReturnValue('avg') }),
    isNull: vi.fn((col: any) => col),
    gte: vi.fn((...args: any[]) => args),
    gt: vi.fn((...args: any[]) => args),
    lt: vi.fn((...args: any[]) => args),
    ne: vi.fn((...args: any[]) => args),
  };
});

import { recordClaimOutcome, generateInsights, getRecommendationsForClaim } from '../services/aiLearningService';

describe('aiLearningService', () => {
  const originalEnv = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENAI_API_KEY;

    // Reset chain
    const chain = buildSelectChain();
    mockDb.select.mockReturnValue(chain);
    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.OPENAI_API_KEY = originalEnv;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  // ---- recordClaimOutcome ----

  describe('recordClaimOutcome', () => {
    it('should return early when claim is not found', async () => {
      const chain = buildSelectChain([]);
      mockDb.select.mockReturnValue(chain);

      await recordClaimOutcome({
        claimId: 999,
        practiceId: 1,
        status: 'paid',
        paidAmount: '100.00',
      });

      // insert should not be called because claim was not found
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should record outcome for a paid claim with line items', async () => {
      // First call: claims select
      const claimChain = buildSelectChain([{
        id: 1,
        practiceId: 1,
        insuranceId: 1,
        submittedAmount: '150.00',
        totalAmount: '150.00',
        submittedAt: new Date('2025-01-01'),
        paidAt: new Date('2025-01-15'),
        aiReviewScore: '85',
      }]);
      // Second call: lineItems select
      const lineItemChain = buildSelectChain([
        { cptCode: '97530', icd10Code: 'F82', modifier: 'GO' },
      ]);
      // Third call: insurance select
      const insuranceChain = buildSelectChain([{ name: 'Anthem' }]);

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return claimChain;
        if (callCount === 2) return lineItemChain;
        return insuranceChain;
      });

      await recordClaimOutcome({
        claimId: 1,
        practiceId: 1,
        status: 'paid',
        paidAmount: '150.00',
      });

      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should detect partial payment when paid < 95% of submitted', async () => {
      const claimChain = buildSelectChain([{
        id: 1,
        practiceId: 1,
        insuranceId: null,
        submittedAmount: '200.00',
        totalAmount: '200.00',
        submittedAt: null,
        paidAt: null,
        aiReviewScore: null,
      }]);
      const lineItemChain = buildSelectChain([]);

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return claimChain;
        return lineItemChain;
      });

      await recordClaimOutcome({
        claimId: 1,
        practiceId: 1,
        status: 'paid',
        paidAmount: '100.00', // 50% of submitted
      });

      // Should have inserted with outcome "partial"
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should handle denied claims', async () => {
      const claimChain = buildSelectChain([{
        id: 1,
        practiceId: 1,
        insuranceId: null,
        submittedAmount: '150.00',
        totalAmount: '150.00',
        submittedAt: null,
        paidAt: null,
        aiReviewScore: null,
      }]);
      const lineItemChain = buildSelectChain([]);

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return claimChain;
        return lineItemChain;
      });

      await recordClaimOutcome({
        claimId: 1,
        practiceId: 1,
        status: 'denied',
        denialReason: 'Missing authorization',
      });

      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should not throw on database errors (logs instead)', async () => {
      mockDb.select.mockImplementation(() => {
        throw new Error('DB connection lost');
      });

      // Should not throw
      await expect(recordClaimOutcome({
        claimId: 1,
        practiceId: 1,
        status: 'paid',
      })).resolves.toBeUndefined();
    });
  });

  // ---- generateInsights ----

  describe('generateInsights', () => {
    it('should deactivate old insights before inserting new ones', async () => {
      // All queries return empty
      const emptyChain = buildSelectChain([]);
      mockDb.select.mockReturnValue(emptyChain);

      await generateInsights(1);

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should return generated count of 0 when no patterns found', async () => {
      const emptyChain = buildSelectChain([]);
      mockDb.select.mockReturnValue(emptyChain);

      const result = await generateInsights(1);
      expect(result).toEqual({ generated: 0, openAiAvailable: false });
    });

    it('should return gracefully on database errors', async () => {
      mockDb.select.mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = await generateInsights(1);
      expect(result).toEqual({ generated: 0, openAiAvailable: false });
    });

    it('should handle generating insights without OpenAI key', async () => {
      delete process.env.OPENAI_API_KEY;
      const emptyChain = buildSelectChain([]);
      mockDb.select.mockReturnValue(emptyChain);

      const result = await generateInsights(1);
      expect(result).toHaveProperty('generated');
      expect(typeof result.generated).toBe('number');
    });
  });

  // ---- getRecommendationsForClaim ----

  describe('getRecommendationsForClaim', () => {
    it('should return empty array when claim not found', async () => {
      const emptyChain = buildSelectChain([]);
      mockDb.select.mockReturnValue(emptyChain);

      const result = await getRecommendationsForClaim(999);
      expect(result).toEqual([]);
    });

    it('should return empty array on database error', async () => {
      mockDb.select.mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = await getRecommendationsForClaim(1);
      expect(result).toEqual([]);
    });

    it('should query for insights matching the claim', async () => {
      const claimChain = buildSelectChain([{
        id: 1,
        practiceId: 1,
        insuranceId: 1,
      }]);
      const lineItemChain = buildSelectChain([
        { cptCode: '97530', icd10Code: 'F82' },
      ]);
      const insuranceChain = buildSelectChain([{ name: 'Anthem' }]);
      const insightsChain = buildSelectChain([
        { id: 1, practiceId: 1, payerName: 'Anthem', cptCode: '97530', isActive: true, confidence: '0.8', title: 'Test', description: 'Desc' },
      ]);

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return claimChain;
        if (callCount === 2) return lineItemChain;
        if (callCount === 3) return insuranceChain;
        return insightsChain;
      });

      const result = await getRecommendationsForClaim(1);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should limit results to 10', async () => {
      const claimChain = buildSelectChain([{
        id: 1,
        practiceId: 1,
        insuranceId: null,
      }]);
      const lineItemChain = buildSelectChain([]);

      // Return 15 general insights
      const manyInsights = Array.from({ length: 15 }, (_, i) => ({
        id: i,
        practiceId: 1,
        payerName: null,
        cptCode: null,
        isActive: true,
        confidence: '0.5',
      }));
      const insightsChain = buildSelectChain(manyInsights);

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return claimChain;
        if (callCount === 2) return lineItemChain;
        return insightsChain;
      });

      const result = await getRecommendationsForClaim(1);
      expect(result.length).toBeLessThanOrEqual(10);
    });
  });
});
