import {
  appointments,
  waitlist,
  reviewRequests,
  googleReviews,
  patientFeedback,
  appointmentTypes,
  therapistAvailability,
  therapistTimeOff,
  bookingSettings,
  onlineBookings,
  telehealthSessions,
  telehealthSettings,
  eligibilityAlerts,
  appointmentRequests,
  patients,
  type Appointment,
  type InsertAppointment,
  type WaitlistEntry,
  type InsertWaitlistEntry,
  type ReviewRequest,
  type InsertReviewRequest,
  type GoogleReview,
  type InsertGoogleReview,
  type PatientFeedback,
  type InsertPatientFeedback,
  type AppointmentType,
  type InsertAppointmentType,
  type TherapistAvailability,
  type InsertTherapistAvailability,
  type TherapistTimeOff,
  type InsertTherapistTimeOff,
  type BookingSettings,
  type InsertBookingSettings,
  type OnlineBooking,
  type InsertOnlineBooking,
  type TelehealthSession,
  type InsertTelehealthSession,
  type TelehealthSettings,
  type InsertTelehealthSettings,
  type EligibilityAlert,
  type InsertEligibilityAlert,
  type AppointmentRequest,
  type InsertAppointmentRequest,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, gte, lte, ne, lt, isNull, count, sql } from "drizzle-orm";
import {
  encryptTelehealthSessionRecord,
  decryptTelehealthSessionRecord,
  encryptTelehealthSettingsRecord,
  decryptTelehealthSettingsRecord,
} from "../services/phiEncryptionService";
import { cache, CacheKeys } from "../services/cacheService";
import { getPatient } from "./patients";
import { getUser } from "./users";

// ==================== APPOINTMENTS ====================

export async function createAppointment(data: InsertAppointment): Promise<Appointment> {
  const [created] = await db.insert(appointments).values(data).returning();
  return created;
}

export async function getAppointments(practiceId: number, opts?: { limit?: number; offset?: number }): Promise<Appointment[]> {
  let query = db
    .select()
    .from(appointments)
    .where(eq(appointments.practiceId, practiceId))
    .orderBy(desc(appointments.startTime))
    .$dynamic();
  if (opts?.limit) query = query.limit(opts.limit);
  if (opts?.offset) query = query.offset(opts.offset);
  return await query;
}

export async function countAppointments(practiceId: number): Promise<number> {
  const [result] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(appointments)
    .where(eq(appointments.practiceId, practiceId));
  return result?.total ?? 0;
}

export async function getAppointmentsByDateRange(practiceId: number, start: Date, end: Date, opts?: { limit?: number; offset?: number }): Promise<Appointment[]> {
  let query = db
    .select()
    .from(appointments)
    .where(and(
      eq(appointments.practiceId, practiceId),
      gte(appointments.startTime, start),
      lte(appointments.startTime, end)
    ))
    .orderBy(appointments.startTime)
    .$dynamic();
  if (opts?.limit) query = query.limit(opts.limit);
  if (opts?.offset) query = query.offset(opts.offset);
  return await query;
}

export async function countAppointmentsByDateRange(practiceId: number, start: Date, end: Date): Promise<number> {
  const [result] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(appointments)
    .where(and(
      eq(appointments.practiceId, practiceId),
      gte(appointments.startTime, start),
      lte(appointments.startTime, end)
    ));
  return result?.total ?? 0;
}

export async function getAppointment(id: number): Promise<Appointment | undefined> {
  const [appt] = await db.select().from(appointments).where(eq(appointments.id, id));
  return appt;
}

export async function updateAppointment(id: number, data: Partial<InsertAppointment>): Promise<Appointment> {
  const [updated] = await db
    .update(appointments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(appointments.id, id))
    .returning();
  return updated;
}

export async function cancelAppointment(id: number, reason: string, notes?: string, cancelledBy?: string): Promise<Appointment> {
  const [updated] = await db
    .update(appointments)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: cancelledBy || null,
      cancellationReason: reason,
      cancellationNotes: notes || null,
      updatedAt: new Date(),
    })
    .where(eq(appointments.id, id))
    .returning();
  return updated;
}

export async function getAppointmentsForReminder(
  practiceId: number,
  windowStart: Date,
  windowEnd: Date
): Promise<Appointment[]> {
  return await db
    .select()
    .from(appointments)
    .where(and(
      eq(appointments.practiceId, practiceId),
      eq(appointments.status, 'scheduled'),
      eq(appointments.reminderSent, false),
      gte(appointments.startTime, windowStart),
      lte(appointments.startTime, windowEnd)
    ))
    .orderBy(appointments.startTime);
}

export async function getUpcomingAppointments(practiceId: number, hoursAhead: number = 48): Promise<Appointment[]> {
  const now = new Date();
  const future = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

  return await db
    .select()
    .from(appointments)
    .where(and(
      eq(appointments.practiceId, practiceId),
      eq(appointments.status, 'scheduled'),
      gte(appointments.startTime, now),
      lte(appointments.startTime, future)
    ))
    .orderBy(appointments.startTime);
}

export async function getUpcomingAppointmentsForReminders(hoursAhead: number): Promise<Appointment[]> {
  const now = new Date();
  const future = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

  return await db
    .select()
    .from(appointments)
    .where(and(
      eq(appointments.status, 'scheduled'),
      eq(appointments.reminderSent, false),
      gte(appointments.startTime, now),
      lte(appointments.startTime, future)
    ))
    .orderBy(appointments.startTime);
}

export async function markReminderSent(appointmentId: number): Promise<void> {
  await db
    .update(appointments)
    .set({ reminderSent: true, reminderSentAt: new Date(), updatedAt: new Date() })
    .where(eq(appointments.id, appointmentId));
}

// ==================== RECURRING APPOINTMENTS ====================

export async function createRecurringAppointmentSeries(
  parentAppointment: InsertAppointment,
  instanceDates: Date[]
): Promise<{ parent: Appointment; instances: Appointment[] }> {
  const { nanoid } = await import('nanoid');
  const seriesId = nanoid();

  const [parent] = await db.insert(appointments).values({
    ...parentAppointment,
    isRecurringInstance: false,
    isRecurring: true,
    seriesId,
  }).returning();

  const instances: Appointment[] = [];
  const durationMs = new Date(parentAppointment.endTime).getTime() - new Date(parentAppointment.startTime).getTime();

  for (const startDate of instanceDates) {
    if (startDate.getTime() === new Date(parentAppointment.startTime).getTime()) {
      continue;
    }

    const endDate = new Date(startDate.getTime() + durationMs);
    const [instance] = await db.insert(appointments).values({
      ...parentAppointment,
      startTime: startDate,
      endTime: endDate,
      recurrenceParentId: parent.id,
      recurrenceRule: null,
      isRecurringInstance: true,
      isRecurring: true,
      seriesId,
      recurrenceEndDate: parentAppointment.recurrenceEndDate || null,
    }).returning();
    instances.push(instance);
  }

  return { parent, instances };
}

export async function getRecurringSeries(parentId: number): Promise<Appointment[]> {
  const [parent] = await db.select().from(appointments).where(eq(appointments.id, parentId));
  if (!parent) return [];

  const instances = await db
    .select()
    .from(appointments)
    .where(eq(appointments.recurrenceParentId, parentId))
    .orderBy(appointments.startTime);

  return [parent, ...instances];
}

export async function deleteRecurringSeries(parentId: number, includeCompleted: boolean = false): Promise<number> {
  let deletedCount = 0;

  if (includeCompleted) {
    const result = await db
      .delete(appointments)
      .where(eq(appointments.recurrenceParentId, parentId))
      .returning();
    deletedCount += result.length;
  } else {
    const result = await db
      .delete(appointments)
      .where(and(
        eq(appointments.recurrenceParentId, parentId),
        ne(appointments.status, 'completed')
      ))
      .returning();
    deletedCount += result.length;
  }

  const [parent] = await db.select().from(appointments).where(eq(appointments.id, parentId));
  if (parent && (includeCompleted || parent.status !== 'completed')) {
    await db.delete(appointments).where(eq(appointments.id, parentId));
    deletedCount += 1;
  }

  return deletedCount;
}

export async function updateRecurringSeries(
  parentId: number,
  updates: Partial<InsertAppointment>,
  fromDate?: Date
): Promise<Appointment[]> {
  const effectiveFromDate = fromDate || new Date();
  const updatedAppointments: Appointment[] = [];

  const series = await getRecurringSeries(parentId);

  for (const apt of series) {
    if (new Date(apt.startTime) >= effectiveFromDate && apt.status === 'scheduled') {
      const [updated] = await db
        .update(appointments)
        .set({
          ...updates,
          updatedAt: new Date(),
          id: undefined,
          recurrenceParentId: undefined,
          recurrenceRule: undefined,
          isRecurringInstance: undefined,
          createdAt: undefined,
        })
        .where(eq(appointments.id, apt.id))
        .returning();
      updatedAppointments.push(updated);
    }
  }

  return updatedAppointments;
}

export async function cancelRecurringSeries(
  parentId: number,
  reason: string,
  notes?: string,
  cancelledBy?: string
): Promise<Appointment[]> {
  const now = new Date();
  const cancelledAppointments: Appointment[] = [];

  const series = await getRecurringSeries(parentId);

  for (const apt of series) {
    if (new Date(apt.startTime) >= now && apt.status === 'scheduled') {
      const [cancelled] = await db
        .update(appointments)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: cancelledBy || null,
          cancellationReason: reason,
          cancellationNotes: notes || null,
          updatedAt: new Date(),
        })
        .where(eq(appointments.id, apt.id))
        .returning();
      cancelledAppointments.push(cancelled);
    }
  }

  return cancelledAppointments;
}

export async function getRecurrenceParent(appointmentId: number): Promise<Appointment | undefined> {
  const [apt] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
  if (!apt || !apt.recurrenceParentId) return undefined;

  const [parent] = await db.select().from(appointments).where(eq(appointments.id, apt.recurrenceParentId));
  return parent;
}

export async function getAppointmentsBySeriesId(seriesId: string): Promise<Appointment[]> {
  return db
    .select()
    .from(appointments)
    .where(eq(appointments.seriesId, seriesId))
    .orderBy(appointments.startTime);
}

export async function updateSeriesBySeriesId(
  seriesId: string,
  updates: Partial<InsertAppointment>,
  fromDate?: Date
): Promise<Appointment[]> {
  const effectiveFromDate = fromDate || new Date();
  const series = await getAppointmentsBySeriesId(seriesId);
  const updatedAppointments: Appointment[] = [];

  for (const apt of series) {
    if (new Date(apt.startTime) >= effectiveFromDate && apt.status === 'scheduled') {
      const [updated] = await db
        .update(appointments)
        .set({
          ...updates,
          updatedAt: new Date(),
          id: undefined,
          recurrenceParentId: undefined,
          recurrenceRule: undefined,
          isRecurringInstance: undefined,
          seriesId: undefined,
          createdAt: undefined,
        })
        .where(eq(appointments.id, apt.id))
        .returning();
      updatedAppointments.push(updated);
    }
  }

  return updatedAppointments;
}

export async function deleteSeriesBySeriesId(seriesId: string, includeCompleted: boolean = false): Promise<number> {
  if (includeCompleted) {
    const result = await db
      .delete(appointments)
      .where(eq(appointments.seriesId, seriesId))
      .returning();
    return result.length;
  }

  const result = await db
    .delete(appointments)
    .where(and(
      eq(appointments.seriesId, seriesId),
      ne(appointments.status, 'completed')
    ))
    .returning();
  return result.length;
}

export async function cancelSeriesBySeriesId(
  seriesId: string,
  reason: string,
  notes?: string,
  cancelledBy?: string
): Promise<Appointment[]> {
  const now = new Date();
  const series = await getAppointmentsBySeriesId(seriesId);
  const cancelledAppointments: Appointment[] = [];

  for (const apt of series) {
    if (new Date(apt.startTime) >= now && apt.status === 'scheduled') {
      const [cancelled] = await db
        .update(appointments)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: cancelledBy || null,
          cancellationReason: reason,
          cancellationNotes: notes || null,
          updatedAt: new Date(),
        })
        .where(eq(appointments.id, apt.id))
        .returning();
      cancelledAppointments.push(cancelled);
    }
  }

  return cancelledAppointments;
}

// ==================== WAITLIST MANAGEMENT ====================

export async function createWaitlistEntry(entry: InsertWaitlistEntry): Promise<WaitlistEntry> {
  const [result] = await db.insert(waitlist).values(entry).returning();
  return result;
}

export async function getWaitlist(practiceId: number, filters?: {
  status?: string;
  therapistId?: string;
  patientId?: number;
  priority?: number;
}): Promise<WaitlistEntry[]> {
  const conditions: any[] = [eq(waitlist.practiceId, practiceId)];

  if (filters?.status) conditions.push(eq(waitlist.status, filters.status));
  if (filters?.therapistId) conditions.push(eq(waitlist.therapistId, filters.therapistId));
  if (filters?.patientId) conditions.push(eq(waitlist.patientId, filters.patientId));
  if (filters?.priority) conditions.push(eq(waitlist.priority, filters.priority));

  return await db
    .select()
    .from(waitlist)
    .where(and(...conditions))
    .orderBy(desc(waitlist.priority), waitlist.createdAt);
}

export async function getWaitlistEntry(id: number): Promise<WaitlistEntry | undefined> {
  const [result] = await db.select().from(waitlist).where(eq(waitlist.id, id));
  return result;
}

export async function updateWaitlistEntry(id: number, updates: Partial<InsertWaitlistEntry>): Promise<WaitlistEntry> {
  const [result] = await db
    .update(waitlist)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(waitlist.id, id))
    .returning();
  return result;
}

export async function deleteWaitlistEntry(id: number): Promise<void> {
  await db.delete(waitlist).where(eq(waitlist.id, id));
}

export async function getWaitlistForSlot(
  practiceId: number,
  therapistId: string | null,
  slotDate: Date,
  slotTimeStart: string
): Promise<WaitlistEntry[]> {
  const dayOfWeek = slotDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

  const entries = await db
    .select()
    .from(waitlist)
    .where(and(
      eq(waitlist.practiceId, practiceId),
      eq(waitlist.status, 'waiting')
    ))
    .orderBy(desc(waitlist.priority), waitlist.createdAt);

  return entries.filter((entry: WaitlistEntry) => {
    if (entry.therapistId && therapistId && entry.therapistId !== therapistId) return false;

    const preferredDays = entry.preferredDays as string[] | null;
    if (preferredDays && preferredDays.length > 0) {
      if (!preferredDays.includes(dayOfWeek)) return false;
    }

    if (entry.preferredTimeStart && entry.preferredTimeEnd) {
      if (slotTimeStart < entry.preferredTimeStart || slotTimeStart > entry.preferredTimeEnd) return false;
    }

    if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) return false;

    return true;
  });
}

export async function markWaitlistNotified(id: number, slot: { date: string; time: string; therapistId?: string }): Promise<WaitlistEntry> {
  const [result] = await db
    .update(waitlist)
    .set({
      status: 'notified',
      notifiedAt: new Date(),
      notifiedSlot: slot,
      updatedAt: new Date(),
    })
    .where(eq(waitlist.id, id))
    .returning();
  return result;
}

export async function markWaitlistScheduled(id: number, appointmentId: number): Promise<WaitlistEntry> {
  const [result] = await db
    .update(waitlist)
    .set({
      status: 'scheduled',
      scheduledAppointmentId: appointmentId,
      updatedAt: new Date(),
    })
    .where(eq(waitlist.id, id))
    .returning();
  return result;
}

export async function getWaitlistStats(practiceId: number): Promise<{
  totalWaiting: number;
  notified: number;
  scheduled: number;
  expired: number;
  highPriority: number;
  averageWaitDays: number;
}> {
  const entries = await db
    .select()
    .from(waitlist)
    .where(eq(waitlist.practiceId, practiceId));

  const now = new Date();
  let totalWaitMs = 0;
  let waitingCount = 0;

  const stats = entries.reduce((acc: { totalWaiting: number; notified: number; scheduled: number; expired: number; highPriority: number }, entry: WaitlistEntry) => {
    if (entry.status === 'waiting') {
      acc.totalWaiting++;
      if (entry.priority && entry.priority >= 2) acc.highPriority++;
      if (entry.createdAt) {
        totalWaitMs += now.getTime() - new Date(entry.createdAt).getTime();
        waitingCount++;
      }
    } else if (entry.status === 'notified') {
      acc.notified++;
    } else if (entry.status === 'scheduled') {
      acc.scheduled++;
    } else if (entry.status === 'expired') {
      acc.expired++;
    }
    return acc;
  }, { totalWaiting: 0, notified: 0, scheduled: 0, expired: 0, highPriority: 0 });

  const averageWaitDays = waitingCount > 0
    ? Math.round((totalWaitMs / waitingCount) / (1000 * 60 * 60 * 24))
    : 0;

  return { ...stats, averageWaitDays };
}

export async function expireOldWaitlistEntries(practiceId: number): Promise<number> {
  const now = new Date();
  const result = await db
    .update(waitlist)
    .set({ status: 'expired', updatedAt: now })
    .where(and(
      eq(waitlist.practiceId, practiceId),
      eq(waitlist.status, 'waiting'),
      lt(waitlist.expiresAt, now)
    ))
    .returning();
  return result.length;
}

// ==================== REVIEW MANAGEMENT ====================

export async function createReviewRequest(request: InsertReviewRequest): Promise<ReviewRequest> {
  const [result] = await db.insert(reviewRequests).values(request).returning();
  return result;
}

export async function getReviewRequests(practiceId: number, filters?: {
  status?: string;
  patientId?: number;
  startDate?: Date;
  endDate?: Date;
}): Promise<ReviewRequest[]> {
  const conditions: any[] = [eq(reviewRequests.practiceId, practiceId)];

  if (filters?.status) conditions.push(eq(reviewRequests.status, filters.status));
  if (filters?.patientId) conditions.push(eq(reviewRequests.patientId, filters.patientId));
  if (filters?.startDate) conditions.push(gte(reviewRequests.createdAt, filters.startDate));
  if (filters?.endDate) conditions.push(lte(reviewRequests.createdAt, filters.endDate));

  return await db
    .select()
    .from(reviewRequests)
    .where(and(...conditions))
    .orderBy(desc(reviewRequests.createdAt));
}

export async function getReviewRequest(id: number): Promise<ReviewRequest | undefined> {
  const [result] = await db.select().from(reviewRequests).where(eq(reviewRequests.id, id));
  return result;
}

export async function updateReviewRequest(id: number, updates: Partial<InsertReviewRequest>): Promise<ReviewRequest> {
  const [result] = await db
    .update(reviewRequests)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(reviewRequests.id, id))
    .returning();
  return result;
}

export async function getReviewRequestStats(practiceId: number): Promise<{
  totalSent: number;
  pending: number;
  clicked: number;
  reviewed: number;
  declined: number;
  clickRate: number;
  reviewRate: number;
}> {
  const requests = await db
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.practiceId, practiceId));

  const stats = requests.reduce((acc: { totalSent: number; pending: number; clicked: number; reviewed: number; declined: number }, req: ReviewRequest) => {
    if (req.status === 'sent') acc.totalSent++;
    if (req.status === 'pending') acc.pending++;
    if (req.status === 'clicked') acc.clicked++;
    if (req.status === 'reviewed') acc.reviewed++;
    if (req.status === 'declined') acc.declined++;
    return acc;
  }, { totalSent: 0, pending: 0, clicked: 0, reviewed: 0, declined: 0 });

  const sentCount = stats.totalSent + stats.clicked + stats.reviewed;
  const clickRate = sentCount > 0 ? Math.round((stats.clicked + stats.reviewed) / sentCount * 100) : 0;
  const reviewRate = sentCount > 0 ? Math.round(stats.reviewed / sentCount * 100) : 0;

  return { ...stats, clickRate, reviewRate };
}

export async function getPatientsEligibleForReview(practiceId: number, daysSinceAppointment: number = 1): Promise<{
  patientId: number;
  appointmentId: number;
  appointmentDate: Date;
}[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysSinceAppointment);
  const cutoffEnd = new Date(cutoffDate);
  cutoffEnd.setDate(cutoffEnd.getDate() - 1);

  const eligibleAppointments = await db
    .select({
      patientId: appointments.patientId,
      appointmentId: appointments.id,
      appointmentDate: appointments.startTime,
    })
    .from(appointments)
    .leftJoin(reviewRequests, eq(appointments.id, reviewRequests.appointmentId))
    .where(and(
      eq(appointments.practiceId, practiceId),
      eq(appointments.status, 'completed'),
      lte(appointments.startTime, cutoffDate),
      gte(appointments.startTime, cutoffEnd),
      isNull(reviewRequests.id)
    ));

  return eligibleAppointments.filter((a: { patientId: number | null; appointmentId: number; appointmentDate: Date }) => a.patientId !== null) as {
    patientId: number;
    appointmentId: number;
    appointmentDate: Date;
  }[];
}

export async function createGoogleReview(review: InsertGoogleReview): Promise<GoogleReview> {
  const [result] = await db.insert(googleReviews).values(review).returning();
  return result;
}

export async function getGoogleReviews(practiceId: number, filters?: {
  responseStatus?: string;
  sentiment?: string;
  minRating?: number;
  maxRating?: number;
}): Promise<GoogleReview[]> {
  const conditions: any[] = [eq(googleReviews.practiceId, practiceId)];

  if (filters?.responseStatus) conditions.push(eq(googleReviews.responseStatus, filters.responseStatus));
  if (filters?.sentiment) conditions.push(eq(googleReviews.sentiment, filters.sentiment));
  if (filters?.minRating) conditions.push(gte(googleReviews.rating, filters.minRating));
  if (filters?.maxRating) conditions.push(lte(googleReviews.rating, filters.maxRating));

  return await db
    .select()
    .from(googleReviews)
    .where(and(...conditions))
    .orderBy(desc(googleReviews.reviewDate));
}

export async function getGoogleReview(id: number): Promise<GoogleReview | undefined> {
  const [result] = await db.select().from(googleReviews).where(eq(googleReviews.id, id));
  return result;
}

export async function updateGoogleReview(id: number, updates: Partial<InsertGoogleReview>): Promise<GoogleReview> {
  const [result] = await db
    .update(googleReviews)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(googleReviews.id, id))
    .returning();
  return result;
}

export async function getReviewStats(practiceId: number): Promise<{
  totalReviews: number;
  averageRating: number;
  pendingResponses: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  ratingDistribution: Record<number, number>;
}> {
  const reviews = await db
    .select()
    .from(googleReviews)
    .where(eq(googleReviews.practiceId, practiceId));

  const stats = {
    totalReviews: reviews.length,
    averageRating: 0,
    pendingResponses: 0,
    positiveCount: 0,
    neutralCount: 0,
    negativeCount: 0,
    ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<number, number>,
  };

  if (reviews.length === 0) return stats;

  let totalRating = 0;
  for (const review of reviews) {
    if (review.rating) {
      totalRating += review.rating;
      stats.ratingDistribution[review.rating] = (stats.ratingDistribution[review.rating] || 0) + 1;
    }
    if (review.responseStatus === 'pending') stats.pendingResponses++;
    if (review.sentiment === 'positive') stats.positiveCount++;
    if (review.sentiment === 'neutral') stats.neutralCount++;
    if (review.sentiment === 'negative') stats.negativeCount++;
  }

  stats.averageRating = Math.round((totalRating / reviews.length) * 10) / 10;
  return stats;
}

export async function createPatientFeedback(feedback: InsertPatientFeedback): Promise<PatientFeedback> {
  const [result] = await db.insert(patientFeedback).values(feedback).returning();
  return result;
}

export async function getPatientFeedback(practiceId: number, filters?: {
  sentiment?: string;
  isAddressed?: boolean;
  googlePostRequested?: boolean;
  startDate?: Date;
  endDate?: Date;
}): Promise<PatientFeedback[]> {
  const conditions: any[] = [eq(patientFeedback.practiceId, practiceId)];

  if (filters?.sentiment) conditions.push(eq(patientFeedback.sentiment, filters.sentiment));
  if (filters?.isAddressed !== undefined) conditions.push(eq(patientFeedback.isAddressed, filters.isAddressed));
  if (filters?.googlePostRequested !== undefined) conditions.push(eq(patientFeedback.googlePostRequested, filters.googlePostRequested));
  if (filters?.startDate) conditions.push(gte(patientFeedback.createdAt, filters.startDate));
  if (filters?.endDate) conditions.push(lte(patientFeedback.createdAt, filters.endDate));

  return await db
    .select()
    .from(patientFeedback)
    .where(and(...conditions))
    .orderBy(desc(patientFeedback.createdAt));
}

export async function getPatientFeedbackById(id: number): Promise<PatientFeedback | undefined> {
  const [result] = await db.select().from(patientFeedback).where(eq(patientFeedback.id, id));
  return result;
}

export async function getPatientFeedbackByReviewRequest(reviewRequestId: number): Promise<PatientFeedback | undefined> {
  const [result] = await db
    .select()
    .from(patientFeedback)
    .where(eq(patientFeedback.reviewRequestId, reviewRequestId));
  return result;
}

export async function updatePatientFeedback(id: number, updates: Partial<InsertPatientFeedback>): Promise<PatientFeedback> {
  const [result] = await db
    .update(patientFeedback)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(patientFeedback.id, id))
    .returning();
  return result;
}

export async function getPatientFeedbackStats(practiceId: number): Promise<{
  totalFeedback: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  unaddressedNegative: number;
  googlePostsPending: number;
  googlePostsCompleted: number;
  averageRating: number;
}> {
  const feedbackList = await db
    .select()
    .from(patientFeedback)
    .where(eq(patientFeedback.practiceId, practiceId));

  const stats = {
    totalFeedback: feedbackList.length,
    positiveCount: 0,
    neutralCount: 0,
    negativeCount: 0,
    unaddressedNegative: 0,
    googlePostsPending: 0,
    googlePostsCompleted: 0,
    averageRating: 0,
  };

  if (feedbackList.length === 0) return stats;

  let totalRating = 0;
  for (const feedback of feedbackList) {
    totalRating += feedback.rating;
    if (feedback.sentiment === 'positive') stats.positiveCount++;
    if (feedback.sentiment === 'neutral') stats.neutralCount++;
    if (feedback.sentiment === 'negative') {
      stats.negativeCount++;
      if (!feedback.isAddressed) stats.unaddressedNegative++;
    }
    if (feedback.googlePostRequested && !feedback.postedToGoogle) stats.googlePostsPending++;
    if (feedback.postedToGoogle) stats.googlePostsCompleted++;
  }

  stats.averageRating = Math.round((totalRating / feedbackList.length) * 10) / 10;
  return stats;
}

export async function getReviewRequestByToken(token: string): Promise<ReviewRequest | undefined> {
  const [result] = await db
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.feedbackToken, token));
  return result;
}

// ==================== ONLINE BOOKING ====================

export async function createAppointmentType(type: InsertAppointmentType): Promise<AppointmentType> {
  const [result] = await db.insert(appointmentTypes).values(type).returning();
  return result;
}

export async function getAppointmentTypes(practiceId: number, activeOnly: boolean = false): Promise<AppointmentType[]> {
  const conditions: any[] = [eq(appointmentTypes.practiceId, practiceId)];
  if (activeOnly) conditions.push(eq(appointmentTypes.isActive, true));
  return await db.select().from(appointmentTypes).where(and(...conditions));
}

export async function getAppointmentType(id: number): Promise<AppointmentType | undefined> {
  const [result] = await db.select().from(appointmentTypes).where(eq(appointmentTypes.id, id));
  return result;
}

export async function updateAppointmentType(id: number, updates: Partial<InsertAppointmentType>): Promise<AppointmentType> {
  const [result] = await db
    .update(appointmentTypes)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(appointmentTypes.id, id))
    .returning();
  return result;
}

export async function deleteAppointmentType(id: number): Promise<void> {
  await db.delete(appointmentTypes).where(eq(appointmentTypes.id, id));
}

export async function setTherapistAvailability(availability: InsertTherapistAvailability): Promise<TherapistAvailability> {
  const existing = await db
    .select()
    .from(therapistAvailability)
    .where(and(
      eq(therapistAvailability.therapistId, availability.therapistId),
      eq(therapistAvailability.dayOfWeek, availability.dayOfWeek)
    ));

  if (existing.length > 0) {
    const [result] = await db
      .update(therapistAvailability)
      .set({ ...availability, updatedAt: new Date() })
      .where(eq(therapistAvailability.id, existing[0].id))
      .returning();
    return result;
  }

  const [result] = await db.insert(therapistAvailability).values(availability).returning();
  return result;
}

export async function getTherapistAvailability(therapistId: string): Promise<TherapistAvailability[]> {
  return await db
    .select()
    .from(therapistAvailability)
    .where(eq(therapistAvailability.therapistId, therapistId))
    .orderBy(therapistAvailability.dayOfWeek);
}

export async function getPracticeAvailability(practiceId: number): Promise<TherapistAvailability[]> {
  return await db
    .select()
    .from(therapistAvailability)
    .where(eq(therapistAvailability.practiceId, practiceId))
    .orderBy(therapistAvailability.therapistId, therapistAvailability.dayOfWeek);
}

export async function deleteTherapistAvailability(id: number): Promise<void> {
  await db.delete(therapistAvailability).where(eq(therapistAvailability.id, id));
}

export async function addTherapistTimeOff(timeOff: InsertTherapistTimeOff): Promise<TherapistTimeOff> {
  const [result] = await db.insert(therapistTimeOff).values(timeOff).returning();
  return result;
}

export async function getTherapistTimeOff(therapistId: string, startDate?: Date, endDate?: Date): Promise<TherapistTimeOff[]> {
  const conditions: any[] = [eq(therapistTimeOff.therapistId, therapistId)];
  if (startDate) conditions.push(gte(therapistTimeOff.endDate, startDate.toISOString().split('T')[0]));
  if (endDate) conditions.push(lte(therapistTimeOff.startDate, endDate.toISOString().split('T')[0]));
  return await db.select().from(therapistTimeOff).where(and(...conditions));
}

export async function deleteTherapistTimeOff(id: number): Promise<void> {
  await db.delete(therapistTimeOff).where(eq(therapistTimeOff.id, id));
}

export async function getBookingSettings(practiceId: number): Promise<BookingSettings | undefined> {
  const [result] = await db
    .select()
    .from(bookingSettings)
    .where(eq(bookingSettings.practiceId, practiceId));
  return result;
}

export async function getBookingSettingsBySlug(slug: string): Promise<BookingSettings | undefined> {
  const [result] = await db
    .select()
    .from(bookingSettings)
    .where(eq(bookingSettings.bookingPageSlug, slug));
  return result;
}

export async function upsertBookingSettings(settings: InsertBookingSettings): Promise<BookingSettings> {
  const existing = await getBookingSettings(settings.practiceId);
  if (existing) {
    const [result] = await db
      .update(bookingSettings)
      .set({ ...settings, updatedAt: new Date() })
      .where(eq(bookingSettings.id, existing.id))
      .returning();
    return result;
  }
  const [result] = await db.insert(bookingSettings).values(settings).returning();
  return result;
}

export async function createOnlineBooking(booking: InsertOnlineBooking): Promise<OnlineBooking> {
  const confirmationCode = `BK${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const [result] = await db
    .insert(onlineBookings)
    .values({ ...booking, confirmationCode })
    .returning();
  return result;
}

export async function getOnlineBookings(practiceId: number, filters?: {
  status?: string;
  therapistId?: string;
  startDate?: Date;
  endDate?: Date;
}): Promise<OnlineBooking[]> {
  const conditions: any[] = [eq(onlineBookings.practiceId, practiceId)];
  if (filters?.status) conditions.push(eq(onlineBookings.status, filters.status));
  if (filters?.therapistId) conditions.push(eq(onlineBookings.therapistId, filters.therapistId));
  if (filters?.startDate) conditions.push(gte(onlineBookings.requestedDate, filters.startDate.toISOString().split('T')[0]));
  if (filters?.endDate) conditions.push(lte(onlineBookings.requestedDate, filters.endDate.toISOString().split('T')[0]));
  return await db
    .select()
    .from(onlineBookings)
    .where(and(...conditions))
    .orderBy(desc(onlineBookings.createdAt));
}

export async function getOnlineBooking(id: number): Promise<OnlineBooking | undefined> {
  const [result] = await db.select().from(onlineBookings).where(eq(onlineBookings.id, id));
  return result;
}

export async function getOnlineBookingByCode(code: string): Promise<OnlineBooking | undefined> {
  const [result] = await db
    .select()
    .from(onlineBookings)
    .where(eq(onlineBookings.confirmationCode, code));
  return result;
}

export async function updateOnlineBooking(id: number, updates: Partial<InsertOnlineBooking>): Promise<OnlineBooking> {
  const [result] = await db
    .update(onlineBookings)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(onlineBookings.id, id))
    .returning();
  return result;
}

export async function confirmOnlineBooking(id: number, appointmentId: number): Promise<OnlineBooking> {
  const [result] = await db
    .update(onlineBookings)
    .set({
      status: 'confirmed',
      appointmentId,
      confirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(onlineBookings.id, id))
    .returning();
  return result;
}

export async function cancelOnlineBooking(id: number, reason?: string): Promise<OnlineBooking> {
  const [result] = await db
    .update(onlineBookings)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancellationReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(onlineBookings.id, id))
    .returning();
  return result;
}

export async function getAvailableSlots(
  practiceId: number,
  therapistId: string | null,
  appointmentTypeId: number,
  date: Date
): Promise<string[]> {
  const aptType = await getAppointmentType(appointmentTypeId);
  if (!aptType) return [];

  const dayOfWeek = date.getDay();

  let availabilities: TherapistAvailability[];
  if (therapistId) {
    availabilities = await db
      .select()
      .from(therapistAvailability)
      .where(and(
        eq(therapistAvailability.practiceId, practiceId),
        eq(therapistAvailability.therapistId, therapistId),
        eq(therapistAvailability.dayOfWeek, dayOfWeek),
        eq(therapistAvailability.isAvailable, true)
      ));
  } else {
    availabilities = await db
      .select()
      .from(therapistAvailability)
      .where(and(
        eq(therapistAvailability.practiceId, practiceId),
        eq(therapistAvailability.dayOfWeek, dayOfWeek),
        eq(therapistAvailability.isAvailable, true)
      ));
  }

  if (availabilities.length === 0) return [];

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const existingAppointments = await db
    .select()
    .from(appointments)
    .where(and(
      eq(appointments.practiceId, practiceId),
      gte(appointments.startTime, startOfDay),
      lte(appointments.startTime, endOfDay),
      ne(appointments.status, 'cancelled')
    ));

  const timeOffs = therapistId
    ? await getTherapistTimeOff(therapistId, date, date)
    : [];

  if (timeOffs.length > 0) return [];

  const slots: string[] = [];
  const duration = aptType.duration;
  const bufferBefore = aptType.bufferBefore || 0;
  const bufferAfter = aptType.bufferAfter || 0;

  for (const avail of availabilities) {
    const [startHour, startMin] = avail.startTime.split(':').map(Number);
    const [endHour, endMin] = avail.endTime.split(':').map(Number);

    let currentTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    while (currentTime + duration <= endTime) {
      const slotHour = Math.floor(currentTime / 60);
      const slotMin = currentTime % 60;
      const slotTime = `${slotHour.toString().padStart(2, '0')}:${slotMin.toString().padStart(2, '0')}`;

      const slotStart = new Date(date);
      slotStart.setHours(slotHour, slotMin, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + duration * 60000);

      const hasConflict = existingAppointments.some((apt: { startTime: Date; endTime: Date }) => {
        const aptStart = new Date(apt.startTime);
        const aptEnd = new Date(apt.endTime);
        return (slotStart < aptEnd && slotEnd > aptStart);
      });

      if (!hasConflict) {
        slots.push(slotTime);
      }

      currentTime += 30;
    }
  }

  return Array.from(new Set(slots)).sort();
}

// ==================== TELEHEALTH ====================

export async function createTelehealthSession(session: InsertTelehealthSession): Promise<TelehealthSession> {
  const encrypted = encryptTelehealthSessionRecord(session as any);
  const [result] = await db.insert(telehealthSessions).values(encrypted as any).returning();
  return decryptTelehealthSessionRecord(result) as TelehealthSession;
}

export async function getTelehealthSessions(practiceId: number, filters?: {
  status?: string;
  therapistId?: string;
  patientId?: number;
  startDate?: Date;
  endDate?: Date;
}): Promise<TelehealthSession[]> {
  const conditions: any[] = [eq(telehealthSessions.practiceId, practiceId)];

  if (filters?.status) conditions.push(eq(telehealthSessions.status, filters.status));
  if (filters?.therapistId) conditions.push(eq(telehealthSessions.therapistId, filters.therapistId));
  if (filters?.patientId) conditions.push(eq(telehealthSessions.patientId, filters.patientId));
  if (filters?.startDate) conditions.push(gte(telehealthSessions.scheduledStart, filters.startDate));
  if (filters?.endDate) conditions.push(lte(telehealthSessions.scheduledStart, filters.endDate));

  const rows = await db
    .select()
    .from(telehealthSessions)
    .where(and(...conditions))
    .orderBy(desc(telehealthSessions.scheduledStart));
  return rows.map((r: any) => decryptTelehealthSessionRecord(r) as TelehealthSession);
}

export async function getTelehealthSession(id: number): Promise<TelehealthSession | undefined> {
  const [result] = await db.select().from(telehealthSessions).where(eq(telehealthSessions.id, id));
  return result ? decryptTelehealthSessionRecord(result) as TelehealthSession : undefined;
}

export async function getTelehealthSessionByRoom(roomName: string): Promise<TelehealthSession | undefined> {
  const [result] = await db
    .select()
    .from(telehealthSessions)
    .where(eq(telehealthSessions.roomName, roomName));
  return result ? decryptTelehealthSessionRecord(result) as TelehealthSession : undefined;
}

export async function getTelehealthSessionByAppointment(appointmentId: number): Promise<TelehealthSession | undefined> {
  const [result] = await db
    .select()
    .from(telehealthSessions)
    .where(eq(telehealthSessions.appointmentId, appointmentId));
  return result ? decryptTelehealthSessionRecord(result) as TelehealthSession : undefined;
}

export async function getTelehealthSessionByAccessCode(code: string): Promise<TelehealthSession | undefined> {
  const [result] = await db
    .select()
    .from(telehealthSessions)
    .where(eq(telehealthSessions.patientAccessCode, code));
  return result ? decryptTelehealthSessionRecord(result) as TelehealthSession : undefined;
}

export async function updateTelehealthSession(id: number, updates: Partial<InsertTelehealthSession>): Promise<TelehealthSession> {
  const encrypted = encryptTelehealthSessionRecord(updates as any);
  const [result] = await db
    .update(telehealthSessions)
    .set({ ...encrypted, updatedAt: new Date() })
    .where(eq(telehealthSessions.id, id))
    .returning();
  return decryptTelehealthSessionRecord(result) as TelehealthSession;
}

export async function startTelehealthSession(id: number, isTherapist: boolean): Promise<TelehealthSession> {
  const session = await getTelehealthSession(id);
  if (!session) throw new Error('Session not found');

  const updates: Record<string, unknown> = {};

  if (isTherapist) {
    updates.therapistJoinedAt = new Date();
    if (session.status === 'waiting' || session.status === 'scheduled') {
      updates.status = 'in_progress';
      updates.actualStart = new Date();
    }
  } else {
    updates.patientJoinedAt = new Date();
    if (session.status === 'scheduled') {
      updates.status = 'waiting';
    }
  }

  const [result] = await db
    .update(telehealthSessions)
    .set(updates)
    .where(eq(telehealthSessions.id, id))
    .returning();
  return decryptTelehealthSessionRecord(result) as TelehealthSession;
}

export async function endTelehealthSession(id: number): Promise<TelehealthSession> {
  const session = await getTelehealthSession(id);
  if (!session) throw new Error('Session not found');

  const actualEnd = new Date();
  const actualStart = session.actualStart ? new Date(session.actualStart) : actualEnd;
  const duration = Math.round((actualEnd.getTime() - actualStart.getTime()) / 60000);

  const [result] = await db
    .update(telehealthSessions)
    .set({
      status: 'completed',
      actualEnd,
      duration,
      updatedAt: new Date(),
    })
    .where(eq(telehealthSessions.id, id))
    .returning();
  return decryptTelehealthSessionRecord(result) as TelehealthSession;
}

export async function getUpcomingTelehealthSessions(practiceId: number, hoursAhead: number = 24): Promise<TelehealthSession[]> {
  const now = new Date();
  const future = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(telehealthSessions)
    .where(and(
      eq(telehealthSessions.practiceId, practiceId),
      eq(telehealthSessions.status, 'scheduled'),
      gte(telehealthSessions.scheduledStart, now),
      lte(telehealthSessions.scheduledStart, future)
    ))
    .orderBy(telehealthSessions.scheduledStart);
  return rows.map((r: any) => decryptTelehealthSessionRecord(r) as TelehealthSession);
}

export async function getTodaysTelehealthSessions(practiceId: number, therapistId?: string): Promise<TelehealthSession[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const conditions: any[] = [
    eq(telehealthSessions.practiceId, practiceId),
    gte(telehealthSessions.scheduledStart, today),
    lt(telehealthSessions.scheduledStart, tomorrow),
  ];

  if (therapistId) {
    conditions.push(eq(telehealthSessions.therapistId, therapistId));
  }

  const rows = await db
    .select()
    .from(telehealthSessions)
    .where(and(...conditions))
    .orderBy(telehealthSessions.scheduledStart);
  return rows.map((r: any) => decryptTelehealthSessionRecord(r) as TelehealthSession);
}

export async function getTelehealthSettings(practiceId: number): Promise<TelehealthSettings | undefined> {
  const [result] = await db
    .select()
    .from(telehealthSettings)
    .where(eq(telehealthSettings.practiceId, practiceId));
  return result ? decryptTelehealthSettingsRecord(result) as TelehealthSettings : undefined;
}

export async function upsertTelehealthSettings(settings: InsertTelehealthSettings): Promise<TelehealthSettings> {
  const encrypted = encryptTelehealthSettingsRecord(settings as any);
  const existing = await getTelehealthSettings(settings.practiceId);
  if (existing) {
    const [result] = await db
      .update(telehealthSettings)
      .set({ ...encrypted, updatedAt: new Date() })
      .where(eq(telehealthSettings.id, existing.id))
      .returning();
    await cache.del(CacheKeys.telehealthSettings(settings.practiceId));
    return decryptTelehealthSettingsRecord(result) as TelehealthSettings;
  }
  const [result] = await db.insert(telehealthSettings).values(encrypted as any).returning();
  await cache.del(CacheKeys.telehealthSettings(settings.practiceId));
  return decryptTelehealthSettingsRecord(result) as TelehealthSettings;
}

export function generateTelehealthRoomName(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `session-${timestamp}-${random}`;
}

export function generatePatientAccessCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ==================== CANCELLATION ANALYTICS ====================

export async function getCancellationStats(practiceId: number, start: Date, end: Date): Promise<{
  totalScheduled: number;
  totalCancelled: number;
  totalNoShow: number;
  cancellationRate: number;
  noShowRate: number;
  lateCancellations: number;
  avgLeadTimeHours: number;
}> {
  const allAppts = await db
    .select()
    .from(appointments)
    .where(and(
      eq(appointments.practiceId, practiceId),
      gte(appointments.startTime, start),
      lte(appointments.startTime, end)
    ));

  const totalScheduled = allAppts.length;
  const cancelled = allAppts.filter((a: Appointment) => a.status === "cancelled");
  const totalCancelled = cancelled.length;
  const totalNoShow = allAppts.filter((a: Appointment) => a.status === "no_show" || a.cancellationReason === "no_show").length;

  const lateCancellations = cancelled.filter((a: Appointment) => {
    if (!a.cancelledAt || !a.startTime) return false;
    const leadMs = new Date(a.startTime).getTime() - new Date(a.cancelledAt).getTime();
    return leadMs >= 0 && leadMs < 24 * 60 * 60 * 1000;
  }).length;

  const leadTimes = cancelled
    .filter((a: Appointment) => a.cancelledAt && a.startTime)
    .map((a: Appointment) => {
      const leadMs = new Date(a.startTime).getTime() - new Date(a.cancelledAt!).getTime();
      return Math.max(0, leadMs / (1000 * 60 * 60));
    });
  const avgLeadTimeHours = leadTimes.length > 0
    ? leadTimes.reduce((s: number, v: number) => s + v, 0) / leadTimes.length
    : 0;

  return {
    totalScheduled,
    totalCancelled,
    totalNoShow,
    cancellationRate: totalScheduled > 0 ? (totalCancelled / totalScheduled) * 100 : 0,
    noShowRate: totalScheduled > 0 ? (totalNoShow / totalScheduled) * 100 : 0,
    lateCancellations,
    avgLeadTimeHours: Math.round(avgLeadTimeHours * 10) / 10,
  };
}

export async function getCancellationsByPatient(practiceId: number, start: Date, end: Date): Promise<{
  patientId: number;
  patientName: string;
  totalAppointments: number;
  cancellations: number;
  noShows: number;
  lateCancellations: number;
}[]> {
  const allAppts = await db
    .select()
    .from(appointments)
    .where(and(
      eq(appointments.practiceId, practiceId),
      gte(appointments.startTime, start),
      lte(appointments.startTime, end)
    ));

  const byPatient: Record<number, Appointment[]> = {};
  for (const a of allAppts) {
    if (!a.patientId) continue;
    if (!byPatient[a.patientId]) byPatient[a.patientId] = [];
    byPatient[a.patientId].push(a);
  }

  const results = [];
  for (const patientIdStr of Object.keys(byPatient)) {
    const patientId = Number(patientIdStr);
    const appts = byPatient[patientId];
    const patient = await getPatient(patientId);
    const cancelledList = appts.filter((a: Appointment) => a.status === "cancelled");
    const noShows = appts.filter((a: Appointment) => a.status === "no_show" || a.cancellationReason === "no_show").length;
    const lateCancellations = cancelledList.filter((a: Appointment) => {
      if (!a.cancelledAt || !a.startTime) return false;
      const leadMs = new Date(a.startTime).getTime() - new Date(a.cancelledAt).getTime();
      return leadMs >= 0 && leadMs < 24 * 60 * 60 * 1000;
    }).length;

    results.push({
      patientId,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Unknown",
      totalAppointments: appts.length,
      cancellations: cancelledList.length,
      noShows,
      lateCancellations,
    });
  }

  return results.sort((a, b) => b.cancellations - a.cancellations);
}

export async function getCancellationTrend(practiceId: number, start: Date, end: Date): Promise<{
  month: string;
  scheduled: number;
  cancelled: number;
  noShows: number;
  rate: number;
}[]> {
  const allAppts = await db
    .select()
    .from(appointments)
    .where(and(
      eq(appointments.practiceId, practiceId),
      gte(appointments.startTime, start),
      lte(appointments.startTime, end)
    ));

  const byMonth: Record<string, Appointment[]> = {};
  for (const a of allAppts) {
    const month = new Date(a.startTime).toISOString().slice(0, 7);
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(a);
  }

  const result = [];
  for (const month of Object.keys(byMonth).sort()) {
    const appts = byMonth[month];
    const scheduled = appts.length;
    const cancelled = appts.filter((a: Appointment) => a.status === "cancelled").length;
    const noShows = appts.filter((a: Appointment) => a.status === "no_show" || a.cancellationReason === "no_show").length;
    result.push({
      month,
      scheduled,
      cancelled,
      noShows,
      rate: scheduled > 0 ? Math.round((cancelled / scheduled) * 1000) / 10 : 0,
    });
  }

  return result;
}

// ==================== ELIGIBILITY ALERTS ====================

export async function createEligibilityAlert(alert: InsertEligibilityAlert): Promise<EligibilityAlert> {
  const [newAlert] = await db.insert(eligibilityAlerts).values(alert).returning();
  return newAlert;
}

export async function getEligibilityAlerts(practiceId: number, filters?: {
  status?: string;
  severity?: string;
  alertType?: string;
  patientId?: number;
  limit?: number;
}): Promise<EligibilityAlert[]> {
  const conditions: any[] = [eq(eligibilityAlerts.practiceId, practiceId)];

  if (filters?.status) conditions.push(eq(eligibilityAlerts.status, filters.status));
  if (filters?.severity) conditions.push(eq(eligibilityAlerts.severity, filters.severity));
  if (filters?.alertType) conditions.push(eq(eligibilityAlerts.alertType, filters.alertType));
  if (filters?.patientId) conditions.push(eq(eligibilityAlerts.patientId, filters.patientId));

  let query = db.select()
    .from(eligibilityAlerts)
    .where(and(...conditions))
    .orderBy(desc(eligibilityAlerts.createdAt));

  if (filters?.limit) {
    query = query.limit(filters.limit) as typeof query;
  }

  return query;
}

export async function getEligibilityAlert(id: number): Promise<EligibilityAlert | undefined> {
  const [alert] = await db.select().from(eligibilityAlerts).where(eq(eligibilityAlerts.id, id));
  return alert;
}

export async function updateEligibilityAlert(id: number, updates: Partial<InsertEligibilityAlert> & {
  status?: string;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNotes?: string;
}): Promise<EligibilityAlert | undefined> {
  const [updated] = await db.update(eligibilityAlerts)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(eligibilityAlerts.id, id))
    .returning();
  return updated;
}

export async function acknowledgeEligibilityAlert(id: number, userId: string): Promise<EligibilityAlert | undefined> {
  return updateEligibilityAlert(id, {
    status: 'acknowledged',
    acknowledgedAt: new Date(),
    acknowledgedBy: userId,
  });
}

export async function resolveEligibilityAlert(id: number, userId: string, notes?: string): Promise<EligibilityAlert | undefined> {
  return updateEligibilityAlert(id, {
    status: 'resolved',
    resolvedAt: new Date(),
    resolvedBy: userId,
    resolutionNotes: notes,
  });
}

export async function dismissEligibilityAlert(id: number, userId: string, notes?: string): Promise<EligibilityAlert | undefined> {
  return updateEligibilityAlert(id, {
    status: 'dismissed',
    resolvedAt: new Date(),
    resolvedBy: userId,
    resolutionNotes: notes,
  });
}

export async function getOpenAlertsForAppointment(appointmentId: number): Promise<EligibilityAlert[]> {
  return db.select()
    .from(eligibilityAlerts)
    .where(and(
      eq(eligibilityAlerts.appointmentId, appointmentId),
      eq(eligibilityAlerts.status, 'open')
    ));
}

export async function getEligibilityAlertStats(practiceId: number): Promise<{
  totalOpen: number;
  bySeverity: { severity: string; count: number }[];
  byType: { alertType: string; count: number }[];
  resolvedLast30Days: number;
}> {
  const [{ totalOpen }] = await db.select({ totalOpen: count() })
    .from(eligibilityAlerts)
    .where(and(
      eq(eligibilityAlerts.practiceId, practiceId),
      eq(eligibilityAlerts.status, 'open')
    ));

  const bySeverity = await db.select({
    severity: eligibilityAlerts.severity,
    count: count(),
  })
    .from(eligibilityAlerts)
    .where(and(
      eq(eligibilityAlerts.practiceId, practiceId),
      eq(eligibilityAlerts.status, 'open')
    ))
    .groupBy(eligibilityAlerts.severity);

  const byType = await db.select({
    alertType: eligibilityAlerts.alertType,
    count: count(),
  })
    .from(eligibilityAlerts)
    .where(and(
      eq(eligibilityAlerts.practiceId, practiceId),
      eq(eligibilityAlerts.status, 'open')
    ))
    .groupBy(eligibilityAlerts.alertType);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [{ resolvedLast30Days }] = await db.select({ resolvedLast30Days: count() })
    .from(eligibilityAlerts)
    .where(and(
      eq(eligibilityAlerts.practiceId, practiceId),
      eq(eligibilityAlerts.status, 'resolved'),
      gte(eligibilityAlerts.resolvedAt, thirtyDaysAgo)
    ));

  return {
    totalOpen: totalOpen || 0,
    bySeverity: bySeverity.map((s: { severity: string | null; count: number }) => ({ severity: s.severity || 'unknown', count: Number(s.count) })),
    byType: byType.map((t: { alertType: string; count: number }) => ({ alertType: t.alertType, count: Number(t.count) })),
    resolvedLast30Days: resolvedLast30Days || 0,
  };
}

export async function getAppointmentsNeedingEligibilityCheck(practiceId: number, hoursAhead: number = 24): Promise<Appointment[]> {
  const now = new Date();
  const futureDate = new Date();
  futureDate.setHours(futureDate.getHours() + hoursAhead);

  const upcomingAppointments = await db.select()
    .from(appointments)
    .where(and(
      eq(appointments.practiceId, practiceId),
      gte(appointments.startTime, now),
      lte(appointments.startTime, futureDate),
      ne(appointments.status, 'cancelled')
    ));

  const appointmentsWithInsurance: Appointment[] = [];
  for (const apt of upcomingAppointments) {
    if (apt.patientId) {
      const patient = await getPatient(apt.patientId);
      if (patient?.insuranceId) {
        appointmentsWithInsurance.push(apt);
      }
    }
  }

  return appointmentsWithInsurance;
}

export async function createEligibilityAlertsBatch(alerts: InsertEligibilityAlert[]): Promise<EligibilityAlert[]> {
  if (alerts.length === 0) return [];
  return db.insert(eligibilityAlerts).values(alerts).returning();
}

// ==================== APPOINTMENT REQUESTS ====================

export async function createAppointmentRequest(request: InsertAppointmentRequest): Promise<AppointmentRequest> {
  const [result] = await db.insert(appointmentRequests).values(request).returning();
  return result;
}

export async function getAppointmentRequest(id: number): Promise<AppointmentRequest | undefined> {
  const [result] = await db
    .select()
    .from(appointmentRequests)
    .where(eq(appointmentRequests.id, id));
  return result;
}

export async function getPatientAppointmentRequests(patientId: number, status?: string): Promise<any[]> {
  const conditions: any[] = [eq(appointmentRequests.patientId, patientId)];
  if (status) conditions.push(eq(appointmentRequests.status, status));

  const results = await db
    .select()
    .from(appointmentRequests)
    .where(and(...conditions))
    .orderBy(desc(appointmentRequests.createdAt));

  const enrichedResults = await Promise.all(results.map(async (request: AppointmentRequest) => {
    let appointmentTypeName = null;
    let therapistName = null;

    if (request.appointmentTypeId) {
      const aptType = await getAppointmentType(request.appointmentTypeId);
      appointmentTypeName = aptType?.name;
    }

    if (request.therapistId) {
      const therapist = await getUser(request.therapistId);
      if (therapist) {
        therapistName = `${therapist.firstName} ${therapist.lastName}`;
      }
    }

    return {
      ...request,
      appointmentTypeName,
      therapistName,
    };
  }));

  return enrichedResults;
}

export async function getPracticeAppointmentRequests(practiceId: number, status?: string): Promise<AppointmentRequest[]> {
  const conditions: any[] = [eq(appointmentRequests.practiceId, practiceId)];
  if (status) conditions.push(eq(appointmentRequests.status, status));

  return await db
    .select()
    .from(appointmentRequests)
    .where(and(...conditions))
    .orderBy(desc(appointmentRequests.createdAt));
}

export async function updateAppointmentRequest(id: number, updates: Partial<InsertAppointmentRequest> & { processedAt?: Date; processedById?: string; appointmentId?: number }): Promise<AppointmentRequest> {
  const [result] = await db
    .update(appointmentRequests)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(appointmentRequests.id, id))
    .returning();
  return result;
}

export async function getPendingAppointmentRequestsCount(practiceId: number): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(appointmentRequests)
    .where(and(
      eq(appointmentRequests.practiceId, practiceId),
      eq(appointmentRequests.status, 'pending_approval')
    ));
  return result[0]?.count || 0;
}
