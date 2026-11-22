/**
 * Small pure helpers for the documentation form, kept out of the page so they
 * can be tested without rendering it.
 */

/** Billing units are 15 minutes each. */
export const MINUTES_PER_UNIT = 15;

/**
 * The required inputs still missing before a note can be generated, in the
 * order they appear on the form. Empty when the form is complete.
 */
export function getMissingRequiredFields(input: {
  hasPatient: boolean;
  activityCount: number;
  nextSessionFocus: string;
}): string[] {
  const missing: string[] = [];
  if (!input.hasPatient) missing.push('Patient');
  if (input.activityCount === 0) missing.push('At least one activity');
  if (!input.nextSessionFocus.trim()) missing.push('Next Session Focus');
  return missing;
}

/** "1 unit · 15 min", "3 units · 45 min": minutes always follow from the unit count. */
export function formatUnitsWithMinutes(units: number): string {
  return `${units} ${units === 1 ? 'unit' : 'units'} · ${units * MINUTES_PER_UNIT} min`;
}

/**
 * The line under the suggested codes. The billed minutes are derived from the
 * same unit count shown on each code, so the two cannot disagree, and a
 * difference from the session length is stated rather than hidden.
 */
export function describeBilledUnits(totalUnits: number, sessionMinutes: number): string {
  const billed = totalUnits * MINUTES_PER_UNIT;
  const base = `${totalUnits} billed ${totalUnits === 1 ? 'unit' : 'units'} (${MINUTES_PER_UNIT} min each) = ${billed} min`;
  return billed === sessionMinutes
    ? `${base} · ${sessionMinutes} min session`
    : `${base} of a ${sessionMinutes} min session`;
}
