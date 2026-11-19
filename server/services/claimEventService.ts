/**
 * Best-effort recorder for claim timeline events (claim_events).
 *
 * Every caller is a business action that must not fail because history
 * could not be written (the deny, reopen, submit and appeal routes), so a
 * storage error here is logged and swallowed, the same way the reopen route
 * already treats its audit-log write. The event types are the vocabulary
 * the claim detail's Status tab renders; add here before adding a caller.
 */
import { storage } from "../storage";
import logger from "./logger";

export type ClaimEventType =
  | "denied"
  | "reopened"
  | "submitted"
  | "appeal_created"
  | "appeal_submitted"
  | "appeal_resolved"
  | "note_added";

export interface RecordClaimEventInput {
  claimId: number;
  practiceId: number;
  eventType: ClaimEventType;
  summary: string;
  metadata?: Record<string, unknown> | null;
  createdBy?: string | null;
}

/** Longest free text an event summary or excerpt carries; the source record holds the rest. */
export const EVENT_TEXT_LIMIT = 240;

export function clip(text: unknown, limit: number = EVENT_TEXT_LIMIT): string {
  const s = String(text ?? "").trim();
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

export async function recordClaimEvent(input: RecordClaimEventInput): Promise<void> {
  try {
    const create = (storage as any).createClaimEvent;
    if (typeof create !== "function") return; // partial storage stubs in tests
    await create({
      claimId: input.claimId,
      practiceId: input.practiceId,
      eventType: input.eventType,
      summary: clip(input.summary),
      metadata: input.metadata ?? null,
      createdBy: input.createdBy ?? null,
    });
  } catch (error) {
    logger.warn("Claim event not recorded", {
      claimId: input.claimId,
      eventType: input.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
