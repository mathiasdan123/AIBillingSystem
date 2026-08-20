/**
 * Platform CPT catalog — pure data, no database or side-effect imports, so
 * it can be unit-tested and imported anywhere without a live connection.
 */

/**
 * The CPT codes every practice on the platform needs available to bill.
 *
 * Single source of truth: both the first-run reference-data block and the
 * every-boot `ensureCoreCptCodes` backfill read this list, so a code added
 * here reaches new AND existing deployments. Keeping two copies is what
 * caused the original gap (see ensureCoreCptCodes).
 *
 * baseRate is the *billed charge*, not expected reimbursement. These are
 * platform defaults — a practice sets its own fee schedule under Insurance
 * Rates. Treatment codes default to $289.00 and evaluations to $550.00
 * ($400.00 re-eval) to match the rates this list has always carried.
 */
export const CORE_CPT_CODES: Array<{
  code: string;
  description: string;
  category: string;
  baseRate: string;
  billingUnits: number;
}> = [
  // --- Treatment (timed, 15-min units unless noted) ---
  { code: "97110", description: "Therapeutic exercises - strength, ROM, flexibility (15 min)", category: "treatment", baseRate: "289.00", billingUnits: 1 },
  { code: "97112", description: "Neuromuscular reeducation - balance, coordination, posture (15 min)", category: "treatment", baseRate: "289.00", billingUnits: 1 },
  { code: "97140", description: "Manual therapy - mobilization, manipulation (15 min)", category: "treatment", baseRate: "289.00", billingUnits: 1 },
  { code: "97530", description: "Therapeutic activities - functional performance (15 min)", category: "treatment", baseRate: "289.00", billingUnits: 1 },
  { code: "97535", description: "Self-care/ADL training - daily living activities (15 min)", category: "treatment", baseRate: "289.00", billingUnits: 1 },
  { code: "97542", description: "Wheelchair management training (15 min)", category: "treatment", baseRate: "289.00", billingUnits: 1 },
  { code: "97545", description: "Work hardening/conditioning (2 hours)", category: "treatment", baseRate: "289.00", billingUnits: 1 },

  // --- OT evaluation ---
  { code: "97165", description: "OT evaluation - low complexity", category: "evaluation", baseRate: "550.00", billingUnits: 1 },
  { code: "97166", description: "OT evaluation - moderate complexity", category: "evaluation", baseRate: "550.00", billingUnits: 1 },
  { code: "97167", description: "OT evaluation - high complexity", category: "evaluation", baseRate: "550.00", billingUnits: 1 },
  { code: "97168", description: "OT re-evaluation", category: "evaluation", baseRate: "400.00", billingUnits: 1 },

  // --- PT evaluation ---
  { code: "97161", description: "PT evaluation - low complexity", category: "evaluation", baseRate: "550.00", billingUnits: 1 },
  { code: "97162", description: "PT evaluation - moderate complexity", category: "evaluation", baseRate: "550.00", billingUnits: 1 },
  { code: "97163", description: "PT evaluation - high complexity", category: "evaluation", baseRate: "550.00", billingUnits: 1 },
  { code: "97164", description: "PT re-evaluation", category: "evaluation", baseRate: "400.00", billingUnits: 1 },

  // --- SLP evaluation ---
  { code: "92521", description: "SLP evaluation - fluency", category: "evaluation", baseRate: "550.00", billingUnits: 1 },
  { code: "92522", description: "SLP evaluation - sound production", category: "evaluation", baseRate: "550.00", billingUnits: 1 },
  { code: "92523", description: "SLP evaluation - sound production with language", category: "evaluation", baseRate: "550.00", billingUnits: 1 },
  { code: "92524", description: "SLP evaluation - voice and resonance", category: "evaluation", baseRate: "550.00", billingUnits: 1 },

  // --- SLP treatment ---
  // 92507/92508 are untimed, per-session codes (bill 1 unit per encounter,
  // NOT 15-min units like the 97xxx treatment codes above). They are the
  // two most-billed speech codes and were referenced by the therapy-category
  // map long before they existed as rows — that gap meant a speech visit
  // had no code to attach by any route (UI, superbill, or Blanche).
  { code: "92507", description: "Speech/language treatment - individual (per session)", category: "treatment", baseRate: "289.00", billingUnits: 1 },
  { code: "92508", description: "Speech/language treatment - group, 2+ individuals (per session)", category: "treatment", baseRate: "289.00", billingUnits: 1 },
  { code: "92526", description: "Treatment of swallowing dysfunction / feeding (per session)", category: "treatment", baseRate: "289.00", billingUnits: 1 },

  // --- Legacy OT evaluation (pre-2017 codes, some payers still accept) ---
  { code: "97003", description: "Occupational therapy evaluation (legacy)", category: "evaluation", baseRate: "550.00", billingUnits: 1 },
  { code: "97004", description: "Occupational therapy re-evaluation (legacy)", category: "evaluation", baseRate: "400.00", billingUnits: 1 },
];
