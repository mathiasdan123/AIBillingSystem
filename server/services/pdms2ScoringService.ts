/**
 * PDMS-2 scoring service — the server-side authority for the structured
 * PDMS-2 scoring workflow.
 *
 * The pure arithmetic (basal/ceiling detection, credited raw scores, domain
 * sums, descriptive bands) lives in shared/pdms2.ts so the client can show
 * live indicators; this service composes it into the persisted `computed`
 * state and recomputes it on every save, so stored scoring state can never
 * drift from entered item scores.
 *
 * COPYRIGHT BOUNDARY: no PDMS-2 normative tables, item text, or mastery
 * criteria exist anywhere in this system. Raw→standard-score and
 * sum→quotient conversions are manual lookups the therapist performs in
 * their own PDMS-2 Examiner's Manual.
 */

import {
  PDMS2_SUBTESTS,
  PDMS2_SUBTEST_ORDER,
  computeDomainSums,
  quotientBand,
  scoreSubtest,
  standardScoreBand,
  validateSubtestAge,
  pdms2SubtestsSchema,
  type Pdms2DomainSums,
  type Pdms2StandardScores,
  type Pdms2SubtestKey,
  type Pdms2SubtestScoring,
  type Pdms2Subtests,
} from "@shared/pdms2";

export {
  PDMS2_SUBTESTS,
  PDMS2_SUBTEST_ORDER,
  computeDomainSums,
  quotientBand,
  scoreSubtest,
  standardScoreBand,
  validateSubtestAge,
};

export interface Pdms2SubtestComputed extends Pdms2SubtestScoring {
  key: Pdms2SubtestKey;
  name: string;
  itemCount: number;
  /** Age-applicability warning for this subtest, if any. */
  ageWarning: string | null;
  /** Descriptive band for the manually entered standard score, if present. */
  standardScoreBand: string | null;
}

export interface Pdms2ComputedState {
  subtests: Partial<Record<Pdms2SubtestKey, Pdms2SubtestComputed>>;
  domainSums: Pdms2DomainSums;
  quotientBands: {
    grossMotor: string | null;
    fineMotor: string | null;
    totalMotor: string | null;
  };
  warnings: string[];
  computedAt: string;
}

export interface Pdms2AssessmentInput {
  ageInMonths: number;
  subtests: Pdms2Subtests;
  grossMotorQuotient?: number | null;
  fineMotorQuotient?: number | null;
  totalMotorQuotient?: number | null;
}

/**
 * Validate and compute the full scoring state for an assessment.
 * Throws on structurally invalid input (bad item numbers/scores, bad age).
 */
export function computeAssessmentState(input: Pdms2AssessmentInput): Pdms2ComputedState {
  if (!Number.isInteger(input.ageInMonths) || input.ageInMonths < 0 || input.ageInMonths > 120) {
    throw new Error(`Invalid chronological age in months: ${input.ageInMonths}`);
  }
  const subtests = pdms2SubtestsSchema.parse(input.subtests ?? {});

  const warnings: string[] = [];
  const computedSubtests: Partial<Record<Pdms2SubtestKey, Pdms2SubtestComputed>> = {};
  const standardScores: Pdms2StandardScores = {};

  for (const key of PDMS2_SUBTEST_ORDER) {
    const entry = subtests[key];
    if (!entry) continue;
    const def = PDMS2_SUBTESTS[key];
    const hasItemScores = Object.keys(entry.itemScores ?? {}).length > 0;
    const hasManualEntries =
      entry.standardScore != null || entry.percentileRank != null || entry.ageEquivalentMonths != null;
    if (!hasItemScores && !hasManualEntries) continue;

    const scoring = scoreSubtest(entry.itemScores ?? {}, def.itemCount);
    const ageWarning = hasItemScores ? validateSubtestAge(key, input.ageInMonths) : null;
    if (ageWarning) warnings.push(ageWarning);

    let band: string | null = null;
    if (entry.standardScore != null) {
      band = standardScoreBand(entry.standardScore);
      standardScores[key] = entry.standardScore;
    }

    computedSubtests[key] = {
      key,
      name: def.name,
      itemCount: def.itemCount,
      ...scoring,
      ageWarning,
      standardScoreBand: band,
    };
    for (const w of scoring.warnings) {
      warnings.push(`${def.name}: ${w}`);
    }
  }

  const domainSums = computeDomainSums(standardScores, input.ageInMonths);

  const bandFor = (q: number | null | undefined): string | null =>
    q == null ? null : quotientBand(q);

  return {
    subtests: computedSubtests,
    domainSums,
    quotientBands: {
      grossMotor: bandFor(input.grossMotorQuotient),
      fineMotor: bandFor(input.fineMotorQuotient),
      totalMotor: bandFor(input.totalMotorQuotient),
    },
    warnings,
    computedAt: new Date().toISOString(),
  };
}
