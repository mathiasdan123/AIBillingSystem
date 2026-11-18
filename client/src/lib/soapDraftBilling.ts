/**
 * Round-trips the suggested-billing half of a generated SOAP note through the
 * server-side draft (soap_note_drafts.billing, jsonb).
 *
 * The draft used to carry only the four prose sections; on restore the page
 * reset cptCodes/timeBlocks/rationale/total to empty, so a therapist who
 * generated a note with 97110 x3 ($300), went to Claims and came back saw
 * the text restored but "$0 / 0 units" (QA sweep 2026-11-18). Everything the
 * review UI renders about billing is serialised here, in one place, so the
 * save and restore sides cannot drift apart.
 */
import type { ActivityCptPairing } from "@shared/activityCpt";

export interface DraftCptCode {
  code: string;
  name: string;
  units: number;
  rationale: string;
  reimbursement: number;
  activitiesAssigned?: string[];
}

export interface DraftTimeBlock {
  blockNumber: number;
  startMinute: number;
  endMinute: number;
  code: string;
  codeName: string;
  rate: number;
  activities: string[];
}

/** The billing fields of the page's generatedNote state. */
export interface GeneratedNoteBilling {
  cptCodes: DraftCptCode[];
  activityCptPairings?: ActivityCptPairing[];
  timeBlocks?: DraftTimeBlock[];
  billingRationale?: string;
  auditNotes?: string[];
  totalReimbursement?: number;
  generationMode?: "ai" | "fallback";
}

/** What is stored in soap_note_drafts.billing. Versioned for later reshapes. */
export interface SoapDraftBilling {
  v: 1;
  cptCodes: DraftCptCode[];
  activityCptPairings: ActivityCptPairing[];
  timeBlocks: DraftTimeBlock[];
  billingRationale: string;
  auditNotes: string[];
  totalReimbursement: number;
  generationMode: "ai" | "fallback";
}

export function toDraftBilling(note: GeneratedNoteBilling): SoapDraftBilling {
  return {
    v: 1,
    cptCodes: note.cptCodes ?? [],
    activityCptPairings: note.activityCptPairings ?? [],
    timeBlocks: note.timeBlocks ?? [],
    billingRationale: note.billingRationale ?? "",
    auditNotes: note.auditNotes ?? [],
    totalReimbursement: Number(note.totalReimbursement) || 0,
    generationMode: note.generationMode === "fallback" ? "fallback" : "ai",
  };
}

/** Empty billing — what a restored draft gets when nothing was saved. */
export function emptyDraftBilling(): GeneratedNoteBilling {
  return {
    cptCodes: [],
    activityCptPairings: [],
    timeBlocks: [],
    billingRationale: "",
    auditNotes: [],
    totalReimbursement: 0,
  };
}

/**
 * Defensive inverse of toDraftBilling: the column is untyped JSON written by
 * older clients (or nothing at all), so every field is checked rather than
 * trusted. Unknown or malformed input yields empty billing, never a throw.
 */
export function fromDraftBilling(raw: unknown): GeneratedNoteBilling {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyDraftBilling();
  const b = raw as Record<string, unknown>;
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const cptCodes = arr<DraftCptCode>(b.cptCodes).filter(
    (c) => c && typeof c === "object" && typeof (c as any).code === "string",
  );
  const total = Number(b.totalReimbursement);
  return {
    cptCodes,
    activityCptPairings: arr<ActivityCptPairing>(b.activityCptPairings),
    timeBlocks: arr<DraftTimeBlock>(b.timeBlocks),
    billingRationale: typeof b.billingRationale === "string" ? b.billingRationale : "",
    auditNotes: arr<unknown>(b.auditNotes).filter((n): n is string => typeof n === "string"),
    totalReimbursement: Number.isFinite(total) ? total : 0,
    generationMode: b.generationMode === "fallback" ? "fallback" : b.generationMode === "ai" ? "ai" : undefined,
  };
}
