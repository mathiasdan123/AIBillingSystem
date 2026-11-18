/**
 * Claim events — append-only history rows for the claim timeline. See the
 * table comment in shared/schema.ts. Reads are always practice-scoped;
 * writes carry the practiceId of the claim they describe.
 */
import { db } from "../db";
import { claimEvents, type ClaimEvent, type InsertClaimEvent } from "@shared/schema";
import { and, asc, eq } from "drizzle-orm";

export async function createClaimEvent(event: InsertClaimEvent): Promise<ClaimEvent> {
  const [row] = await db.insert(claimEvents).values(event).returning();
  return row;
}

/** Oldest first, so the timeline reads top-down in the order things happened. */
export async function getClaimEvents(practiceId: number, claimId: number): Promise<ClaimEvent[]> {
  return db
    .select()
    .from(claimEvents)
    .where(and(eq(claimEvents.practiceId, practiceId), eq(claimEvents.claimId, claimId)))
    .orderBy(asc(claimEvents.createdAt), asc(claimEvents.id));
}
