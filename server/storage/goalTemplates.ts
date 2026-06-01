/**
 * Goal Bank storage — read the pre-written goal templates available to a
 * practice (system defaults + that practice's custom rows), optionally
 * filtered by discipline (OT/ST). Mirrors the soapInterventionTemplates merge
 * pattern.
 */

import { goalTemplates, type GoalTemplate } from "@shared/schema";
import { db } from "../db";
import { and, or, eq, isNull, asc } from "drizzle-orm";

export async function getGoalTemplates(
  practiceId: number,
  discipline?: string,
): Promise<GoalTemplate[]> {
  const where = [
    // System defaults (practiceId IS NULL) OR this practice's own rows.
    or(isNull(goalTemplates.practiceId), eq(goalTemplates.practiceId, practiceId)),
    eq(goalTemplates.isActive, true),
  ];
  if (discipline) where.push(eq(goalTemplates.discipline, discipline));

  return db
    .select()
    .from(goalTemplates)
    .where(and(...where))
    .orderBy(asc(goalTemplates.discipline), asc(goalTemplates.category), asc(goalTemplates.sortOrder));
}
