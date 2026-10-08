/**
 * Progress Notes storage (Wonder Kids pilot — Megan).
 *
 * The progress_notes rows plus the read-side queries the cadence computation
 * and AI grounding need (completed-session counts, signed SOAP notes in a
 * window). Every note read takes the caller's practiceId so cross-tenant ids
 * simply return undefined/[] (fail closed) — same pattern as
 * initial_evaluations in ./clinical.
 */

import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import {
  progressNotes,
  soapNotes,
  treatmentSessions,
  type InsertProgressNote,
  type ProgressNote,
  type SoapNote,
} from "@shared/schema";
import { db } from "../db";
import { decryptSoapNoteRecord } from "../services/phiEncryptionService";

// Guard against accidental overwrite of identity/scoping columns on update.
function stripImmutable<T extends Record<string, any>>(updates: T): T {
  const { id, practiceId, patientId, createdAt, ...rest } = updates as any;
  return rest;
}

export async function createProgressNote(note: InsertProgressNote): Promise<ProgressNote> {
  const [created] = await db.insert(progressNotes).values(note).returning();
  return created;
}

export async function getProgressNote(id: number, practiceId: number): Promise<ProgressNote | undefined> {
  const [row] = await db
    .select()
    .from(progressNotes)
    .where(and(eq(progressNotes.id, id), eq(progressNotes.practiceId, practiceId)));
  return row;
}

export async function getProgressNotesForPatient(patientId: number, practiceId: number): Promise<ProgressNote[]> {
  return await db
    .select()
    .from(progressNotes)
    .where(and(eq(progressNotes.patientId, patientId), eq(progressNotes.practiceId, practiceId)))
    .orderBy(desc(progressNotes.createdAt));
}

export async function updateProgressNote(
  id: number,
  practiceId: number,
  updates: Partial<InsertProgressNote>,
): Promise<ProgressNote | undefined> {
  const [updated] = await db
    .update(progressNotes)
    .set({ ...stripImmutable(updates), updatedAt: new Date() })
    .where(and(eq(progressNotes.id, id), eq(progressNotes.practiceId, practiceId)))
    .returning();
  return updated;
}

/** Most recent FINALIZED progress note — the cadence anchor candidate. */
export async function getLastFinalizedProgressNote(
  patientId: number,
  practiceId: number,
): Promise<ProgressNote | undefined> {
  const [row] = await db
    .select()
    .from(progressNotes)
    .where(
      and(
        eq(progressNotes.patientId, patientId),
        eq(progressNotes.practiceId, practiceId),
        eq(progressNotes.status, "finalized"),
      ),
    )
    .orderBy(desc(progressNotes.finalizedAt))
    .limit(1);
  return row;
}

/**
 * Count completed treatment sessions on/after `since` (all completed sessions
 * when `since` is null). Feeds the "due every 10 sessions" half of the
 * cadence rule.
 */
export async function countCompletedSessionsSince(
  patientId: number,
  practiceId: number,
  since: string | null,
): Promise<number> {
  const where = [
    eq(treatmentSessions.patientId, patientId),
    eq(treatmentSessions.practiceId, practiceId),
    eq(treatmentSessions.status, "completed"),
  ];
  if (since) where.push(gte(treatmentSessions.sessionDate, since));
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(treatmentSessions)
    .where(and(...where));
  return row?.count ?? 0;
}

/** Earliest completed session date — the cadence anchor of last resort when
 * there is no plan start date and no finalized progress note yet. */
export async function getFirstCompletedSessionDate(
  patientId: number,
  practiceId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ sessionDate: treatmentSessions.sessionDate })
    .from(treatmentSessions)
    .where(
      and(
        eq(treatmentSessions.patientId, patientId),
        eq(treatmentSessions.practiceId, practiceId),
        eq(treatmentSessions.status, "completed"),
      ),
    )
    .orderBy(treatmentSessions.sessionDate)
    .limit(1);
  return row?.sessionDate ?? null;
}

/**
 * SIGNED SOAP notes whose session falls inside [from, to] (inclusive,
 * YYYY-MM-DD), oldest first — the documented sessions the AI draft is
 * grounded in. Unsigned notes are excluded by design: only signed
 * documentation grounds a progress note.
 */
export async function getSignedSoapNotesInRange(
  patientId: number,
  practiceId: number,
  from: string,
  to: string,
): Promise<Array<SoapNote & { sessionDate: string }>> {
  const rows = await db
    .select({
      id: soapNotes.id,
      sessionId: soapNotes.sessionId,
      subjective: soapNotes.subjective,
      objective: soapNotes.objective,
      assessment: soapNotes.assessment,
      plan: soapNotes.plan,
      interventions: soapNotes.interventions,
      progressNotes: soapNotes.progressNotes,
      therapistId: soapNotes.therapistId,
      therapistSignedAt: soapNotes.therapistSignedAt,
      createdAt: soapNotes.createdAt,
      sessionDate: treatmentSessions.sessionDate,
    })
    .from(soapNotes)
    .innerJoin(treatmentSessions, eq(soapNotes.sessionId, treatmentSessions.id))
    .where(
      and(
        eq(treatmentSessions.patientId, patientId),
        eq(treatmentSessions.practiceId, practiceId),
        isNotNull(soapNotes.therapistSignedAt),
        gte(treatmentSessions.sessionDate, from),
        lte(treatmentSessions.sessionDate, to),
      ),
    )
    .orderBy(treatmentSessions.sessionDate, soapNotes.createdAt)
    .limit(60); // defensive bound — far beyond a 10-session/90-day window
  return rows.map((r: any) => decryptSoapNoteRecord(r) as SoapNote & { sessionDate: string });
}
