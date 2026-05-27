/**
 * Pull a model identifier out of an Anthropic cost_report description string.
 *
 * The /v1/organizations/cost_report endpoint groups by `description`, not `model`,
 * so to bucket spend per model we have to parse it out of the description text.
 *
 * Descriptions Anthropic emits look like:
 *   "claude-sonnet-4-5 input tokens"
 *   "Claude Sonnet 4.5 Cache read"
 *   "claude-3-5-haiku-20241022 output"
 *
 * Returns a normalized lowercase id (e.g. "claude-sonnet-4-5") or null if nothing matches —
 * the caller should bucket nulls into "other" rather than dropping them.
 */
export function extractModelFromDescription(desc?: string | null): string | null {
  if (!desc) return null;
  const dashMatch = desc.match(
    /claude-(?:opus|sonnet|haiku|\d+(?:[-.]\d+)*)(?:-(?:opus|sonnet|haiku|\d+(?:[-.]\d+)*))*(?:-\d{8})?/i,
  );
  if (dashMatch) {
    // Strip an 8-digit date suffix (e.g. "-20241022") so dated and undated ids roll up together.
    return dashMatch[0].toLowerCase().replace(/-\d{8}$/, '');
  }
  const proseMatch = desc.match(/claude\s+(opus|sonnet|haiku)\s+(\d+(?:[.\-]\d+)?)/i);
  if (proseMatch) {
    const family = proseMatch[1].toLowerCase();
    const version = proseMatch[2].replace(/\./g, '-');
    return `claude-${family}-${version}`;
  }
  return null;
}
