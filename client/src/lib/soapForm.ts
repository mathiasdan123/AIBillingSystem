/**
 * Small pure helpers for the documentation form, kept out of the page so they
 * can be tested without rendering it.
 */

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

/** "1 unit", "3 units". Units are shown as recorded; no minutes are derived from them. */
export function formatUnits(units: number): string {
  return `${units} ${units === 1 ? 'unit' : 'units'}`;
}

/**
 * The line under the suggested codes: the billed units and the session length
 * as two separate facts. The units come from the billing result and the
 * session length from the form; neither is converted into the other, so a
 * difference between them is never presented as a calculation.
 */
export function describeBilledUnits(totalUnits: number, sessionMinutes: number): string {
  return `${totalUnits} billed ${totalUnits === 1 ? 'unit' : 'units'} · ${sessionMinutes}-minute session`;
}
