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
 * Note: npiNumber/licenseNumber are PHI-encrypted at rest, so in production they
 * reach this predicate as ciphertext — a pure presence check ("is the column
 * non-empty?") is correct and needs no decryption. Because the encryptor maps ''
 * to null, a stored value is always non-empty ciphertext, so `.trim()` is a no-op
 * for those two fields; it only meaningfully filters whitespace from
 * `credentials`, which is plaintext.
 *
 * `credentials` is the weakest of the three signals (free-text, any role can set
 * it). It's included because this step is an onboarding nudge, not a billing
 * gate; NPI / license are the strong "this user renders care" signals.
 */
export function isRenderingClinician(u: ClinicianFields): boolean {
  if (u.role === 'therapist') return true;
  return Boolean(
    (u.npiNumber && u.npiNumber.trim()) ||
      (u.licenseNumber && u.licenseNumber.trim()) ||
      (u.credentials && u.credentials.trim()),
  );
}
