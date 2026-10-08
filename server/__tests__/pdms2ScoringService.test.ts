import { describe, expect, it } from "vitest";
import {
  PDMS2_SUBTESTS,
  PDMS2_SUBTEST_ORDER,
  computeAssessmentState,
  computeDomainSums,
  quotientBand,
  scoreSubtest,
  standardScoreBand,
  validateSubtestAge,
} from "../services/pdms2ScoringService";
import { chronologicalAgeInMonths } from "@shared/pdms2";

/**
 * PDMS-2 scoring logic — clinical data, so this math must be bulletproof.
 * Covers: basal detection (incl. auto-credits and overrides), ceiling
 * detection, raw-score math, domain-sum selection at the 12-month boundary,
 * age-applicability validation, descriptive bands, and input validation.
 */

const scores = (entries: Array<[number, 0 | 1 | 2]>): Record<number, 0 | 1 | 2> =>
  Object.fromEntries(entries) as Record<number, 0 | 1 | 2>;

describe("subtest structure", () => {
  it("defines the six subtests with the clinician-specified item counts", () => {
    expect(PDMS2_SUBTEST_ORDER).toHaveLength(6);
    expect(PDMS2_SUBTESTS.reflexes.itemCount).toBe(8);
    expect(PDMS2_SUBTESTS.stationary.itemCount).toBe(30);
    expect(PDMS2_SUBTESTS.locomotion.itemCount).toBe(89);
    expect(PDMS2_SUBTESTS.objectManipulation.itemCount).toBe(24);
    expect(PDMS2_SUBTESTS.grasping.itemCount).toBe(26);
    expect(PDMS2_SUBTESTS.visualMotor.itemCount).toBe(72);
  });

  it("contains no PDMS-2 item text or mastery criteria (copyright boundary)", () => {
    // Item counts only — defs carry name + what the subtest measures, nothing per-item.
    for (const key of PDMS2_SUBTEST_ORDER) {
      const def = PDMS2_SUBTESTS[key] as any;
      expect(def.items).toBeUndefined();
      expect(def.criteria).toBeUndefined();
    }
  });
});

describe("scoreSubtest — basal detection", () => {
  it("establishes the basal at three consecutive scores of 2 and credits items below", () => {
    // Entry at item 5 (age-appropriate entry point chosen by therapist).
    const result = scoreSubtest(
      scores([[5, 2], [6, 2], [7, 2], [8, 1], [9, 0], [10, 0], [11, 0]]),
      30,
    );
    expect(result.basalEstablished).toBe(true);
    expect(result.basalStartItem).toBe(5);
    expect(result.basalCreditedItems).toBe(4); // items 1-4
    expect(result.basalCreditPoints).toBe(8);
  });

  it("uses the lowest run of three consecutive 2s when several exist", () => {
    const result = scoreSubtest(
      scores([[3, 2], [4, 2], [5, 2], [6, 1], [7, 2], [8, 2], [9, 2], [10, 0], [11, 0], [12, 0]]),
      30,
    );
    expect(result.basalStartItem).toBe(3);
    expect(result.basalCreditPoints).toBe(4); // items 1-2
    // Raw: credits 4 + (2+2+2+1+2+2+2) + 0s = 4 + 13 = 17
    expect(result.rawScore).toBe(17);
  });

  it("does not require a basal when testing began at item 1", () => {
    const result = scoreSubtest(scores([[1, 2], [2, 1], [3, 0], [4, 0], [5, 0]]), 30);
    expect(result.basalEstablished).toBe(false);
    expect(result.basalCreditPoints).toBe(0);
    expect(result.rawScore).toBe(3);
    // No "no basal" warning when item 1 was administered — nothing below to credit.
    expect(result.warnings.some((w) => w.includes("No basal"))).toBe(false);
  });

  it("warns when no basal is established and item 1 was not reached", () => {
    const result = scoreSubtest(scores([[5, 2], [6, 2], [7, 1]]), 30);
    expect(result.basalEstablished).toBe(false);
    expect(result.warnings.some((w) => w.includes("No basal established"))).toBe(true);
  });

  it("two consecutive 2s do not establish a basal", () => {
    const result = scoreSubtest(scores([[5, 2], [6, 2], [7, 1], [8, 2]]), 30);
    expect(result.basalEstablished).toBe(false);
  });

  it("a run of 2s must be on consecutive item numbers", () => {
    // 2s on items 4, 6, 8 — not consecutive items.
    const result = scoreSubtest(scores([[4, 2], [6, 2], [8, 2]]), 30);
    expect(result.basalEstablished).toBe(false);
  });

  it("credits entered items below the basal as 2 even if scored lower, and flags the override", () => {
    const result = scoreSubtest(
      scores([[2, 1], [4, 2], [5, 2], [6, 2], [7, 0], [8, 0], [9, 0]]),
      30,
    );
    expect(result.basalStartItem).toBe(4);
    expect(result.basalCreditPoints).toBe(6); // items 1-3 credited as 2
    expect(result.overriddenItems).toEqual([2]);
    // Raw: 6 credits + (2+2+2) = 12; the entered 1 on item 2 is replaced by the credit.
    expect(result.rawScore).toBe(12);
    expect(result.warnings.some((w) => w.includes("below the basal"))).toBe(true);
  });

  it("basal at item 1 credits nothing below", () => {
    const result = scoreSubtest(scores([[1, 2], [2, 2], [3, 2], [4, 0], [5, 0], [6, 0]]), 30);
    expect(result.basalStartItem).toBe(1);
    expect(result.basalCreditedItems).toBe(0);
    expect(result.rawScore).toBe(6);
  });
});

describe("scoreSubtest — ceiling detection", () => {
  it("reaches the ceiling at three consecutive scores of 0 and marks the subtest complete", () => {
    const result = scoreSubtest(
      scores([[1, 2], [2, 2], [3, 2], [4, 1], [5, 0], [6, 0], [7, 0]]),
      30,
    );
    expect(result.ceilingReached).toBe(true);
    expect(result.ceilingItem).toBe(7);
    expect(result.complete).toBe(true);
    expect(result.warnings.some((w) => w.includes("Ceiling not yet reached"))).toBe(false);
  });

  it("two consecutive 0s do not reach a ceiling", () => {
    const result = scoreSubtest(scores([[1, 2], [2, 2], [3, 2], [4, 0], [5, 0], [6, 1]]), 30);
    expect(result.ceilingReached).toBe(false);
    expect(result.warnings.some((w) => w.includes("Ceiling not yet reached"))).toBe(true);
  });

  it("0s must be on consecutive item numbers to reach a ceiling", () => {
    const result = scoreSubtest(scores([[1, 2], [2, 2], [3, 2], [4, 0], [6, 0], [8, 0]]), 30);
    expect(result.ceilingReached).toBe(false);
  });

  it("excludes entered items above the ceiling from the raw score and flags them", () => {
    const result = scoreSubtest(
      scores([[1, 2], [2, 2], [3, 2], [4, 0], [5, 0], [6, 0], [7, 2], [8, 1]]),
      30,
    );
    expect(result.ceilingItem).toBe(6);
    expect(result.uncountedItems).toEqual([7, 8]);
    expect(result.rawScore).toBe(6); // 7 and 8 not counted
  });

  it("uses the lowest ceiling run when several exist", () => {
    const result = scoreSubtest(
      scores([[1, 2], [2, 2], [3, 2], [4, 0], [5, 0], [6, 0], [7, 1], [8, 0], [9, 0], [10, 0]]),
      30,
    );
    expect(result.ceilingItem).toBe(6);
    expect(result.uncountedItems).toEqual([7, 8, 9, 10]);
  });

  it("is complete without a ceiling when the final item has been scored", () => {
    const result = scoreSubtest(scores([[6, 2], [7, 2], [8, 1]]), 8);
    expect(result.ceilingReached).toBe(false);
    expect(result.complete).toBe(true);
  });

  it("ignores a 2s run above the ceiling when searching for the basal", () => {
    // Ceiling at 3-5; stray 2s beyond it must not create a basal.
    const result = scoreSubtest(
      scores([[1, 1], [2, 1], [3, 0], [4, 0], [5, 0], [6, 2], [7, 2], [8, 2]]),
      30,
    );
    expect(result.ceilingItem).toBe(5);
    expect(result.basalEstablished).toBe(false);
    expect(result.rawScore).toBe(2);
    expect(result.uncountedItems).toEqual([6, 7, 8]);
  });
});

describe("scoreSubtest — raw score math", () => {
  it("spec example: 10 items at 2 + 3 at 1 + 2 at 0 = 23", () => {
    const entries: Array<[number, 0 | 1 | 2]> = [];
    for (let i = 1; i <= 10; i++) entries.push([i, 2]);
    for (let i = 11; i <= 13; i++) entries.push([i, 1]);
    for (let i = 14; i <= 15; i++) entries.push([i, 0]);
    const result = scoreSubtest(scores(entries), 30);
    expect(result.rawScore).toBe(23);
    expect(result.basalStartItem).toBe(1);
    expect(result.ceilingReached).toBe(false); // only two 0s
  });

  it("combines basal credits, entered scores, and ceiling exclusion", () => {
    // Entry at 8: 8-10 all 2 (basal), 11=1, 12=1, 13=0, 14=0, 15=0 (ceiling), 16=2 (uncounted)
    const result = scoreSubtest(
      scores([[8, 2], [9, 2], [10, 2], [11, 1], [12, 1], [13, 0], [14, 0], [15, 0], [16, 2]]),
      30,
    );
    // Credits: items 1-7 = 14. Entered counted: 2+2+2+1+1+0+0+0 = 8. Total 22.
    expect(result.rawScore).toBe(22);
    expect(result.basalCreditPoints).toBe(14);
    expect(result.uncountedItems).toEqual([16]);
    expect(result.complete).toBe(true);
  });

  it("maximum possible raw score equals 2 x itemCount", () => {
    const entries: Array<[number, 0 | 1 | 2]> = [];
    for (let i = 1; i <= 8; i++) entries.push([i, 2]);
    const result = scoreSubtest(scores(entries), 8);
    expect(result.rawScore).toBe(16);
    expect(result.complete).toBe(true);
  });

  it("returns a zeroed result for no entered scores", () => {
    const result = scoreSubtest({}, 30);
    expect(result.rawScore).toBe(0);
    expect(result.administeredCount).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it("flags unscored items between basal and ceiling (counted as 0)", () => {
    const result = scoreSubtest(
      scores([[1, 2], [2, 2], [3, 2], [5, 0], [6, 0], [7, 0]]), // item 4 skipped
      30,
    );
    expect(result.missingItems).toEqual([4]);
    expect(result.rawScore).toBe(6);
    expect(result.warnings.some((w) => w.includes("Unscored item"))).toBe(true);
  });
});

describe("scoreSubtest — input validation", () => {
  it("rejects item numbers outside the subtest range", () => {
    expect(() => scoreSubtest({ 9: 2 } as any, 8)).toThrow(/Invalid PDMS-2 item number/);
    expect(() => scoreSubtest({ 0: 2 } as any, 8)).toThrow(/Invalid PDMS-2 item number/);
  });

  it("rejects scores other than 0, 1, 2", () => {
    expect(() => scoreSubtest({ 1: 3 } as any, 8)).toThrow(/Invalid PDMS-2 item score/);
    expect(() => scoreSubtest({ 1: -1 } as any, 8)).toThrow(/Invalid PDMS-2 item score/);
    expect(() => scoreSubtest({ 1: 1.5 } as any, 8)).toThrow(/Invalid PDMS-2 item score/);
  });

  it("rejects an invalid item count", () => {
    expect(() => scoreSubtest({}, 0)).toThrow(/Invalid PDMS-2 item count/);
  });
});

describe("domain sums — age-based selection", () => {
  const allScores = {
    reflexes: 9,
    stationary: 10,
    locomotion: 11,
    objectManipulation: 12,
    grasping: 8,
    visualMotor: 7,
  };

  it("uses Reflexes (not Object Manipulation) for Gross Motor under 12 months", () => {
    const sums = computeDomainSums(allScores, 11);
    expect(sums.grossMotor.components).toEqual(["reflexes", "stationary", "locomotion"]);
    expect(sums.grossMotor.sum).toBe(30);
    expect(sums.totalMotor.components).toEqual([
      "reflexes", "stationary", "locomotion", "grasping", "visualMotor",
    ]);
    expect(sums.totalMotor.sum).toBe(45);
  });

  it("uses Object Manipulation (not Reflexes) for Gross Motor at exactly 12 months", () => {
    const sums = computeDomainSums(allScores, 12);
    expect(sums.grossMotor.components).toEqual(["stationary", "locomotion", "objectManipulation"]);
    expect(sums.grossMotor.sum).toBe(33);
    expect(sums.totalMotor.sum).toBe(48);
  });

  it("Fine Motor is always Grasping + Visual-Motor Integration", () => {
    for (const age of [6, 12, 48]) {
      const sums = computeDomainSums(allScores, age);
      expect(sums.fineMotor.components).toEqual(["grasping", "visualMotor"]);
      expect(sums.fineMotor.sum).toBe(15);
    }
  });

  it("returns a null sum and names the missing components when a score is absent", () => {
    const sums = computeDomainSums({ stationary: 10, locomotion: 11 }, 24);
    expect(sums.grossMotor.sum).toBeNull();
    expect(sums.grossMotor.missing).toEqual(["objectManipulation"]);
    expect(sums.fineMotor.sum).toBeNull();
    expect(sums.fineMotor.missing).toEqual(["grasping", "visualMotor"]);
    expect(sums.totalMotor.sum).toBeNull();
  });

  it("rejects out-of-range standard scores", () => {
    expect(() => computeDomainSums({ grasping: 21, visualMotor: 10 }, 24)).toThrow(/Invalid standard score/);
    expect(() => computeDomainSums({ grasping: 0, visualMotor: 10 }, 24)).toThrow(/Invalid standard score/);
  });

  it("rejects an invalid age", () => {
    expect(() => computeDomainSums({}, -1)).toThrow(/Invalid age/);
    expect(() => computeDomainSums({}, 11.5)).toThrow(/Invalid age/);
  });
});

describe("age applicability validation", () => {
  it("warns when Reflexes is used for a child 12 months or older", () => {
    expect(validateSubtestAge("reflexes", 12)).toMatch(/first year of life/);
    expect(validateSubtestAge("reflexes", 11)).toBeNull();
  });

  it("warns when Object Manipulation is used outside 12-71 months", () => {
    expect(validateSubtestAge("objectManipulation", 11)).toMatch(/12 to 71 months/);
    expect(validateSubtestAge("objectManipulation", 72)).toMatch(/71 months/);
    expect(validateSubtestAge("objectManipulation", 12)).toBeNull();
    expect(validateSubtestAge("objectManipulation", 71)).toBeNull();
  });

  it("never warns for all-age subtests", () => {
    for (const key of ["stationary", "locomotion", "grasping", "visualMotor"] as const) {
      expect(validateSubtestAge(key, 3)).toBeNull();
      expect(validateSubtestAge(key, 70)).toBeNull();
    }
  });
});

describe("chronological age", () => {
  it("computes completed months, adjusting for the day of month", () => {
    expect(chronologicalAgeInMonths("2024-03-15", "2026-03-15")).toBe(24);
    expect(chronologicalAgeInMonths("2024-03-15", "2026-03-14")).toBe(23);
    expect(chronologicalAgeInMonths("2024-03-15", "2024-04-20")).toBe(1);
    expect(chronologicalAgeInMonths("2024-03-15", "2024-04-10")).toBe(0);
  });

  it("rejects invalid or reversed dates", () => {
    expect(() => chronologicalAgeInMonths("bogus", "2026-01-01")).toThrow();
    expect(() => chronologicalAgeInMonths("2026-01-02", "2026-01-01")).toThrow(/before date of birth/);
  });
});

describe("descriptive bands", () => {
  it("maps standard scores to the standard descriptive categories", () => {
    expect(standardScoreBand(1)).toBe("Very Poor");
    expect(standardScoreBand(3)).toBe("Very Poor");
    expect(standardScoreBand(4)).toBe("Poor");
    expect(standardScoreBand(5)).toBe("Poor");
    expect(standardScoreBand(6)).toBe("Below Average");
    expect(standardScoreBand(7)).toBe("Below Average");
    expect(standardScoreBand(8)).toBe("Average");
    expect(standardScoreBand(12)).toBe("Average");
    expect(standardScoreBand(13)).toBe("Above Average");
    expect(standardScoreBand(14)).toBe("Above Average");
    expect(standardScoreBand(15)).toBe("Superior");
    expect(standardScoreBand(16)).toBe("Superior");
    expect(standardScoreBand(17)).toBe("Very Superior");
    expect(standardScoreBand(20)).toBe("Very Superior");
    expect(() => standardScoreBand(0)).toThrow();
    expect(() => standardScoreBand(21)).toThrow();
  });

  it("maps quotients to descriptive categories", () => {
    expect(quotientBand(69)).toBe("Very Poor");
    expect(quotientBand(70)).toBe("Poor");
    expect(quotientBand(80)).toBe("Below Average");
    expect(quotientBand(90)).toBe("Average");
    expect(quotientBand(110)).toBe("Average");
    expect(quotientBand(111)).toBe("Above Average");
    expect(quotientBand(121)).toBe("Superior");
    expect(quotientBand(131)).toBe("Very Superior");
  });
});

describe("computeAssessmentState", () => {
  it("assembles per-subtest scoring, bands, domain sums, and warnings", () => {
    const state = computeAssessmentState({
      ageInMonths: 30,
      subtests: {
        stationary: {
          itemScores: { 5: 2, 6: 2, 7: 2, 8: 1, 9: 0, 10: 0, 11: 0 },
          standardScore: 7,
        },
        locomotion: { itemScores: {}, standardScore: 9 },
        objectManipulation: { itemScores: {}, standardScore: 10 },
        grasping: { itemScores: {}, standardScore: 8 },
        visualMotor: { itemScores: {}, standardScore: 11 },
      },
      grossMotorQuotient: 88,
      fineMotorQuotient: 97,
      totalMotorQuotient: null,
    });

    const stationary = state.subtests.stationary!;
    expect(stationary.rawScore).toBe(8 + 7); // credits 8 (items 1-4) + 2+2+2+1
    expect(stationary.basalStartItem).toBe(5);
    expect(stationary.ceilingItem).toBe(11);
    expect(stationary.standardScoreBand).toBe("Below Average");

    expect(state.domainSums.grossMotor.sum).toBe(7 + 9 + 10);
    expect(state.domainSums.fineMotor.sum).toBe(8 + 11);
    expect(state.domainSums.totalMotor.sum).toBe(45);
    expect(state.quotientBands.grossMotor).toBe("Below Average");
    expect(state.quotientBands.fineMotor).toBe("Average");
    expect(state.quotientBands.totalMotor).toBeNull();
  });

  it("surfaces an age warning when Reflexes is scored for a child over 12 months", () => {
    const state = computeAssessmentState({
      ageInMonths: 24,
      subtests: { reflexes: { itemScores: { 1: 2, 2: 2, 3: 2 } } },
    });
    expect(state.subtests.reflexes!.ageWarning).toMatch(/first year of life/);
    expect(state.warnings.some((w) => w.includes("first year of life"))).toBe(true);
  });

  it("skips subtests with no data and rejects invalid ages", () => {
    const state = computeAssessmentState({ ageInMonths: 24, subtests: {} });
    expect(Object.keys(state.subtests)).toHaveLength(0);
    expect(() => computeAssessmentState({ ageInMonths: 200, subtests: {} })).toThrow(/Invalid chronological age/);
    expect(() => computeAssessmentState({ ageInMonths: -1, subtests: {} })).toThrow(/Invalid chronological age/);
  });

  it("includes a subtest that has only manual entries (no item scores)", () => {
    const state = computeAssessmentState({
      ageInMonths: 24,
      subtests: { grasping: { itemScores: {}, standardScore: 13 } },
    });
    expect(state.subtests.grasping!.standardScoreBand).toBe("Above Average");
    expect(state.subtests.grasping!.rawScore).toBe(0);
    // No age or completeness warnings for a manual-only subtest entry.
    expect(state.warnings).toEqual([]);
  });
});
