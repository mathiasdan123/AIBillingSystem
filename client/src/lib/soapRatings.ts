/**
 * Structured-rating handoff on the SOAP page.
 *
 * Post-deploy retest of #464 (2026-11-18): "Minimal Assist" chosen via
 * "Apply to All" and per exercise never reached the generated note, because
 * those controls write only the per-exercise `activities[].assessment`
 * while the generate request's global `assessment` object came from a
 * separate form section the therapist never touched. The server now carries
 * the per-exercise ratings and derives a blank global field from them; the
 * page does the same derivation here so the request body itself is right
 * and the global selects reflect what the therapist chose.
 */

export interface SoapActivityRatings {
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

export interface SoapGlobalAssessment {
  performance: string;
  assistance: string;
  strength: string;
  motorPlanning: string;
  sensoryRegulation: string;
}

/** Global fields that have a per-exercise counterpart. */
export const DERIVABLE_FIELDS = [
  "performance",
  "assistance",
  "strength",
  "motorPlanning",
  "sensoryRegulation",
] as const;

/** "Apply to All": every selected activity gets the same ratings. */
export function applyRatingsToAllActivities<T extends { assessment: SoapActivityRatings }>(
  activities: T[],
  ratings: SoapActivityRatings,
): T[] {
  return activities.map((a) => ({ ...a, assessment: { ...ratings } }));
}

/**
 * Fill each blank global field from the per-exercise ratings when every
 * rated exercise agrees on one value. A value the therapist set on the
 * global control is never overwritten; disagreement leaves it blank (the
 * per-exercise values still travel in the request).
 */
export function mergeGlobalAssessment(
  global: SoapGlobalAssessment,
  activities: Array<{ assessment?: SoapActivityRatings }>,
): SoapGlobalAssessment {
  const out = { ...global };
  for (const field of DERIVABLE_FIELDS) {
    if ((out[field] ?? "").trim()) continue;
    const values = new Set(
      activities
        .map((a) => (a.assessment?.[field] ?? "").trim())
        .filter(Boolean),
    );
    if (values.size === 1) out[field] = Array.from(values)[0];
  }
  return out;
}

/** The `assessment` object sent to POST /api/ai/generate-soap-billing. */
export function buildRequestAssessment(
  global: SoapGlobalAssessment,
  activities: Array<{ assessment?: SoapActivityRatings }>,
): SoapGlobalAssessment {
  const merged = mergeGlobalAssessment(global, activities);
  return {
    performance: merged.performance,
    assistance: merged.assistance,
    strength: merged.strength,
    motorPlanning: merged.motorPlanning,
    sensoryRegulation: merged.sensoryRegulation,
  };
}
