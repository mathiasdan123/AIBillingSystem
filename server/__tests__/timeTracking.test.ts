import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing the service
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockUpdate = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockSet = vi.fn();
const mockGroupBy = vi.fn();

vi.mock('../db', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
    select: (...args: any[]) => mockSelect(...args),
    delete: (...args: any[]) => mockDelete(...args),
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
  startTimer,
  stopTimer,
  createManualEntry,
  getTimeEntries,
  getTimeSummary,
  getActiveTimers,
  updateTimeEntry,
  deleteTimeEntry,
} from '../services/timeTrackingService';

describe('TimeTrackingService', () => {
  const mockUserId = 'user-123';
  const mockPracticeId = 1;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default chain: db.insert().values().returning()
    mockReturning.mockResolvedValue([]);
    mockValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockValues });

    // Default chain: db.select().from().where().groupBy()
    mockGroupBy.mockResolvedValue([]);
    mockWhere.mockResolvedValue([]);
    mockWhere.mockReturnValue({ groupBy: mockGroupBy });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    // Default chain: db.update().set().where().returning()
    mockSet.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });
    mockUpdate.mockReturnValue({ set: mockSet });

    // Default chain: db.delete().where()
    mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
  });

  describe('startTimer', () => {
    it('should create a new time entry with startTime and no endTime', async () => {
      const mockEntry = {
        id: 1,
        userId: mockUserId,
        practiceId: mockPracticeId,
        activityType: 'session',
        startTime: new Date(),
        endTime: null,
        durationMinutes: null,
        patientId: null,
        appointmentId: null,
        notes: null,
        billable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // getActiveTimers returns empty (no active timers)
      mockWhere.mockResolvedValueOnce([]);
      // insert returns the new entry
      mockReturning.mockResolvedValueOnce([mockEntry]);

      const result = await startTimer(mockUserId, mockPracticeId, 'session');

      expect(result).toEqual(mockEntry);
      expect(mockInsert).toHaveBeenCalled();
    });

    it('should throw if user already has an active timer', async () => {
      const existingTimer = {
        id: 99,
        userId: mockUserId,
        endTime: null,
      };

      // getActiveTimers returns an existing timer
      mockWhere.mockResolvedValueOnce([existingTimer]);

      await expect(startTimer(mockUserId, mockPracticeId, 'session'))
        .rejects.toThrow('User already has an active timer');
    });

    it('should throw for invalid activity type', async () => {
      await expect(startTimer(mockUserId, mockPracticeId, 'invalid_type'))
        .rejects.toThrow('Invalid activity type');
    });

    it('should pass patientId and appointmentId when provided', async () => {
      const mockEntry = {
        id: 2,
        userId: mockUserId,
        practiceId: mockPracticeId,
        activityType: 'documentation',
        startTime: new Date(),
        endTime: null,
        durationMinutes: null,
        patientId: 10,
        appointmentId: 20,
        notes: null,
        billable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockWhere.mockResolvedValueOnce([]); // no active timers
      mockReturning.mockResolvedValueOnce([mockEntry]);

      const result = await startTimer(mockUserId, mockPracticeId, 'documentation', 10, 20);

      expect(result.patientId).toBe(10);
      expect(result.appointmentId).toBe(20);
    });
  });

  describe('stopTimer', () => {
    it('should set endTime and calculate duration', async () => {
      const startTime = new Date(Date.now() - 30 * 60000); // 30 min ago
      const existingEntry = {
        id: 1,
        userId: mockUserId,
        startTime,
        endTime: null,
      };

      // select returns the existing entry
      mockWhere.mockResolvedValueOnce([existingEntry]);

      const stoppedEntry = {
        ...existingEntry,
        endTime: new Date(),
        durationMinutes: 30,
        notes: 'Done',
      };

      // update chain
      const mockUpdateReturning = vi.fn().mockResolvedValue([stoppedEntry]);
      const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
      mockSet.mockReturnValue({ where: mockUpdateWhere });

      const result = await stopTimer(1, mockUserId, 'Done');

      expect(result).toEqual(stoppedEntry);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should throw if entry not found', async () => {
      mockWhere.mockResolvedValueOnce([]);

      await expect(stopTimer(999, mockUserId))
        .rejects.toThrow('Time entry not found or access denied');
    });

    it('should throw if timer is already stopped', async () => {
      const existingEntry = {
        id: 1,
        userId: mockUserId,
        startTime: new Date(),
        endTime: new Date(), // already stopped
      };

      mockWhere.mockResolvedValueOnce([existingEntry]);

      await expect(stopTimer(1, mockUserId))
        .rejects.toThrow('Timer is already stopped');
    });
  });

  describe('createManualEntry', () => {
    it('should create a completed entry with calculated duration', async () => {
      const startTime = new Date('2026-03-13T09:00:00Z');
      const endTime = new Date('2026-03-13T10:30:00Z');

      const mockEntry = {
        id: 3,
        userId: mockUserId,
        practiceId: mockPracticeId,
        activityType: 'phone_call',
        startTime,
        endTime,
        durationMinutes: 90,
        patientId: 5,
        appointmentId: null,
        notes: 'Follow-up call',
        billable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockReturning.mockResolvedValueOnce([mockEntry]);

      const result = await createManualEntry(mockUserId, mockPracticeId, {
        activityType: 'phone_call',
        startTime,
        endTime,
        patientId: 5,
        notes: 'Follow-up call',
      });

      expect(result).toEqual(mockEntry);
      expect(mockInsert).toHaveBeenCalled();
    });

    it('should throw if endTime is before startTime', async () => {
      const startTime = new Date('2026-03-13T10:00:00Z');
      const endTime = new Date('2026-03-13T09:00:00Z');

      await expect(createManualEntry(mockUserId, mockPracticeId, {
        activityType: 'admin',
        startTime,
        endTime,
      })).rejects.toThrow('End time must be after start time');
    });

    it('should throw for invalid activity type', async () => {
      const startTime = new Date('2026-03-13T09:00:00Z');
      const endTime = new Date('2026-03-13T10:00:00Z');

      await expect(createManualEntry(mockUserId, mockPracticeId, {
        activityType: 'napping',
        startTime,
        endTime,
      })).rejects.toThrow('Invalid activity type');
    });
  });

  describe('getTimeEntries', () => {
    it('should return entries for user and practice', async () => {
      const entries = [
        { id: 1, userId: mockUserId, practiceId: mockPracticeId, activityType: 'session' },
        { id: 2, userId: mockUserId, practiceId: mockPracticeId, activityType: 'documentation' },
      ];

      mockWhere.mockResolvedValueOnce(entries);

      const result = await getTimeEntries(mockUserId, mockPracticeId);

      expect(result).toEqual(entries);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should apply filters when provided', async () => {
      mockWhere.mockResolvedValueOnce([]);

      const result = await getTimeEntries(mockUserId, mockPracticeId, {
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-03-31'),
        activityType: 'session',
        billable: true,
      });

      expect(result).toEqual([]);
      expect(mockSelect).toHaveBeenCalled();
    });
  });

  describe('getTimeSummary', () => {
    it('should aggregate results by user with billable/non-billable breakdown', async () => {
      const dbRows = [
        { userId: 'user-1', activityType: 'session', billable: true, totalMinutes: 120 },
        { userId: 'user-1', activityType: 'documentation', billable: true, totalMinutes: 60 },
        { userId: 'user-1', activityType: 'admin', billable: false, totalMinutes: 30 },
        { userId: 'user-2', activityType: 'session', billable: true, totalMinutes: 90 },
      ];

      mockGroupBy.mockResolvedValueOnce(dbRows);

      const result = await getTimeSummary(mockPracticeId, new Date('2026-03-01'), new Date('2026-03-31'));

      expect(result.totalBillableMinutes).toBe(270);
      expect(result.totalNonBillableMinutes).toBe(30);
      expect(result.byUser).toHaveLength(2);

      const user1 = result.byUser.find(u => u.userId === 'user-1');
      expect(user1).toBeDefined();
      expect(user1!.billableMinutes).toBe(180);
      expect(user1!.nonBillableMinutes).toBe(30);
      expect(user1!.byActivityType.session).toBe(120);
      expect(user1!.byActivityType.documentation).toBe(60);
      expect(user1!.byActivityType.admin).toBe(30);

      const user2 = result.byUser.find(u => u.userId === 'user-2');
      expect(user2).toBeDefined();
      expect(user2!.billableMinutes).toBe(90);
      expect(user2!.nonBillableMinutes).toBe(0);
    });

    it('should return empty summary when no entries exist', async () => {
      mockGroupBy.mockResolvedValueOnce([]);

      const result = await getTimeSummary(mockPracticeId, new Date('2026-03-01'), new Date('2026-03-31'));

      expect(result.totalBillableMinutes).toBe(0);
      expect(result.totalNonBillableMinutes).toBe(0);
      expect(result.byUser).toHaveLength(0);
    });
  });

  describe('getActiveTimers', () => {
    it('should return running timers for a user', async () => {
      const activeTimers = [
        { id: 1, userId: mockUserId, endTime: null, activityType: 'session' },
      ];

      mockWhere.mockResolvedValueOnce(activeTimers);

      const result = await getActiveTimers(mockUserId);

      expect(result).toEqual(activeTimers);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should return empty array when no active timers', async () => {
      mockWhere.mockResolvedValueOnce([]);

      const result = await getActiveTimers(mockUserId);

      expect(result).toEqual([]);
    });
  });

  describe('updateTimeEntry', () => {
    it('should update entry fields', async () => {
      const existingEntry = { id: 1, userId: mockUserId, activityType: 'session' };
      mockWhere.mockResolvedValueOnce([existingEntry]);

      const updatedEntry = { ...existingEntry, activityType: 'documentation', notes: 'Updated notes' };
      const mockUpdateReturning = vi.fn().mockResolvedValue([updatedEntry]);
      const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
      mockSet.mockReturnValue({ where: mockUpdateWhere });

      const result = await updateTimeEntry(1, mockUserId, {
        activityType: 'documentation',
        notes: 'Updated notes',
      });

      expect(result).toEqual(updatedEntry);
    });

    it('should throw if entry not found', async () => {
      mockWhere.mockResolvedValueOnce([]);

      await expect(updateTimeEntry(999, mockUserId, { notes: 'test' }))
        .rejects.toThrow('Time entry not found or access denied');
    });

    it('should throw for invalid activity type on update', async () => {
      const existingEntry = { id: 1, userId: mockUserId, activityType: 'session' };
      mockWhere.mockResolvedValueOnce([existingEntry]);

      await expect(updateTimeEntry(1, mockUserId, { activityType: 'invalid' }))
        .rejects.toThrow('Invalid activity type');
    });
  });

  describe('deleteTimeEntry', () => {
    it('should delete the entry', async () => {
      const existingEntry = { id: 1, userId: mockUserId };
      mockWhere.mockResolvedValueOnce([existingEntry]);

      const mockDeleteWhere = vi.fn().mockResolvedValue([]);
      mockDelete.mockReturnValue({ where: mockDeleteWhere });

      await expect(deleteTimeEntry(1, mockUserId)).resolves.toBeUndefined();

      expect(mockDelete).toHaveBeenCalled();
    });

    it('should throw if entry not found', async () => {
      mockWhere.mockResolvedValueOnce([]);

      await expect(deleteTimeEntry(999, mockUserId))
        .rejects.toThrow('Time entry not found or access denied');
    });
  });
});
