/**
 * Structured-rating handoff for SOAP generation.
 *
 * Post-deploy retest of #464 (2026-11-18, Riley Nodob): "Minimal Assist" was
 * selected via "Apply to All" and per exercise, yet neither the fallback nor
 * the AI note carried it and the AI Audit Support said assistance was not
 * assessed. The value was lost at two points:
 *
 *   1. The client's "Apply to All" and per-exercise selectors write ONLY the
 *      per-exercise `activityAssessments[].assessment`; the request's global
 *      `assessment` object is a separate form section the therapist never
 *      touched, so it arrived blank.
 *   2. POST /api/ai/generate-soap-billing mapped each activity to
 *      `{ name, response }` and dropped every per-exercise rating on the
 *      floor, so nothing downstream could have recovered it.
 *
 * These helpers close both gaps on the server: per-exercise ratings ride
 * along as `activityDetails[].{assistance,...}`, and a blank global field is
 * derived from the per-exercise values when every rated exercise agrees.
 */

/** Per-activity ratings the client captures (OT and ST dimensions). */
export const ACTIVITY_RATING_FIELDS = [
  'performance',
  'assistance',
  'strength',
  'motorPlanning',
  'sensoryRegulation',
  'cueingLevel',
  'accuracy',
  'stimulability',
  'carryover',
] as const;
export type ActivityRatingField = (typeof ACTIVITY_RATING_FIELDS)[number];

/** The global assessment fields that have a per-activity counterpart. */
export const DERIVABLE_GLOBAL_FIELDS = [
  'performance',
  'assistance',
  'strength',
  'motorPlanning',
  'sensoryRegulation',
] as const;

export interface ActivityDetailInput {
  name: string;
  response?: string;
  performance?: string;
  assistance?: string;
  strength?: string;
  motorPlanning?: string;
  sensoryRegulation?: string;
  cueingLevel?: string;
  accuracy?: string;
  stimulability?: string;
  carryover?: string;
}

const MAX_RESPONSE = 2000;
const MAX_RATING = 100;

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * Normalize the client's `activityAssessments` (full activity objects:
 * `{ name, response, assessment: { assistance, ... } }`) into the
 * `activityDetails` the generators read. Unknown keys are dropped; every
 * value is a trimmed, length-capped string or absent.
 */
export function normalizeActivityAssessments(raw: unknown): ActivityDetailInput[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const details: ActivityDetailInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || typeof (item as any).name !== 'string') continue;
    const detail: ActivityDetailInput = { name: String((item as any).name) };
    const response = cleanString((item as any).response, MAX_RESPONSE);
    if (response) detail.response = response;
    const ratings = (item as any).assessment;
    if (ratings && typeof ratings === 'object' && !Array.isArray(ratings)) {
      for (const field of ACTIVITY_RATING_FIELDS) {
        const value = cleanString((ratings as any)[field], MAX_RATING);
        if (value) detail[field] = value;
      }
    }
    details.push(detail);
  }
  return details;
}

export interface GlobalAssessment {
  performance: string;
  assistance: string;
  strength: string;
  motorPlanning: string;
  sensoryRegulation: string;
  [key: string]: string | undefined;
}

/**
 * Fill a blank global field from the per-activity ratings when every rated
 * activity agrees on one value. A therapist who picked "Minimal Assist" via
 * "Apply to All" HAS documented the session's assistance level; the global
 * field was simply a different control. Disagreement between activities is
 * left alone -- the per-activity values carry the detail and the global
 * stays "not assessed" rather than guessing. A global value the therapist
 * typed is never overwritten.
 */
export function deriveGlobalAssessment(
  global: Partial<GlobalAssessment> | null | undefined,
  details: ActivityDetailInput[] | undefined,
): GlobalAssessment {
  const out: GlobalAssessment = {
    performance: '',
    assistance: '',
    strength: '',
    motorPlanning: '',
    sensoryRegulation: '',
    ...(global ?? {}),
  };
  for (const field of DERIVABLE_GLOBAL_FIELDS) {
    const current = typeof out[field] === 'string' ? (out[field] as string).trim() : '';
    if (current) continue;
    const values = new Set(
      (details ?? [])
        .map((d) => (typeof d[field] === 'string' ? (d[field] as string).trim() : ''))
        .filter(Boolean),
    );
    if (values.size === 1) out[field] = Array.from(values)[0];
  }
  return out;
}

/** True when any per-activity rating (not just the narrative) was entered. */
export function hasActivityRatings(details: ActivityDetailInput[] | undefined): boolean {
  return (details ?? []).some((d) => ACTIVITY_RATING_FIELDS.some((f) => typeof d[f] === 'string' && (d[f] as string).trim()));
}
