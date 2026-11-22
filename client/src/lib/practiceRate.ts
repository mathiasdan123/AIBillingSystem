/**
 * Pre-generation Rate/Unit for the SOAP page.
 *
 * The field used to pre-fill a flat $289 (the platform estimate) while the
 * generated billing priced codes at the practice's own rate ($100 in the
 * demo): the "Rough Est." read $867 and the real total $300 (post-deploy
 * retest of #464, 2026-11-18). /api/cpt-codes already returns the catalog
 * with the practice's `baseRate` per code, so the pre-fill can use the same
 * number generation will bill when one is configured, and say so.
 */

export const FLAT_ESTIMATE_RATE: Record<string, number> = {
  treatment: 289,
  initial_eval: 550,
  re_eval: 400,
};

/** Codes consulted, in priority order, per session type. */
export const RATE_LOOKUP_CODES: Record<string, string[]> = {
  // 97530 is the conservative default the generators fall back to, so its
  // rate is the best single guess before codes are known.
  treatment: ["97530", "97110", "97112", "97535", "97533"],
  initial_eval: ["97165", "97166", "97167"],
  re_eval: ["97168"],
};

export interface PracticeRateCatalogEntry {
  code: string;
  baseRate?: string | number | null;
}

export interface DerivedUnitRate {
  rate: number;
  /** "practice": the practice's configured charge; "estimate": the flat platform figure. */
  source: "practice" | "estimate";
  /** The CPT code whose practice rate was used, when source is "practice". */
  code?: string;
}

function parseRate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function derivePracticeUnitRate(
  catalog: PracticeRateCatalogEntry[] | undefined,
  sessionType: string,
): DerivedUnitRate {
  const codes = RATE_LOOKUP_CODES[sessionType] ?? RATE_LOOKUP_CODES.treatment;
  for (const code of codes) {
    const entry = catalog?.find((c) => c.code === code);
    const rate = parseRate(entry?.baseRate);
    if (rate !== null) return { rate, source: "practice", code };
  }
  return { rate: FLAT_ESTIMATE_RATE[sessionType] ?? FLAT_ESTIMATE_RATE.treatment, source: "estimate" };
}

export function describeUnitRate(derived: DerivedUnitRate): string {
  return derived.source === "practice"
    ? `Your practice's rate for ${derived.code}`
    : "Flat estimate — set your rates under Settings → CPT codes";
}
