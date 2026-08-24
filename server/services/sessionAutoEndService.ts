/**
 * Sessions end themselves.
 *
 * Ending a session used to require someone at the front desk to click a
 * button at the right moment. In a working clinic that click is the first
 * thing to get missed — the therapist is with the next patient and the desk
 * is on the phone — so sessions sat open indefinitely, which distorts the
 * in-session board and wait-time analytics and leaves the visit looking
 * unfinished.
 *
 * A session now closes at its scheduled end. Staff can still end one early
 * (an override, not a required step) or correct the time afterwards.
 */

import { and, eq, isNull, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { appointments } from '@shared/schema';
import logger from './logger';

/** Used when an appointment has no usable scheduled duration. */
export const DEFAULT_SESSION_MINUTES = 45;

/**
 * The moment a started session should close: its scheduled length applied to
 * when it actually started. Using the scheduled LENGTH (rather than the
 * scheduled end time) means a session that started late still gets its full
 * duration instead of being cut short the instant it begins.
 */
export function expectedSessionEnd(appointment: {
  sessionStartedAt: Date | string;
  startTime?: Date | string | null;
  endTime?: Date | string | null;
}): Date {
  const startedAt = new Date(appointment.sessionStartedAt);

  let minutes = DEFAULT_SESSION_MINUTES;
  if (appointment.startTime && appointment.endTime) {
    const scheduledMs = new Date(appointment.endTime).getTime() - new Date(appointment.startTime).getTime();
    const scheduledMinutes = Math.round(scheduledMs / 60000);
    // Ignore nonsense durations (zero, negative, or an all-day block) rather
    // than closing a session immediately or never.
    if (scheduledMinutes > 0 && scheduledMinutes <= 8 * 60) {
      minutes = scheduledMinutes;
    }
  }

  return new Date(startedAt.getTime() + minutes * 60000);
}

/**
 * Close every session whose scheduled end has passed.
 *
 * sessionEndedAt is set to the time the session SHOULD have ended, not the
 * moment this job happened to run — otherwise the recorded length would drift
 * with the job's schedule, and that length feeds billing and wait-time
 * reporting.
 */
export async function autoEndDueSessions(now: Date = new Date()): Promise<number> {
  const open = await db
    .select({
      id: appointments.id,
      practiceId: appointments.practiceId,
      sessionStartedAt: appointments.sessionStartedAt,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
    })
    .from(appointments)
    .where(
      and(
        isNotNull(appointments.sessionStartedAt),
        isNull(appointments.sessionEndedAt),
        // Nothing older than a day — a session left open for a week is a data
        // problem to look at, not something to silently backfill.
        sql`${appointments.sessionStartedAt} > NOW() - INTERVAL '24 hours'`,
      ),
    );

  let ended = 0;
  for (const appointment of open) {
    if (!appointment.sessionStartedAt) continue;
    const dueAt = expectedSessionEnd(appointment as any);
    if (dueAt > now) continue;

    try {
      await db
        .update(appointments)
        .set({ sessionEndedAt: dueAt, updatedAt: new Date() } as any)
        .where(and(eq(appointments.id, appointment.id), isNull(appointments.sessionEndedAt)));
      ended++;
    } catch (error) {
      logger.error('Failed to auto-end session', {
        appointmentId: appointment.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (ended > 0) {
    logger.info('Sessions auto-ended at their scheduled end', { count: ended });
  }
  return ended;
}
