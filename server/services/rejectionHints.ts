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
const STC_TO_CATEGORY: Record<string, string> = {
  AE: 'OT',
  A7: 'OT',
  AD: 'PT',
  A8: 'PT',
  AF: 'ST',
  A9: 'ST',
  MH: 'MH',
  '30': 'GENERAL',
};

const REJECTION_STATUSES = new Set(['denied', 'rejected']);
const REJECTION_CLEARINGHOUSE_CODES = new Set(['A7', 'A8', 'F4', 'D0', 'D1']);

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
  claim: Pick<Claim, 'status' | 'clearinghouseStatus' | 'denialReason'>;
  lineItems: LineItemForHints[];
  eligibility: EligibilityCheck | null | undefined;
}): string[] {
  const { claim, lineItems, eligibility } = args;

  if (!isClaimInRejectionState(claim)) return [];

  const hints: string[] = [];

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
