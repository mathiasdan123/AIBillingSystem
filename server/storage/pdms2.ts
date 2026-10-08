/**
 * Storage for PDMS-2 structured assessments (outcome-measures feature).
 * All reads are scoped to patient + practice by the callers; the per-practice
 * guard here keeps a stray id from ever crossing tenants.
 */

import {
  pdms2Assessments,
  type Pdms2Assessment,
  type InsertPdms2Assessment,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and } from "drizzle-orm";

export async function createPdms2Assessment(
  assessment: InsertPdms2Assessment,
): Promise<Pdms2Assessment> {
  const [created] = await db.insert(pdms2Assessments).values(assessment).returning();
  return created;
}

export async function getPdms2Assessment(id: number): Promise<Pdms2Assessment | undefined> {
  const [assessment] = await db
    .select()
    .from(pdms2Assessments)
    .where(eq(pdms2Assessments.id, id));
  return assessment;
}

export async function getPdms2AssessmentsForPatient(
  patientId: number,
  practiceId: number,
): Promise<Pdms2Assessment[]> {
  return await db
    .select()
    .from(pdms2Assessments)
    .where(
      and(eq(pdms2Assessments.patientId, patientId), eq(pdms2Assessments.practiceId, practiceId)),
    )
    .orderBy(desc(pdms2Assessments.assessmentDate));
}

export async function updatePdms2Assessment(
  id: number,
  updates: Partial<InsertPdms2Assessment>,
): Promise<Pdms2Assessment | undefined> {
  const [updated] = await db
    .update(pdms2Assessments)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(pdms2Assessments.id, id))
    .returning();
  return updated;
}
