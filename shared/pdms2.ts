/**
 * PDMS-2 structured scoring — pure logic shared by server and client.
 *
 * COPYRIGHT BOUNDARY (do not cross): the PDMS-2 normative tables,
 * per-item administration instructions, and per-item mastery criteria are
 * proprietary content of the PDMS-2 Examiner's Manual (PRO-ED). This module
 * contains NO raw-score→standard-score conversions, NO standard-score-sum→
 * quotient conversions, NO item text, and NO mastery criteria. It only
 * automates arithmetic the therapist would otherwise do by hand (basal/
 * ceiling detection, credited raw scores, domain sums) and displays the
 * standard descriptive interpretation categories. All score conversions are
 * looked up by the therapist in their own PDMS-2 Examiner's Manual and
 * entered manually.
 *
 * Structure facts used here (subtest names, item counts, age applicability,
 * 0/1/2 item scoring, basal/ceiling rules, quotient composition) were
 * supplied by the pilot clinician and describe the test's structure, not its
 * protected content.
 */

import { z } from "zod";

// ==================== Subtest definitions ====================

export type Pdms2ItemScore = 0 | 1 | 2;

export type Pdms2SubtestKey =
  | "reflexes"
  | "stationary"
  | "locomotion"
  | "objectManipulation"
  | "grasping"
  | "visualMotor";

export interface Pdms2SubtestDef {
  key: Pdms2SubtestKey;
  name: string;
  /** What the subtest measures (high-level description, not manual content). */
  measures: string;
  itemCount: number;
  domain: "gross" | "fine";
  /** Inclusive age applicability in months; undefined = applicable at any PDMS-2 age. */
  minAgeMonths?: number;
  maxAgeMonths?: number;
  ageNote?: string;
}

export const PDMS2_SUBTEST_ORDER: Pdms2SubtestKey[] = [
  "reflexes",
  "stationary",
  "locomotion",
  "objectManipulation",
  "grasping",
  "visualMotor",
];

export const PDMS2_SUBTESTS: Record<Pdms2SubtestKey, Pdms2SubtestDef> = {
  reflexes: {
    key: "reflexes",
    name: "Reflexes",
    measures: "Automatic responses to environmental events",
    itemCount: 8,
    domain: "gross",
    maxAgeMonths: 11,
    ageNote: "Only administered during the first year of life (under 12 months)",
  },
  stationary: {
    key: "stationary",
    name: "Stationary",
    measures: "Postural control and balance",
    itemCount: 30,
    domain: "gross",
  },
  locomotion: {
    key: "locomotion",
    name: "Locomotion",
    measures: "Moving from one location to another",
    itemCount: 89,
    domain: "gross",
  },
  objectManipulation: {
    key: "objectManipulation",
    name: "Object Manipulation",
    measures: "Controlling and manipulating objects such as balls",
    itemCount: 24,
    domain: "gross",
    minAgeMonths: 12,
    maxAgeMonths: 71,
    ageNote: "Administered from 12 to 71 months",
  },
  grasping: {
    key: "grasping",
    name: "Grasping",
    measures: "Hand and finger use, fine motor control",
    itemCount: 26,
    domain: "fine",
  },
  visualMotor: {
    key: "visualMotor",
    name: "Visual-Motor Integration",
    measures: "Integration of visual perception with motor output",
    itemCount: 72,
    domain: "fine",
  },
};

// ==================== Item-score scoring (basal / ceiling / raw) ====================

export interface Pdms2SubtestScoring {
  /** First item of the three-consecutive-2s basal run, or null if not established. */
  basalStartItem: number | null;
  basalEstablished: boolean;
  /** Number of items below the basal auto-credited as 2. */
  basalCreditedItems: number;
  basalCreditPoints: number;
  /** Last item of the three-consecutive-0s ceiling run, or null if not reached. */
  ceilingItem: number | null;
  ceilingReached: boolean;
  /** Ceiling reached, or the subtest's final item has been scored. */
  complete: boolean;
  /** Credited raw score: basal credits + counted entered scores. */
  rawScore: number;
  /** Number of items with an entered score (before any exclusions). */
  administeredCount: number;
  /** Entered items below the basal whose entered score was < 2 (credited as 2 per the basal rule). */
  overriddenItems: number[];
  /** Entered items above the ceiling (not counted). */
  uncountedItems: number[];
  /** Unscored items between the basal (or lowest entered item) and the ceiling (or highest entered item). */
  missingItems: number[];
  warnings: string[];
}

function assertValidScores(
  itemScores: Record<number | string, number>,
  itemCount: number,
): Map<number, Pdms2ItemScore> {
  const entries = new Map<number, Pdms2ItemScore>();
  for (const [k, v] of Object.entries(itemScores)) {
    const item = Number(k);
    if (!Number.isInteger(item) || item < 1 || item > itemCount) {
      throw new Error(`Invalid PDMS-2 item number ${k} (subtest has ${itemCount} items)`);
    }
    if (v !== 0 && v !== 1 && v !== 2) {
      throw new Error(`Invalid PDMS-2 item score ${v} for item ${item} (must be 0, 1, or 2)`);
    }
    entries.set(item, v);
  }
  return entries;
}

/** Find the first item of the lowest run of three consecutive items all scored `target`. */
function findRun(
  scores: Map<number, Pdms2ItemScore>,
  target: Pdms2ItemScore,
  upTo: number,
): number | null {
  for (let i = 1; i + 2 <= upTo; i++) {
    if (scores.get(i) === target && scores.get(i + 1) === target && scores.get(i + 2) === target) {
      return i;
    }
  }
  return null;
}

/**
 * Score one subtest from sparse entered item scores.
 *
 * Rules (per the clinician-supplied structure):
 * - Basal: established at three consecutive scores of 2. Items BELOW the basal
 *   are auto-credited as 2 (even if an entered score below the basal was < 2 —
 *   those are reported in `overriddenItems`).
 * - Ceiling: reached at three consecutive scores of 0; items above the ceiling
 *   are not counted (reported in `uncountedItems`).
 * - Raw score = basal credits + entered scores from the basal item through the
 *   ceiling item.
 */
export function scoreSubtest(
  itemScores: Record<number | string, number>,
  itemCount: number,
): Pdms2SubtestScoring {
  if (!Number.isInteger(itemCount) || itemCount < 1) {
    throw new Error(`Invalid PDMS-2 item count: ${itemCount}`);
  }
  const scores = assertValidScores(itemScores, itemCount);
  const warnings: string[] = [];

  const administeredCount = scores.size;
  if (administeredCount === 0) {
    return {
      basalStartItem: null,
      basalEstablished: false,
      basalCreditedItems: 0,
      basalCreditPoints: 0,
      ceilingItem: null,
      ceilingReached: false,
      complete: false,
      rawScore: 0,
      administeredCount: 0,
      overriddenItems: [],
      uncountedItems: [],
      missingItems: [],
      warnings: [],
    };
  }

  // Ceiling first: testing stops there, so nothing above it informs scoring.
  const ceilingRunStart = findRun(scores, 0, itemCount);
  const ceilingItem = ceilingRunStart === null ? null : ceilingRunStart + 2;
  const ceilingReached = ceilingItem !== null;

  // Basal: lowest run of three consecutive 2s at or below the ceiling.
  const basalSearchLimit = ceilingItem ?? itemCount;
  const basalStartItem = findRun(scores, 2, basalSearchLimit);
  const basalEstablished = basalStartItem !== null;

  const basalCreditedItems = basalEstablished ? basalStartItem! - 1 : 0;
  const basalCreditPoints = basalCreditedItems * 2;

  const overriddenItems: number[] = [];
  const uncountedItems: number[] = [];
  let countedEnteredPoints = 0;

  const sortedItems = Array.from(scores.keys()).sort((a, b) => a - b);
  for (const item of sortedItems) {
    const score = scores.get(item)!;
    if (ceilingItem !== null && item > ceilingItem) {
      uncountedItems.push(item);
      continue;
    }
    if (basalEstablished && item < basalStartItem!) {
      // Covered by basal credit (2 points); flag if the entered score differed.
      if (score < 2) overriddenItems.push(item);
      continue;
    }
    countedEnteredPoints += score;
  }

  // Missing (unscored) items inside the counted range contribute 0 and are flagged.
  const lowestEntered = sortedItems[0];
  const highestEntered = sortedItems[sortedItems.length - 1];
  const rangeStart = basalEstablished ? basalStartItem! : lowestEntered;
  const rangeEnd = ceilingItem !== null ? ceilingItem : highestEntered;
  const missingItems: number[] = [];
  for (let i = rangeStart; i <= rangeEnd; i++) {
    if (!scores.has(i)) missingItems.push(i);
  }

  const complete = ceilingReached || scores.has(itemCount);

  if (!basalEstablished && !scores.has(1)) {
    warnings.push(
      "No basal established — continue testing downward until three consecutive scores of 2 (or item 1). Items below the lowest scored item are not credited.",
    );
  }
  if (!complete) {
    warnings.push(
      "Ceiling not yet reached — continue testing until three consecutive scores of 0 (or the final item).",
    );
  }
  if (missingItems.length > 0) {
    warnings.push(
      `Unscored item${missingItems.length === 1 ? "" : "s"} between basal and ceiling (counted as 0): ${missingItems.join(", ")}.`,
    );
  }
  if (overriddenItems.length > 0) {
    warnings.push(
      `Item${overriddenItems.length === 1 ? "" : "s"} ${overriddenItems.join(", ")} scored below 2 but fall below the basal — credited as 2 per the basal rule.`,
    );
  }

  const rawScore = basalCreditPoints + countedEnteredPoints;

  return {
    basalStartItem,
    basalEstablished,
    basalCreditedItems,
    basalCreditPoints,
    ceilingItem,
    ceilingReached,
    complete,
    rawScore,
    administeredCount,
    overriddenItems,
    uncountedItems,
    missingItems,
    warnings,
  };
}

// ==================== Age applicability ====================

/** Returns a warning string if the subtest is outside its age applicability, else null. */
export function validateSubtestAge(key: Pdms2SubtestKey, ageInMonths: number): string | null {
  const def = PDMS2_SUBTESTS[key];
  if (def.minAgeMonths !== undefined && ageInMonths < def.minAgeMonths) {
    return `${def.name} is administered from ${def.minAgeMonths} to ${def.maxAgeMonths} months — child is ${ageInMonths} months.`;
  }
  if (def.maxAgeMonths !== undefined && ageInMonths > def.maxAgeMonths) {
    if (key === "reflexes") {
      return `Reflexes is only administered during the first year of life — child is ${ageInMonths} months.`;
    }
    return `${def.name} is administered up to ${def.maxAgeMonths} months — child is ${ageInMonths} months.`;
  }
  return null;
}

/** Chronological age in completed months between date of birth and test date. */
export function chronologicalAgeInMonths(dobIso: string, testDateIso: string): number {
  const dob = new Date(dobIso);
  const test = new Date(testDateIso);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(test.getTime())) {
    throw new Error("Invalid date for chronological age calculation");
  }
  if (test < dob) throw new Error("Test date is before date of birth");
  let months =
    (test.getUTCFullYear() - dob.getUTCFullYear()) * 12 + (test.getUTCMonth() - dob.getUTCMonth());
  if (test.getUTCDate() < dob.getUTCDate()) months -= 1;
  return months;
}

// ==================== Domain sums (quotient lookups) ====================

export interface Pdms2StandardScores {
  reflexes?: number | null;
  stationary?: number | null;
  locomotion?: number | null;
  objectManipulation?: number | null;
  grasping?: number | null;
  visualMotor?: number | null;
}

export interface Pdms2DomainSum {
  /** Subtests whose standard scores make up this composite at this age. */
  components: Pdms2SubtestKey[];
  /** Sum of the component standard scores, or null if any component is missing. */
  sum: number | null;
  missing: Pdms2SubtestKey[];
}

export interface Pdms2DomainSums {
  grossMotor: Pdms2DomainSum;
  fineMotor: Pdms2DomainSum;
  totalMotor: Pdms2DomainSum;
}

function buildSum(components: Pdms2SubtestKey[], scores: Pdms2StandardScores): Pdms2DomainSum {
  const missing = components.filter((k) => {
    const v = scores[k];
    return v === undefined || v === null;
  });
  if (missing.length > 0) return { components, sum: null, missing };
  let sum = 0;
  for (const k of components) {
    const v = scores[k]!;
    if (!Number.isInteger(v) || v < 1 || v > 20) {
      throw new Error(`Invalid standard score ${v} for ${PDMS2_SUBTESTS[k].name} (expected 1-20)`);
    }
    sum += v;
  }
  return { components, sum, missing: [] };
}

/**
 * Sums of standard scores the therapist looks up in the quotient normative
 * tables. Gross Motor uses Reflexes under 12 months and Object Manipulation
 * at 12 months and older.
 */
export function computeDomainSums(
  standardScores: Pdms2StandardScores,
  ageInMonths: number,
): Pdms2DomainSums {
  if (!Number.isInteger(ageInMonths) || ageInMonths < 0) {
    throw new Error(`Invalid age in months: ${ageInMonths}`);
  }
  const grossComponents: Pdms2SubtestKey[] =
    ageInMonths < 12
      ? ["reflexes", "stationary", "locomotion"]
      : ["stationary", "locomotion", "objectManipulation"];
  const fineComponents: Pdms2SubtestKey[] = ["grasping", "visualMotor"];
  const totalComponents: Pdms2SubtestKey[] = [...grossComponents, ...fineComponents];
  return {
    grossMotor: buildSum(grossComponents, standardScores),
    fineMotor: buildSum(fineComponents, standardScores),
    totalMotor: buildSum(totalComponents, standardScores),
  };
}

// ==================== Descriptive interpretation bands ====================
// Standard descriptive categories for norm-referenced scores — not manual content.

export function standardScoreBand(standardScore: number): string {
  if (!Number.isInteger(standardScore) || standardScore < 1 || standardScore > 20) {
    throw new Error(`Invalid standard score ${standardScore} (expected 1-20)`);
  }
  if (standardScore >= 17) return "Very Superior";
  if (standardScore >= 15) return "Superior";
  if (standardScore >= 13) return "Above Average";
  if (standardScore >= 8) return "Average";
  if (standardScore >= 6) return "Below Average";
  if (standardScore >= 4) return "Poor";
  return "Very Poor";
}

export function quotientBand(quotient: number): string {
  if (!Number.isInteger(quotient) || quotient < 1 || quotient > 200) {
    throw new Error(`Invalid quotient ${quotient}`);
  }
  if (quotient >= 131) return "Very Superior";
  if (quotient >= 121) return "Superior";
  if (quotient >= 111) return "Above Average";
  if (quotient >= 90) return "Average";
  if (quotient >= 80) return "Below Average";
  if (quotient >= 70) return "Poor";
  return "Very Poor";
}

// ==================== Zod schemas (persisted jsonb shapes) ====================

export const pdms2ItemScoresSchema = z.record(
  z.string().regex(/^\d+$/),
  z.union([z.literal(0), z.literal(1), z.literal(2)]),
);

export const pdms2SubtestEntrySchema = z.object({
  /** Sparse entered item scores: { "5": 2, "6": 1, ... } */
  itemScores: pdms2ItemScoresSchema.default({}),
  /** Item the therapist chose as the age-appropriate entry point (informational). */
  entryItem: z.number().int().min(1).nullable().optional(),
  /** Manual entries looked up in the therapist's own PDMS-2 Examiner's Manual. */
  standardScore: z.number().int().min(1).max(20).nullable().optional(),
  percentileRank: z.string().max(10).nullable().optional(),
  ageEquivalentMonths: z.number().int().min(0).max(120).nullable().optional(),
});

export const pdms2SubtestsSchema = z.object({
  reflexes: pdms2SubtestEntrySchema.optional(),
  stationary: pdms2SubtestEntrySchema.optional(),
  locomotion: pdms2SubtestEntrySchema.optional(),
  objectManipulation: pdms2SubtestEntrySchema.optional(),
  grasping: pdms2SubtestEntrySchema.optional(),
  visualMotor: pdms2SubtestEntrySchema.optional(),
});

export type Pdms2SubtestEntry = z.infer<typeof pdms2SubtestEntrySchema>;
export type Pdms2Subtests = z.infer<typeof pdms2SubtestsSchema>;
