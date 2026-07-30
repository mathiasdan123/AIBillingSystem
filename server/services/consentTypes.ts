/**
 * Single source of truth for patient consent type strings, their HIPAA-required
 * purpose/info/recipient text, which types gate PHI access, and which are
 * feature-gated. Previously this lived duplicated (and drifted) across
 * patient-intake.ts and two different hardcoded lists in the storage layer —
 * that drift is what caused patients with real consent records to get
 * wrongly 403'd on PHI routes. Everything that creates or checks a
 * consentType value should import from here instead of hardcoding strings.
 */

export type ConsentSignatureType = 'electronic' | 'wet_ink' | 'verbal' | 'migrated';

export const CONSENT_MAPPINGS: Record<string, { purpose: string; info: string; recipient: string }> = {
  hipaa_privacy_practices: {
    purpose: 'To inform patient/guardian of privacy practices and obtain acknowledgment',
    info: 'Notice of Privacy Practices document',
    recipient: 'Practice records',
  },
  waiver_release: {
    purpose: 'Waiver of liability and release for occupational therapy services',
    info: 'Emergency contact information, liability waiver acknowledgment',
    recipient: 'Practice records and emergency contacts as needed',
  },
  card_authorization: {
    purpose: 'Authorization to charge payment card for services',
    info: 'Payment method authorization for copays, deductibles, and balances',
    recipient: 'Payment processor (Stripe) and practice billing',
  },
  financial_responsibility: {
    purpose: 'Acknowledgment of financial responsibility for services',
    info: 'Financial responsibility agreement',
    recipient: 'Practice billing department',
  },
  // Payer-advocacy consent types (2026-05-31). DRAFT language — must be
  // reviewed/replaced by health-law counsel before going live to real
  // patients (see ~/Desktop/payer-advocacy-attorney-questions.md). These
  // are the legal keys that let the practice (and its billing agent)
  // retrieve benefit data and act as the patient's authorized
  // representative in appeals — the "Sheer for practices" wedge.
  assignment_of_benefits: {
    purpose:
      'Assignment of insurance benefits to the practice for services rendered (DRAFT — pending counsel review)',
    info:
      'Authorization for the health plan to pay benefits directly to the practice, and for the practice and its billing agent to obtain eligibility, coverage, claims, and explanation-of-benefit data for billing-accuracy purposes',
    recipient: 'Patient health plan(s), practice billing, and authorized billing agent',
  },
  authorized_representative: {
    purpose:
      "Designation of the practice and its billing agent as the patient's authorized representative with the health plan, including appeals (DRAFT — pending counsel review)",
    info:
      'Authorization to communicate with the health plan and file appeals on the patient’s behalf regarding claims for services rendered by the practice',
    recipient: 'Patient health plan(s), practice billing, and authorized billing agent',
  },
};

/** Consent types that gate access to PHI routes (server/middleware/consentCheck.ts). */
export const REQUIRED_CONSENT_TYPES = ['hipaa_privacy_practices'];

/** Consent types requiring an explicit practice feature flag before they're signable. */
export const GATED_CONSENT_TYPES = ['assignment_of_benefits', 'authorized_representative'];

export const CONSENT_SIGNATURE_TYPES: ConsentSignatureType[] = ['electronic', 'wet_ink', 'verbal', 'migrated'];
