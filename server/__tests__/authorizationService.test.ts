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
  createAuthorization,
  getAuthorizations,
  getAuthorization,
  updateAuthorization,
  incrementUsedUnits,
  getExpiringAuthorizations,
  getAuthorizationUtilization,
} from '../services/authorizationService';

const makeMockAuthorization = (overrides: Record<string, any> = {}) => ({
  id: 1,
  practiceId: 1,
  patientId: 10,
  insuranceId: 5,
  authorizationNumber: 'AUTH-001',
  diagnosisCode: 'F41.1',
  cptCode: '90837',
  authorizedUnits: 20,
  usedUnits: 5,
  startDate: '2026-01-01',
  endDate: '2026-06-30',
  status: 'active',
  requestedDate: '2025-12-15',
  approvedDate: '2025-12-20',
  deniedReason: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('AuthorizationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default chain for insert: db.insert(table).values(data).returning()
    mockReturning.mockResolvedValue([makeMockAuthorization()]);
    mockValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockValues });

    // Default chain for select: db.select().from(table).where(cond).orderBy(col)
    mockOrderBy.mockResolvedValue([]);
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockWhere.mockResolvedValue([makeMockAuthorization()]);
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    // Default chain for update: db.update(table).set(data).where(cond).returning()
    mockReturning.mockResolvedValue([makeMockAuthorization()]);
    mockSet.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });
    mockUpdate.mockReturnValue({ set: mockSet });
  });

  describe('createAuthorization', () => {
    it('should create a new authorization with provided data', async () => {
      const mockResult = makeMockAuthorization();
      mockReturning.mockResolvedValue([mockResult]);

      const result = await createAuthorization(1, {
        patientId: 10,
        insuranceId: 5,
        authorizationNumber: 'AUTH-001',
        diagnosisCode: 'F41.1',
        cptCode: '90837',
        authorizedUnits: 20,
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        status: 'active',
      });

      expect(result).toEqual(mockResult);
      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalled();
    });

    it('should default status to pending when not provided', async () => {
      const mockResult = makeMockAuthorization({ status: 'pending' });
      mockReturning.mockResolvedValue([mockResult]);

      const result = await createAuthorization(1, {
        patientId: 10,
        authorizedUnits: 10,
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      });

      expect(result.status).toBe('pending');
    });

    it('should default usedUnits to 0', async () => {
      const mockResult = makeMockAuthorization({ usedUnits: 0 });
      mockReturning.mockResolvedValue([mockResult]);

      const result = await createAuthorization(1, {
        patientId: 10,
        authorizedUnits: 10,
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      });

      expect(result.usedUnits).toBe(0);
    });
  });

  describe('getAuthorizations', () => {
    it('should return authorizations for a practice', async () => {
      const mockResults = [makeMockAuthorization(), makeMockAuthorization({ id: 2 })];
      mockOrderBy.mockResolvedValue(mockResults);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getAuthorizations(1);
      expect(results).toEqual(mockResults);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should apply patient filter when provided', async () => {
      const mockResults = [makeMockAuthorization()];
      mockOrderBy.mockResolvedValue(mockResults);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getAuthorizations(1, { patientId: 10 });
      expect(results).toEqual(mockResults);
      expect(mockWhere).toHaveBeenCalled();
    });

    it('should apply status filter when provided', async () => {
      const mockResults = [makeMockAuthorization({ status: 'expired' })];
      mockOrderBy.mockResolvedValue(mockResults);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getAuthorizations(1, { status: 'expired' });
      expect(results).toEqual(mockResults);
    });
  });

  describe('getAuthorization', () => {
    it('should return an authorization when found', async () => {
      const mockResult = makeMockAuthorization();
      mockWhere.mockResolvedValue([mockResult]);

      const result = await getAuthorization(1, 1);
      expect(result).toEqual(mockResult);
    });

    it('should return null when not found', async () => {
      mockWhere.mockResolvedValue([]);

      const result = await getAuthorization(999, 1);
      expect(result).toBeNull();
    });
  });

  describe('updateAuthorization', () => {
    it('should update authorization fields', async () => {
      // getAuthorization mock returns existing
      const existing = makeMockAuthorization();
      mockWhere.mockResolvedValue([existing]);

      // update mock
      const updated = makeMockAuthorization({ notes: 'Updated notes' });
      mockReturning.mockResolvedValue([updated]);

      const result = await updateAuthorization(1, 1, { notes: 'Updated notes' });
      expect(result.notes).toBe('Updated notes');
    });

    it('should throw if authorization not found', async () => {
      mockWhere.mockResolvedValue([]);

      await expect(updateAuthorization(999, 1, { notes: 'test' })).rejects.toThrow(
        'Authorization 999 not found for practice 1',
      );
    });
  });

  describe('incrementUsedUnits', () => {
    it('should increment used units by 1 by default', async () => {
      const existing = makeMockAuthorization({ usedUnits: 5, authorizedUnits: 20, status: 'active' });
      mockWhere.mockResolvedValue([existing]);

      const updated = makeMockAuthorization({ usedUnits: 6, status: 'active' });
      mockReturning.mockResolvedValue([updated]);

      const result = await incrementUsedUnits(1, 1);
      expect(result.usedUnits).toBe(6);
      expect(result.status).toBe('active');
    });

    it('should increment by custom units', async () => {
      const existing = makeMockAuthorization({ usedUnits: 5, authorizedUnits: 20, status: 'active' });
      mockWhere.mockResolvedValue([existing]);

      const updated = makeMockAuthorization({ usedUnits: 8, status: 'active' });
      mockReturning.mockResolvedValue([updated]);

      const result = await incrementUsedUnits(1, 1, 3);
      expect(result.usedUnits).toBe(8);
    });

    it('should auto-set status to exhausted when used >= authorized', async () => {
      const existing = makeMockAuthorization({ usedUnits: 19, authorizedUnits: 20, status: 'active' });
      mockWhere.mockResolvedValue([existing]);

      const updated = makeMockAuthorization({ usedUnits: 20, status: 'exhausted' });
      mockReturning.mockResolvedValue([updated]);

      const result = await incrementUsedUnits(1, 1);
      expect(result.status).toBe('exhausted');
    });

    it('should throw if authorization is not active', async () => {
      const existing = makeMockAuthorization({ status: 'expired' });
      mockWhere.mockResolvedValue([existing]);

      await expect(incrementUsedUnits(1, 1)).rejects.toThrow(
        'Authorization 1 is not active (status: expired)',
      );
    });

    it('should throw if authorization not found', async () => {
      mockWhere.mockResolvedValue([]);

      await expect(incrementUsedUnits(999, 1)).rejects.toThrow(
        'Authorization 999 not found for practice 1',
      );
    });
  });

  describe('getExpiringAuthorizations', () => {
    it('should return active authorizations expiring within default 14 days', async () => {
      const expiring = makeMockAuthorization({
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: 'active',
      });
      mockOrderBy.mockResolvedValue([expiring]);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getExpiringAuthorizations(1);
      expect(results).toEqual([expiring]);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should accept custom daysAhead parameter', async () => {
      mockOrderBy.mockResolvedValue([]);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getExpiringAuthorizations(1, 30);
      expect(results).toEqual([]);
      expect(mockWhere).toHaveBeenCalled();
    });
  });

  describe('getAuthorizationUtilization', () => {
    it('should return correct utilization summary', async () => {
      const today = new Date();
      const soonDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const farDate = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const activeAuths = [
        makeMockAuthorization({ usedUnits: 18, authorizedUnits: 20, endDate: farDate, status: 'active' }), // >80% used
        makeMockAuthorization({ id: 2, usedUnits: 5, authorizedUnits: 20, endDate: soonDate, status: 'active' }), // expiring soon
        makeMockAuthorization({ id: 3, usedUnits: 2, authorizedUnits: 20, endDate: farDate, status: 'active' }), // normal
      ];

      mockWhere.mockResolvedValue(activeAuths);

      const summary = await getAuthorizationUtilization(1);
      expect(summary.totalActive).toBe(3);
      expect(summary.nearingExhaustion).toBe(1);
      expect(summary.expiringSoon).toBe(1);
    });

    it('should return zeros when no active authorizations', async () => {
      mockWhere.mockResolvedValue([]);

      const summary = await getAuthorizationUtilization(1);
      expect(summary.totalActive).toBe(0);
      expect(summary.nearingExhaustion).toBe(0);
      expect(summary.expiringSoon).toBe(0);
    });
  });
});
