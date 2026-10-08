/**
 * Per-activity CPT pairing — single source of truth for keeping the
 * Objective section's activity↔code pairing and the note's aggregate
 * billing-code output consistent.
 *
 * Clinician-approved design (Kelli, with Megan's ask, Oct 2026):
 *  - The AI suggests ONE CPT code per documented activity so the activity
 *    description and its billing code live together in the Objective.
 *  - CONSERVATIVE DEFAULT: when an activity does not clearly map to a more
 *    specific code, the suggestion falls back to 97530 Therapeutic
 *    Activities ("sometimes insurance companies only reimburse for one type
 *    of code — Therapeutic Activity tends to be the best one").
 *  - Suggestions are never final. The therapist can change every
 *    per-activity code; the aggregate billing codes are then RE-DERIVED from
 *    the pairings (this module), so the two views cannot contradict each
 *    other. Accuracy framing throughout — the treating provider makes every
 *    coding decision.
 *
 * Shared between server (AI response validation / rule-based fallback) and
 * client (the editable per-activity selector) so both reconcile identically.
 */

export const CONSERVATIVE_DEFAULT_CPT_CODE = "97530";
export const CONSERVATIVE_DEFAULT_CPT_NAME = "Therapeutic Activities";

export const CONSERVATIVE_DEFAULT_RATIONALE =
  "No clearly more specific code is supported by this activity's documentation — " +
  "defaulted to 97530 Therapeutic Activities (conservative suggestion; the treating " +
  "provider reviews and approves all coding decisions).";

export interface ActivityCptPairing {
  /** Activity name exactly as documented in the Objective. */
  activity: string;
  /** Suggested (or therapist-chosen) 5-digit CPT code. */
  code: string;
  /** Human-readable code name, best-effort. */
  name: string;
  /** Accuracy-framed justification for the suggestion. */
  rationale: string;
  /**
   * Where the pairing came from:
   *  - 'ai'        the model (or rule-based fallback) mapped the activity
   *  - 'default'   conservative 97530 fallback — flag for extra review
   *  - 'therapist' the therapist changed the code (always wins)
   */
  source: "ai" | "default" | "therapist";
}

export interface ReconciledCptCode {
  code: string;
  name: string;
  units: number;
  rationale: string;
  reimbursement: number;
  activitiesAssigned: string[];
}

/** Known code names for nicer labels when the AI/catalog gives none. */
const KNOWN_CPT_NAMES: Record<string, string> = {
  "97530": "Therapeutic Activities",
  "97533": "Sensory Integration",
  "97112": "Neuromuscular Re-education",
  "97110": "Therapeutic Exercise",
  "97535": "Self-Care/Home Management",
  "97542": "Wheelchair Management",
  "92507": "Speech/Language Treatment",
};

export function cptNameFor(code: string, fallback?: string): string {
  return KNOWN_CPT_NAMES[code] || fallback || `CPT ${code}`;
}

const VALID_CPT = /^\d{5}$/;

/**
 * Normalize the AI's raw per-activity pairing output into exactly one
 * pairing per documented activity, in the documented order.
 *
 * Conservatism rules:
 *  - An activity the AI skipped, or paired with anything that is not a
 *    5-digit CPT code, gets the 97530 conservative default (source
 *    'default') so the UI can flag it for review.
 *  - Entries for activities that were never documented are dropped — a code
 *    can never be suggested for care that was not documented.
 */
export function normalizeActivityCptPairings(
  activities: string[],
  rawPairings: unknown,
): ActivityCptPairing[] {
  const byActivity = new Map<string, { code: string; name?: string; rationale?: string }>();
  if (Array.isArray(rawPairings)) {
    for (const entry of rawPairings) {
      if (!entry || typeof entry !== "object") continue;
      const activity = typeof (entry as any).activity === "string" ? (entry as any).activity.trim() : "";
      const code = typeof (entry as any).code === "string" ? (entry as any).code.trim() : "";
      if (!activity || byActivity.has(activity)) continue;
      byActivity.set(activity, {
        code,
        name: typeof (entry as any).name === "string" ? (entry as any).name : undefined,
        rationale: typeof (entry as any).rationale === "string" ? (entry as any).rationale : undefined,
      });
    }
  }

  return activities.map((activity) => {
    const raw = byActivity.get(activity);
    if (raw && VALID_CPT.test(raw.code)) {
      return {
        activity,
        code: raw.code,
        name: cptNameFor(raw.code, raw.name),
        rationale:
          raw.rationale ||
          "AI-suggested pairing based on the documented activity — the treating provider reviews and approves all coding decisions.",
        source: "ai" as const,
      };
    }
    return {
      activity,
      code: CONSERVATIVE_DEFAULT_CPT_CODE,
      name: CONSERVATIVE_DEFAULT_CPT_NAME,
      rationale: CONSERVATIVE_DEFAULT_RATIONALE,
      source: "default" as const,
    };
  });
}

/**
 * Re-derive the aggregate billing-code list from the per-activity pairings —
 * the pairings are the single source of truth for WHICH activities support
 * WHICH code, so the Objective pairing and the billing output cannot
 * contradict each other.
 *
 *  - Codes are grouped in order of first appearance across the pairings.
 *  - `totalUnits` (the session's unit budget) is preserved and distributed
 *    across the paired codes proportionally to how many activities support
 *    each (largest-remainder), with every code that has at least one
 *    supporting activity getting at least one unit while units last. This is
 *    documentation-driven distribution, never rate-driven.
 *  - A pre-existing aggregate entry for a surviving code keeps its rationale
 *    (the AI's clinical justification); codes that exist only because of
 *    pairings get an accuracy-framed generic rationale.
 */
export function reconcileCptCodesWithPairings(
  pairings: ActivityCptPairing[],
  existing: Array<Partial<ReconciledCptCode> & { code: string }>,
  unitRate: number,
  totalUnits: number,
): ReconciledCptCode[] {
  // Group activities by code, preserving first-appearance order.
  const order: string[] = [];
  const groups = new Map<string, string[]>();
  for (const p of pairings) {
    if (!groups.has(p.code)) {
      groups.set(p.code, []);
      order.push(p.code);
    }
    groups.get(p.code)!.push(p.activity);
  }
  if (order.length === 0) return [];

  const totalActivities = pairings.length;
  const budget = Math.max(0, Math.floor(totalUnits));

  // Guarantee 1 unit per code while units last (groups with more supporting
  // activities first), then distribute the remainder by largest remainder.
  const unitsByCode = new Map<string, number>();
  const byCountDesc = [...order].sort(
    (a, b) => groups.get(b)!.length - groups.get(a)!.length || order.indexOf(a) - order.indexOf(b),
  );
  let remaining = budget;
  for (const code of byCountDesc) {
    unitsByCode.set(code, remaining > 0 ? 1 : 0);
    if (remaining > 0) remaining--;
  }
  if (remaining > 0) {
    const quotas = order.map((code) => ({
      code,
      quota: (remaining * groups.get(code)!.length) / totalActivities,
    }));
    for (const q of quotas) {
      const whole = Math.floor(q.quota);
      unitsByCode.set(q.code, unitsByCode.get(q.code)! + whole);
      q.quota -= whole;
    }
    let leftover = remaining - quotas.reduce((s, q) => s + Math.floor((remaining * groups.get(q.code)!.length) / totalActivities), 0);
    const byRemainder = [...quotas].sort(
      (a, b) => b.quota - a.quota || order.indexOf(a.code) - order.indexOf(b.code),
    );
    for (const q of byRemainder) {
      if (leftover <= 0) break;
      unitsByCode.set(q.code, unitsByCode.get(q.code)! + 1);
      leftover--;
    }
  }

  const existingByCode = new Map(existing.map((c) => [c.code, c]));
  const result: ReconciledCptCode[] = [];
  for (const code of order) {
    const units = unitsByCode.get(code) || 0;
    // A code whose unit budget ran out is not billed; its pairing remains
    // visible in the Objective for the therapist to adjust.
    if (units <= 0) continue;
    const activitiesAssigned = groups.get(code)!;
    const prior = existingByCode.get(code);
    result.push({
      code,
      name: cptNameFor(code, prior?.name),
      units,
      rationale:
        prior?.rationale ||
        `Documentation-supported pairing for: ${activitiesAssigned.join(", ")}. Suggested for accuracy review — the treating provider makes the final coding decision.`,
      reimbursement: unitRate * units,
      activitiesAssigned,
    });
  }
  return result;
}
