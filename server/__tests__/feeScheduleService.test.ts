import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing the service
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockExecute = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockSet = vi.fn();

vi.mock('../db', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
    select: (...args: any[]) => mockSelect(...args),
    update: (...args: any[]) => mockUpdate(...args),
    delete: (...args: any[]) => mockDelete(...args),
    execute: (...args: any[]) => mockExecute(...args),
  },
}));

vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Import after mocks are set up
import {
  createFeeScheduleEntry,
  bulkImportFeeSchedule,
  getFeeSchedule,
  getExpectedReimbursement,
  updateFeeScheduleEntry,
  deleteFeeScheduleEntry,
  compareActualVsExpected,
  exportFeeSchedule,
} from '../services/feeScheduleService';

const makeMockFeeSchedule = (overrides: Record<string, any> = {}) => ({
  id: 1,
  practiceId: 1,
  payerName: 'Aetna',
  cptCode: '90837',
  description: 'Psychotherapy 60 min',
  billedAmount: '200.00',
  expectedReimbursement: '150.00',
  effectiveDate: '2026-01-01',
  expirationDate: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('FeeScheduleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default chain for insert: db.insert(table).values(data).returning()
    mockReturning.mockResolvedValue([makeMockFeeSchedule()]);
    mockValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockValues });

    // Default chain for select: db.select().from(table).where(cond).orderBy(col)
    mockOrderBy.mockResolvedValue([]);
    mockLimit.mockResolvedValue([]);
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    // Default chain for update: db.update(table).set(data).where(cond).returning()
    mockReturning.mockResolvedValue([makeMockFeeSchedule()]);
    mockSet.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });
    mockUpdate.mockReturnValue({ set: mockSet });

    // Default chain for delete: db.delete(table).where(cond)
    mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  // ---- createFeeScheduleEntry ----

  describe('createFeeScheduleEntry', () => {
    it('should create a fee schedule entry with the provided data', async () => {
      const mockResult = makeMockFeeSchedule();
      mockReturning.mockResolvedValue([mockResult]);

      const result = await createFeeScheduleEntry(1, {
        payerName: 'Aetna',
        cptCode: '90837',
        billedAmount: '200.00',
        expectedReimbursement: '150.00',
        effectiveDate: '2026-01-01',
      });

      expect(result).toEqual(mockResult);
      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalled();
    });

    it('should set optional fields to null when not provided', async () => {
      const mockResult = makeMockFeeSchedule({ description: null, expirationDate: null, notes: null });
      mockReturning.mockResolvedValue([mockResult]);

      const result = await createFeeScheduleEntry(1, {
        payerName: 'Aetna',
        cptCode: '90837',
        billedAmount: '200.00',
        expectedReimbursement: '150.00',
        effectiveDate: '2026-01-01',
      });

      expect(result.description).toBeNull();
      expect(result.expirationDate).toBeNull();
      expect(result.notes).toBeNull();
    });
  });

  // ---- bulkImportFeeSchedule ----

  describe('bulkImportFeeSchedule', () => {
    it('should import multiple entries at once', async () => {
      const mockResults = [
        makeMockFeeSchedule({ id: 1, cptCode: '90837' }),
        makeMockFeeSchedule({ id: 2, cptCode: '90834' }),
      ];
      mockReturning.mockResolvedValue(mockResults);

      const result = await bulkImportFeeSchedule(1, [
        { payerName: 'Aetna', cptCode: '90837', billedAmount: '200.00', expectedReimbursement: '150.00', effectiveDate: '2026-01-01' },
        { payerName: 'Aetna', cptCode: '90834', billedAmount: '160.00', expectedReimbursement: '120.00', effectiveDate: '2026-01-01' },
      ]);

      expect(result).toHaveLength(2);
      expect(mockInsert).toHaveBeenCalled();
    });

    it('should return empty array for empty input', async () => {
      const result = await bulkImportFeeSchedule(1, []);

      expect(result).toEqual([]);
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  // ---- getFeeSchedule ----

  describe('getFeeSchedule', () => {
    it('should return all entries for a practice when no filters provided', async () => {
      const mockResults = [makeMockFeeSchedule(), makeMockFeeSchedule({ id: 2 })];
      mockOrderBy.mockResolvedValue(mockResults);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getFeeSchedule(1);
      expect(results).toEqual(mockResults);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should apply payerName filter when provided', async () => {
      const mockResults = [makeMockFeeSchedule()];
      mockOrderBy.mockResolvedValue(mockResults);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getFeeSchedule(1, 'Aetna');
      expect(results).toEqual(mockResults);
      expect(mockWhere).toHaveBeenCalled();
    });

    it('should apply cptCode filter when provided', async () => {
      const mockResults = [makeMockFeeSchedule()];
      mockOrderBy.mockResolvedValue(mockResults);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getFeeSchedule(1, undefined, '90837');
      expect(results).toEqual(mockResults);
      expect(mockWhere).toHaveBeenCalled();
    });
  });

  // ---- getExpectedReimbursement ----

  describe('getExpectedReimbursement', () => {
    it('should return the most recent effective entry', async () => {
      const mockResult = makeMockFeeSchedule();
      mockLimit.mockResolvedValue([mockResult]);

      const result = await getExpectedReimbursement(1, 'Aetna', '90837');
      expect(result).toEqual(mockResult);
    });

    it('should return null when no matching entry exists', async () => {
      mockLimit.mockResolvedValue([]);

      const result = await getExpectedReimbursement(1, 'Unknown', '99999');
      expect(result).toBeNull();
    });
  });

  // ---- updateFeeScheduleEntry ----

  describe('updateFeeScheduleEntry', () => {
    it('should update an existing entry', async () => {
      // Mock the existence check
      const existing = makeMockFeeSchedule();
      mockWhere.mockResolvedValue([existing]);

      // Mock the update
      const updated = makeMockFeeSchedule({ expectedReimbursement: '160.00' });
      mockReturning.mockResolvedValue([updated]);

      const result = await updateFeeScheduleEntry(1, 1, { expectedReimbursement: '160.00' });
      expect(result.expectedReimbursement).toBe('160.00');
    });

    it('should throw if entry not found', async () => {
      mockWhere.mockResolvedValue([]);

      await expect(updateFeeScheduleEntry(999, 1, { expectedReimbursement: '160.00' })).rejects.toThrow(
        'Fee schedule entry 999 not found for practice 1',
      );
    });
  });

  // ---- deleteFeeScheduleEntry ----

  describe('deleteFeeScheduleEntry', () => {
    it('should delete an existing entry', async () => {
      const existing = makeMockFeeSchedule();
      mockWhere.mockResolvedValue([existing]);

      await expect(deleteFeeScheduleEntry(1, 1)).resolves.toBeUndefined();
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should throw if entry not found', async () => {
      mockWhere.mockResolvedValue([]);

      await expect(deleteFeeScheduleEntry(999, 1)).rejects.toThrow(
        'Fee schedule entry 999 not found for practice 1',
      );
    });
  });

  // ---- compareActualVsExpected ----

  describe('compareActualVsExpected', () => {
    it('should return a comparison report with underpayments', async () => {
      // Mock the SQL execute for the comparison join
      mockExecute.mockResolvedValue({
        rows: [
          {
            claim_id: 1,
            payer_name: 'Aetna',
            cpt_code: '90837',
            billed_amount: '200.00',
            paid_amount: '120.00',
            expected_reimbursement: '150.00',
            difference: '30.00',
          },
        ],
      });

      const report = await compareActualVsExpected(1, '2026-01-01', '2026-03-31');
      expect(report.underpayments).toHaveLength(1);
      expect(report.underpayments[0].difference).toBe('30.00');
      expect(report.underpayments[0].claimId).toBe(1);
    });

    it('should return empty underpayments when no claims underpaid', async () => {
      mockExecute.mockResolvedValue({
        rows: [
          {
            claim_id: 1,
            payer_name: 'Aetna',
            cpt_code: '90837',
            billed_amount: '200.00',
            paid_amount: '150.00',
            expected_reimbursement: '150.00',
            difference: '0.00',
          },
        ],
      });

      const report = await compareActualVsExpected(1, '2026-01-01', '2026-03-31');
      expect(report.underpayments).toHaveLength(0);
      expect(report.totalClaims).toBe(1);
    });
  });

  // ---- exportFeeSchedule ----

  describe('exportFeeSchedule', () => {
    it('should export fee schedule as CSV with headers', async () => {
      const mockEntries = [
        makeMockFeeSchedule({ payerName: 'Aetna', cptCode: '90837', billedAmount: '200.00', expectedReimbursement: '150.00' }),
      ];
      mockOrderBy.mockResolvedValue(mockEntries);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const csv = await exportFeeSchedule(1);
      const lines = csv.split('\n');

      expect(lines[0]).toBe('Payer Name,CPT Code,Description,Billed Amount,Expected Reimbursement,Effective Date,Expiration Date,Notes');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('Aetna');
      expect(lines[1]).toContain('90837');
    });

    it('should return only headers when no entries exist', async () => {
      mockOrderBy.mockResolvedValue([]);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const csv = await exportFeeSchedule(1);
      const lines = csv.split('\n');

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('Payer Name');
    });

    it('should escape CSV fields containing commas', async () => {
      const mockEntries = [
        makeMockFeeSchedule({ description: 'Therapy, 60 min session' }),
      ];
      mockOrderBy.mockResolvedValue(mockEntries);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const csv = await exportFeeSchedule(1);
      expect(csv).toContain('"Therapy, 60 min session"');
    });
  });
});
