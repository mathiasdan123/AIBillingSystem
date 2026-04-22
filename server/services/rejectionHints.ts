/**
 * Rejection Hint Builder (Stedi remediation Phase 5)
 *
 * Takes a rejected/denied claim + the patient's most recent eligibility
 * snapshot and emits human-readable, actionable hints for the biller. These
 * surface on the claim detail page below the raw `denialReason` banner.
 *
 * Scope for Phase 5 — just the two signals we already have persisted:
 *   - STC downgrade mismatch (Phase 2 stcDowngraded + Phase 2 cpt.therapyCategory)
 *   - Stale eligibility on a denied claim
 *
 * Future slices can enrich by parsing `denialReason` text for common remark
 * codes (CO-16, PR-204, etc.) and tying those to targeted next steps.
 */
import type { Claim, EligibilityCheck } from '@shared/schema';

export interface LineItemForHints {
  cptCodeId?: number | null;
  cptCode?: { code: string; therapyCategory?: string | null } | null;
  // Raw joined form used by routes that build their own enriched shape.
  therapyCategory?: string | null;
  code?: string;
}

// STC → therapy category (mirror of the scrubber's map — kept in sync by
// hand because these two values are the only place this map shows up).
// Only X12-spec codes appear here. The legacy A7/A8/A9 aliases were
// removed after the Phase 6 audit — we never send them anymore (fixed
// in getDetailedBenefits) so a returned STC in those shapes would never
// originate from us. The stediService response parser still accepts
// them as a defense-in-depth alias in case a specific payer happens to
// echo back the old codes.
const STC_TO_CATEGORY: Record<string, string> = {
  AE: 'OT',
  AD: 'PT',
  AF: 'ST',
  MH: 'MH',
  '30': 'GENERAL',
};

const REJECTION_STATUSES = new Set(['denied', 'rejected']);
const REJECTION_CLEARINGHOUSE_CODES = new Set(['A7', 'A8', 'F4', 'D0', 'D1']);

/**
 * Heuristic: does the denialReason string look like a missing-prior-auth
 * rejection? Checks X12 CARC/RARC adjustment codes that specifically mean
 * "auth missing" as well as common plain-text phrasings payers use in 277
 * free-text fields. Case-insensitive. Deliberately conservative — a false
 * positive is a mildly-misleading hint; better than a false negative that
 * leaves the biller without guidance.
 *
 * CARC codes:
 *   CO-62  — Payment adjusted for absence of precertification/authorization
 *   CO-197 — Precertification/authorization absent
 *   CO-198 — Precertification/authorization exceeded (less common as a
 *            denial, often a warning, but still a prior-auth root cause)
 */
export function isLikelyPriorAuthDenial(denialReason: string | null | undefined): boolean {
  if (!denialReason) return false;
  const s = denialReason.toLowerCase();
  // CARC code matches — accept "CO-197", "CO197", and "CO 197". Use word
  // boundaries so "CO-62" doesn't match "CO-620".
  if (/\bco[-\s]?0?62\b/.test(s)) return true;
  if (/\bco[-\s]?197\b/.test(s)) return true;
  if (/\bco[-\s]?198\b/.test(s)) return true;
  // Plain-text phrasings — cover abbreviations + spacing variants.
  if (/prior\s*auth/i.test(denialReason)) return true;
  if (/pre[-\s]?cert/i.test(denialReason)) return true;
  if (/pre[-\s]?auth/i.test(denialReason)) return true;
  if (/authorization\s+(required|missing|absent|not\s+obtained)/i.test(denialReason)) {
    return true;
  }
  if (/precertification/i.test(denialReason)) return true;
  return false;
}

/**
 * Whether a claim is in a state where rejection hints are useful. Stays
 * conservative — we only build hints for clearly-terminal or clearly-rejected
 * states, not `held` or `pending`.
 */
export function isClaimInRejectionState(claim: {
  status?: string | null;
  clearinghouseStatus?: string | null;
}): boolean {
  if (claim.status && REJECTION_STATUSES.has(claim.status)) return true;
  if (
    claim.clearinghouseStatus &&
    REJECTION_CLEARINGHOUSE_CODES.has(claim.clearinghouseStatus)
  ) {
    return true;
  }
  return false;
}

/**
 * Build the hint list. Returns [] if the claim isn't in a rejection state or
 * if we have no useful signal to add. Callers should just spread the return
 * value into the response payload.
 */
export function buildRejectionHints(args: {
  claim: Pick<
    Claim,
    'status' | 'clearinghouseStatus' | 'denialReason' | 'authorizationNumber'
  >;
  lineItems: LineItemForHints[];
  eligibility: EligibilityCheck | null | undefined;
}): string[] {
  const { claim, lineItems, eligibility } = args;

  if (!isClaimInRejectionState(claim)) return [];

  const hints: string[] = [];

  // ----- Hint: missing prior authorization -----
  // Detects denials that smell like prior-auth problems (CO-62/197/198, or
  // text patterns like "precert", "pre-auth", "prior authorization"). We
  // only fire this when the claim itself has no authorizationNumber on
  // file — if auth was already provided, a different root cause is more
  // likely and this hint would be misleading.
  if (isLikelyPriorAuthDenial(claim.denialReason) && !claim.authorizationNumber) {
    hints.push(
      `This denial looks like a missing prior-authorization issue. Most ` +
        `payers allow a retroactive auth request within 30-90 days of the ` +
        `date of service — call the payer to request one, add the auth ` +
        `number to this claim, and resubmit. If retro auth is denied, the ` +
        `next step is to file an appeal (the appeals tab can draft one for you).`
    );
  }

  // ----- Hint: STC downgrade mismatch -----
  // Eligibility told us the payer only verified generic benefits (STC 30),
  // but this claim's CPTs are therapy-specific. That's a strong candidate
  // for the root cause of the rejection.
  //
  // Note: we deliberately do NOT treat a returned STC of 30 ("allows
  // anything") as covering therapy-specific categories here. The whole point
  // of `stcDowngraded` is that 30 means "we don't know therapy-specific
  // coverage." So for hint purposes, any non-GENERAL CPT category that
  // isn't explicitly in the returned STCs counts as a mismatch.
  if (eligibility?.stcDowngraded) {
    const returnedStcs = Array.isArray(eligibility.returnedServiceTypeCodes)
      ? (eligibility.returnedServiceTypeCodes as string[])
      : [];
    const coveredCategories = new Set(
      returnedStcs
        .map((s) => STC_TO_CATEGORY[s])
        .filter((c) => Boolean(c) && c !== 'GENERAL')
    );

    const mismatchedCategories = new Set<string>();
    for (const item of lineItems) {
      const cat =
        item.therapyCategory ||
        item.cptCode?.therapyCategory ||
        null;
      if (!cat || cat === 'GENERAL') continue;
      if (coveredCategories.has(cat)) continue;
      mismatchedCategories.add(cat);
    }

    if (mismatchedCategories.size > 0) {
      const cats = Array.from(mismatchedCategories).sort().join('/');
      hints.push(
        `Eligibility for this patient only returned generic coverage (STC 30). ` +
          `This claim bills ${cats} CPT(s) — the payer may have denied because they ` +
          `never verified ${cats} benefits. Run a fresh eligibility check with a ` +
          `${cats}-specific service type code before resubmitting.`
      );
    } else {
      // Still worth surfacing even if no per-line mismatch, because the
      // downgrade itself is informative context for a rejection.
      hints.push(
        `This patient's most recent eligibility returned only generic coverage (STC 30). ` +
          `Before resubmitting, consider running a fresh eligibility check with a ` +
          `specialty-specific service type code — the payer may be rejecting because ` +
          `the procedure doesn't match the coverage category they verified.`
      );
    }
  }

  // ----- Hint: stale eligibility -----
  // If we have no eligibility at all, or the most recent one is > 90 days
  // old, flag it. Rejections on stale eligibility are often coverage lapses
  // we'd catch by running a fresh 270.
  const STALE_DAYS = 90;
  const ageMs = eligibility?.checkedAt
    ? Date.now() - new Date(eligibility.checkedAt as any).getTime()
    : eligibility?.checkDate
      ? Date.now() - new Date(eligibility.checkDate as any).getTime()
      : Number.MAX_SAFE_INTEGER;
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

  if (!eligibility) {
    hints.push(
      `No eligibility check has ever been run for this patient. Run a 270 ` +
        `before resubmitting — the rejection may be a coverage mismatch we ` +
        `can't see without it.`
    );
  } else if (ageDays > STALE_DAYS) {
    hints.push(
      `The patient's eligibility was last checked ${ageDays} days ago. ` +
        `Coverage may have changed — run a fresh eligibility check before ` +
        `resubmitting.`
    );
  }

  // ----- Hint: coverage inactive on latest check -----
  if (eligibility && eligibility.status === 'inactive') {
    hints.push(
      `The patient's most recent eligibility shows coverage is INACTIVE. ` +
        `Contact the patient for updated insurance information before ` +
        `resubmitting — this claim will keep failing until coverage is active.`
    );
  }

  return hints;
}
