/**
 * Pure onboarding-checklist predicates (no DB import, so they're unit-testable).
 */

/** Subset of the users row the rendering-clinician check needs. */
export interface ClinicianFields {
  role?: string | null;
  npiNumber?: string | null;
  licenseNumber?: string | null;
  credentials?: string | null;
}

/**
 * Does this user count as a rendering clinician for the "at least one therapist"
 * onboarding step?
 *
 * True when the user has the `therapist` role OR carries clinical identity — an
 * individual NPI, a license number, or clinical credentials (e.g. "OTR/L",
 * "CCC-SLP"). This is what lets a SOLO practice complete the step: the owner is
 * usually an `admin` who is also the treating provider, so a role-only check
 * (`role === 'therapist'`) could never reach 5/5. A billing-only admin (no NPI /
 * license / credentials) still does not count.
 *
 * Note: npiNumber/licenseNumber are PHI-encrypted at rest, but this is only a
 * presence check (non-empty ciphertext still means "has one"), so no decryption
 * is needed.
 */
export function isRenderingClinician(u: ClinicianFields): boolean {
  if (u.role === 'therapist') return true;
  return Boolean(
    (u.npiNumber && u.npiNumber.trim()) ||
      (u.licenseNumber && u.licenseNumber.trim()) ||
      (u.credentials && u.credentials.trim()),
  );
}
