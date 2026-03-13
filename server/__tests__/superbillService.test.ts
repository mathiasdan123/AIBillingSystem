import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing the service
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
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

// Import after mocks are set up
import {
  generateSuperbill,
  generateFromAppointment,
  getSuperbills,
  getSuperbill,
  finalizeSuperbill,
  markSent,
} from '../services/superbillService';

const makeMockSuperbill = (overrides: Record<string, any> = {}) => ({
  id: 1,
  practiceId: 1,
  patientId: 10,
  providerId: 'provider-1',
  appointmentId: null,
  dateOfService: '2026-03-10',
  diagnosisCodes: ['F41.1'],
  procedureCodes: [{ code: '90837', description: 'Psychotherapy 60 min', units: 1, fee: '150.00' }],
  totalAmount: '150.00',
  status: 'draft',
  sentAt: null,
  sentMethod: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('SuperbillService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default chain for insert: db.insert(table).values(data).returning()
    mockReturning.mockResolvedValue([makeMockSuperbill()]);
    mockValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockValues });

    // Default chain for select: db.select().from(table).where(cond).orderBy(col)
    mockOrderBy.mockResolvedValue([]);
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockWhere.mockResolvedValue([makeMockSuperbill()]);
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    // Default chain for update: db.update(table).set(data).where(cond).returning()
    mockReturning.mockResolvedValue([makeMockSuperbill({ status: 'finalized' })]);
    mockSet.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });
    mockUpdate.mockReturnValue({ set: mockSet });
  });

  describe('generateSuperbill', () => {
    it('should create a superbill with the provided data', async () => {
      const mockResult = makeMockSuperbill();
      mockReturning.mockResolvedValue([mockResult]);

      const result = await generateSuperbill(1, {
        patientId: 10,
        providerId: 'provider-1',
        dateOfService: '2026-03-10',
        diagnosisCodes: ['F41.1'],
        procedureCodes: [{ code: '90837', description: 'Psychotherapy 60 min', units: 1, fee: '150.00' }],
        totalAmount: '150.00',
      });

      expect(result).toEqual(mockResult);
      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalled();
    });

    it('should set status to draft by default', async () => {
      const mockResult = makeMockSuperbill({ status: 'draft' });
      mockReturning.mockResolvedValue([mockResult]);

      const result = await generateSuperbill(1, {
        patientId: 10,
        providerId: 'provider-1',
        dateOfService: '2026-03-10',
        diagnosisCodes: ['F41.1'],
        procedureCodes: [{ code: '90837', description: 'Psychotherapy 60 min', units: 1, fee: '150.00' }],
        totalAmount: '150.00',
      });

      expect(result.status).toBe('draft');
    });

    it('should include optional appointmentId and notes when provided', async () => {
      const mockResult = makeMockSuperbill({ appointmentId: 5, notes: 'Test notes' });
      mockReturning.mockResolvedValue([mockResult]);

      const result = await generateSuperbill(1, {
        patientId: 10,
        providerId: 'provider-1',
        appointmentId: 5,
        dateOfService: '2026-03-10',
        diagnosisCodes: ['F41.1'],
        procedureCodes: [{ code: '90837', description: 'Psychotherapy 60 min', units: 1, fee: '150.00' }],
        totalAmount: '150.00',
        notes: 'Test notes',
      });

      expect(result.appointmentId).toBe(5);
      expect(result.notes).toBe('Test notes');
    });
  });

  describe('generateFromAppointment', () => {
    it('should throw if appointment is not found', async () => {
      mockWhere.mockResolvedValue([]);

      await expect(generateFromAppointment(999, 1)).rejects.toThrow(
        'Appointment 999 not found for practice 1',
      );
    });

    it('should throw if appointment is missing patient or therapist', async () => {
      mockWhere.mockResolvedValue([{
        id: 1,
        practiceId: 1,
        patientId: null,
        therapistId: null,
        startTime: new Date('2026-03-10T10:00:00Z'),
      }]);

      await expect(generateFromAppointment(1, 1)).rejects.toThrow(
        'missing patient or therapist',
      );
    });
  });

  describe('getSuperbills', () => {
    it('should return superbills for a practice', async () => {
      const mockResults = [makeMockSuperbill(), makeMockSuperbill({ id: 2 })];
      mockOrderBy.mockResolvedValue(mockResults);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getSuperbills(1);
      expect(results).toEqual(mockResults);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should apply patient filter when provided', async () => {
      const mockResults = [makeMockSuperbill()];
      mockOrderBy.mockResolvedValue(mockResults);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getSuperbills(1, { patientId: 10 });
      expect(results).toEqual(mockResults);
      expect(mockWhere).toHaveBeenCalled();
    });

    it('should apply status filter when provided', async () => {
      const mockResults = [makeMockSuperbill({ status: 'finalized' })];
      mockOrderBy.mockResolvedValue(mockResults);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getSuperbills(1, { status: 'finalized' });
      expect(results).toEqual(mockResults);
    });

    it('should apply date range filters when provided', async () => {
      const mockResults = [makeMockSuperbill()];
      mockOrderBy.mockResolvedValue(mockResults);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getSuperbills(1, { startDate: '2026-03-01', endDate: '2026-03-31' });
      expect(results).toEqual(mockResults);
    });
  });

  describe('getSuperbill', () => {
    it('should return a superbill when found', async () => {
      const mockResult = makeMockSuperbill();
      mockWhere.mockResolvedValue([mockResult]);

      const result = await getSuperbill(1, 1);
      expect(result).toEqual(mockResult);
    });

    it('should return null when not found', async () => {
      mockWhere.mockResolvedValue([]);

      const result = await getSuperbill(999, 1);
      expect(result).toBeNull();
    });
  });

  describe('finalizeSuperbill', () => {
    it('should finalize a draft superbill', async () => {
      // getSuperbill mock - returns draft
      const draftBill = makeMockSuperbill({ status: 'draft' });
      mockWhere.mockResolvedValue([draftBill]);

      // update mock
      const finalizedBill = makeMockSuperbill({ status: 'finalized' });
      mockReturning.mockResolvedValue([finalizedBill]);

      const result = await finalizeSuperbill(1, 1);
      expect(result.status).toBe('finalized');
    });

    it('should throw if superbill not found', async () => {
      mockWhere.mockResolvedValue([]);

      await expect(finalizeSuperbill(999, 1)).rejects.toThrow(
        'Superbill 999 not found for practice 1',
      );
    });

    it('should throw if already finalized', async () => {
      mockWhere.mockResolvedValue([makeMockSuperbill({ status: 'finalized' })]);

      await expect(finalizeSuperbill(1, 1)).rejects.toThrow(
        'already finalized',
      );
    });
  });

  describe('markSent', () => {
    it('should mark a finalized superbill as sent', async () => {
      // getSuperbill returns finalized
      mockWhere.mockResolvedValue([makeMockSuperbill({ status: 'finalized' })]);

      // update returns sent
      const sentBill = makeMockSuperbill({ status: 'sent', sentMethod: 'email', sentAt: new Date() });
      mockReturning.mockResolvedValue([sentBill]);

      const result = await markSent(1, 1, 'email');
      expect(result.status).toBe('sent');
      expect(result.sentMethod).toBe('email');
    });

    it('should throw if superbill not found', async () => {
      mockWhere.mockResolvedValue([]);

      await expect(markSent(999, 1, 'email')).rejects.toThrow(
        'Superbill 999 not found for practice 1',
      );
    });

    it('should throw if superbill is still a draft', async () => {
      mockWhere.mockResolvedValue([makeMockSuperbill({ status: 'draft' })]);

      await expect(markSent(1, 1, 'email')).rejects.toThrow(
        'must be finalized before sending',
      );
    });

    it('should accept portal as sent method', async () => {
      mockWhere.mockResolvedValue([makeMockSuperbill({ status: 'finalized' })]);
      const sentBill = makeMockSuperbill({ status: 'sent', sentMethod: 'portal' });
      mockReturning.mockResolvedValue([sentBill]);

      const result = await markSent(1, 1, 'portal');
      expect(result.sentMethod).toBe('portal');
    });

    it('should accept print as sent method', async () => {
      mockWhere.mockResolvedValue([makeMockSuperbill({ status: 'finalized' })]);
      const sentBill = makeMockSuperbill({ status: 'sent', sentMethod: 'print' });
      mockReturning.mockResolvedValue([sentBill]);

      const result = await markSent(1, 1, 'print');
      expect(result.sentMethod).toBe('print');
    });
  });
});
