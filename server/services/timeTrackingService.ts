/**
 * Time Tracking Service
 *
 * Manages staff time entries for tracking billable hours per therapist.
 * Supports timer-based and manual entry workflows.
 */

import { eq, and, gte, lte, isNull, sql } from 'drizzle-orm';
import { timeEntries, type TimeEntry, type InsertTimeEntry } from '@shared/schema';
import { db } from '../db';
import logger from './logger';

const VALID_ACTIVITY_TYPES = ['session', 'documentation', 'phone_call', 'admin', 'supervision', 'other'] as const;
type ActivityType = typeof VALID_ACTIVITY_TYPES[number];

export interface TimeEntryFilters {
  startDate?: Date;
  endDate?: Date;
  activityType?: string;
  billable?: boolean;
  patientId?: number;
}

export interface TimeSummaryByUser {
  userId: string;
  billableMinutes: number;
  nonBillableMinutes: number;
  byActivityType: Record<string, number>;
}

export interface TimeSummary {
  totalBillableMinutes: number;
  totalNonBillableMinutes: number;
  byUser: TimeSummaryByUser[];
}

function validateActivityType(activityType: string): asserts activityType is ActivityType {
  if (!VALID_ACTIVITY_TYPES.includes(activityType as ActivityType)) {
    throw new Error(`Invalid activity type: ${activityType}. Must be one of: ${VALID_ACTIVITY_TYPES.join(', ')}`);
  }
}

function calculateDurationMinutes(startTime: Date, endTime: Date): number {
  const diffMs = endTime.getTime() - startTime.getTime();
  if (diffMs < 0) {
    throw new Error('End time must be after start time');
  }
  return Math.round(diffMs / 60000);
}

/**
 * Start a timer - creates a time entry with startTime but no endTime.
 */
export async function startTimer(
  userId: string,
  practiceId: number,
  activityType: string,
  patientId?: number,
  appointmentId?: number,
): Promise<TimeEntry> {
  validateActivityType(activityType);

  // Check for existing active timers for this user
  const activeTimers = await getActiveTimers(userId);
  if (activeTimers.length > 0) {
    throw new Error('User already has an active timer. Stop the current timer before starting a new one.');
  }

  const insertData: InsertTimeEntry = {
    userId,
    practiceId,
    activityType,
    startTime: new Date(),
    patientId: patientId ?? null,
    appointmentId: appointmentId ?? null,
    billable: true,
  };

  const [entry] = await db.insert(timeEntries).values(insertData).returning();

  logger.info('Timer started', {
    timeEntryId: entry.id,
    userId,
    practiceId,
    activityType,
  });

  return entry;
}

/**
 * Stop a running timer - sets endTime and calculates duration.
 */
export async function stopTimer(
  entryId: number,
  userId: string,
  notes?: string,
): Promise<TimeEntry> {
  // Fetch the entry and verify ownership
  const existing = await db.select().from(timeEntries).where(
    and(eq(timeEntries.id, entryId), eq(timeEntries.userId, userId)),
  );

  if (existing.length === 0) {
    throw new Error('Time entry not found or access denied');
  }

  const entry = existing[0];

  if (entry.endTime) {
    throw new Error('Timer is already stopped');
  }

  const endTime = new Date();
  const durationMinutes = calculateDurationMinutes(entry.startTime, endTime);

  const updateData: Partial<TimeEntry> = {
    endTime,
    durationMinutes,
    updatedAt: new Date(),
  };
  if (notes !== undefined) {
    updateData.notes = notes;
  }

  const [updated] = await db
    .update(timeEntries)
    .set(updateData)
    .where(eq(timeEntries.id, entryId))
    .returning();

  logger.info('Timer stopped', {
    timeEntryId: entryId,
    userId,
    durationMinutes,
  });

  return updated;
}

/**
 * Create a manual time entry with both start and end times.
 */
export async function createManualEntry(
  userId: string,
  practiceId: number,
  data: {
    activityType: string;
    startTime: Date;
    endTime: Date;
    patientId?: number;
    appointmentId?: number;
    notes?: string;
    billable?: boolean;
  },
): Promise<TimeEntry> {
  validateActivityType(data.activityType);

  const durationMinutes = calculateDurationMinutes(data.startTime, data.endTime);

  const insertData: InsertTimeEntry = {
    userId,
    practiceId,
    activityType: data.activityType,
    startTime: data.startTime,
    endTime: data.endTime,
    durationMinutes,
    patientId: data.patientId ?? null,
    appointmentId: data.appointmentId ?? null,
    notes: data.notes ?? null,
    billable: data.billable ?? true,
  };

  const [entry] = await db.insert(timeEntries).values(insertData).returning();

  logger.info('Manual time entry created', {
    timeEntryId: entry.id,
    userId,
    practiceId,
    activityType: data.activityType,
    durationMinutes,
  });

  return entry;
}

/**
 * Get time entries for a user in a practice with optional filters.
 */
export async function getTimeEntries(
  userId: string,
  practiceId: number,
  filters?: TimeEntryFilters,
): Promise<TimeEntry[]> {
  const conditions = [
    eq(timeEntries.userId, userId),
    eq(timeEntries.practiceId, practiceId),
  ];

  if (filters?.startDate) {
    conditions.push(gte(timeEntries.startTime, filters.startDate));
  }
  if (filters?.endDate) {
    conditions.push(lte(timeEntries.startTime, filters.endDate));
  }
  if (filters?.activityType) {
    conditions.push(eq(timeEntries.activityType, filters.activityType));
  }
  if (filters?.billable !== undefined) {
    conditions.push(eq(timeEntries.billable, filters.billable));
  }
  if (filters?.patientId !== undefined) {
    conditions.push(eq(timeEntries.patientId, filters.patientId));
  }

  const results = await db.select().from(timeEntries).where(and(...conditions));

  return results;
}

/**
 * Get time summary for a practice within a date range.
 * Returns per-user totals for billable/non-billable hours by activity type.
 */
export async function getTimeSummary(
  practiceId: number,
  startDate: Date,
  endDate: Date,
): Promise<TimeSummary> {
  const results = await db
    .select({
      userId: timeEntries.userId,
      activityType: timeEntries.activityType,
      billable: timeEntries.billable,
      totalMinutes: sql<number>`COALESCE(SUM(${timeEntries.durationMinutes}), 0)`.as('total_minutes'),
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.practiceId, practiceId),
        gte(timeEntries.startTime, startDate),
        lte(timeEntries.startTime, endDate),
        // Only include completed entries (with duration)
        sql`${timeEntries.durationMinutes} IS NOT NULL`,
      ),
    )
    .groupBy(timeEntries.userId, timeEntries.activityType, timeEntries.billable);

  // Aggregate results by user
  const userMap = new Map<string, TimeSummaryByUser>();

  for (const row of results) {
    if (!userMap.has(row.userId)) {
      userMap.set(row.userId, {
        userId: row.userId,
        billableMinutes: 0,
        nonBillableMinutes: 0,
        byActivityType: {},
      });
    }

    const userSummary = userMap.get(row.userId)!;
    const minutes = Number(row.totalMinutes);

    if (row.billable) {
      userSummary.billableMinutes += minutes;
    } else {
      userSummary.nonBillableMinutes += minutes;
    }

    userSummary.byActivityType[row.activityType] =
      (userSummary.byActivityType[row.activityType] || 0) + minutes;
  }

  const byUser = Array.from(userMap.values());

  let totalBillableMinutes = 0;
  let totalNonBillableMinutes = 0;
  for (const u of byUser) {
    totalBillableMinutes += u.billableMinutes;
    totalNonBillableMinutes += u.nonBillableMinutes;
  }

  return {
    totalBillableMinutes,
    totalNonBillableMinutes,
    byUser,
  };
}

/**
 * Get active (running) timers for a user.
 */
export async function getActiveTimers(userId: string): Promise<TimeEntry[]> {
  const results = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)));

  return results;
}

/**
 * Update a time entry.
 */
export async function updateTimeEntry(
  entryId: number,
  userId: string,
  data: Partial<Pick<TimeEntry, 'activityType' | 'notes' | 'billable' | 'patientId' | 'appointmentId'>>,
): Promise<TimeEntry> {
  const existing = await db.select().from(timeEntries).where(
    and(eq(timeEntries.id, entryId), eq(timeEntries.userId, userId)),
  );

  if (existing.length === 0) {
    throw new Error('Time entry not found or access denied');
  }

  if (data.activityType) {
    validateActivityType(data.activityType);
  }

  const [updated] = await db
    .update(timeEntries)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(timeEntries.id, entryId))
    .returning();

  logger.info('Time entry updated', { timeEntryId: entryId, userId });

  return updated;
}

/**
 * Delete a time entry.
 */
export async function deleteTimeEntry(entryId: number, userId: string): Promise<void> {
  const existing = await db.select().from(timeEntries).where(
    and(eq(timeEntries.id, entryId), eq(timeEntries.userId, userId)),
  );

  if (existing.length === 0) {
    throw new Error('Time entry not found or access denied');
  }

  await db.delete(timeEntries).where(eq(timeEntries.id, entryId));

  logger.info('Time entry deleted', { timeEntryId: entryId, userId });
}
