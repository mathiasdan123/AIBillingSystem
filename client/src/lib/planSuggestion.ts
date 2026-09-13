/**
 * Parses the AI-generated Plan section's suggested-update convention
 * (clinician feature: accept/dismiss card for plan changes).
 *
 * Generation contract (aiSoapBillingService plan instructions): when today's
 * session motivates a plan change, the FIRST paragraph is exactly
 * "Suggested update: ..." plus its motivating observation, then a blank
 * line, then the carried-forward plan.
 */
export interface PlanSuggestion {
  /** The full first paragraph: "Suggested update: ..." */
  suggestion: string;
  /** The carried-forward plan without the suggestion paragraph. */
  remainder: string;
}

const PREFIX = /^suggested update:/i;

export function parsePlanSuggestion(plan: string | undefined | null): PlanSuggestion | null {
  if (!plan) return null;
  const trimmed = plan.trimStart();
  if (!PREFIX.test(trimmed)) return null;
  const splitAt = trimmed.search(/\n\s*\n/);
  if (splitAt === -1) {
    // Whole plan is the suggestion (no carried-forward remainder) — still
    // offer accept/dismiss; dismissing leaves an empty plan for the
    // therapist to fill, so the caller should guard that case.
    return { suggestion: trimmed.trim(), remainder: '' };
  }
  return {
    suggestion: trimmed.slice(0, splitAt).trim(),
    remainder: trimmed.slice(splitAt).replace(/^\s+/, ''),
  };
}
