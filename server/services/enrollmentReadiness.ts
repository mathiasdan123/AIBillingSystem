/**
 * Enrollment readiness — pure logic, no DB / network imports.
 *
 * Computes what a practice still needs before it can submit payer
 * enrollments (Phase 1, multi-practice enrollment). Kept dependency-free
 * (only npiValidation, which is also pure) so it can be unit-tested without
 * provisioning a database and reused by both the provider-profile route and
 * the cross-practice ops overview.
 */

import { isValidNpi } from './npiValidation';

export interface ProfileReadiness {
  complete: boolean;
  npiValid: boolean;
  authorized: boolean;
  hasStediProvider: boolean;
  /** Human-readable list of what is still needed, in display order. Rendered verbatim by the Provider Profile page. */
  missing: string[];
  /** Machine keys for the same items (practice field names, plus `address` and `enrollmentAuthorization`). */
  missingFields: string[];
}

/**
 * Field key -> label shown to the practice. The readiness list used to push
 * the raw keys ("npiType", "billingContactEmail") straight to the page, which
 * is the first thing a new practice sees on the enrollment path
 * (therapybill-qa #2). Keep the keys stable; change the words here.
 */
export const READINESS_FIELD_LABELS: Record<string, string> = {
  name: 'Practice name',
  npi: 'NPI',
  npiInvalid: 'NPI (invalid: failed checksum)',
  npiType: 'NPI type (individual or organization)',
  taxId: 'Tax ID (EIN)',
  address: 'Billing address',
  addressStructured: 'Structured address (street, city, state, ZIP)',
  billingContactName: 'Billing contact name',
  billingContactEmail: 'Billing contact email',
  taxonomyCode: 'Taxonomy code',
  enrollmentAuthorization: 'Enrollment authorization',
};

/**
 * Compute what's still needed before this practice can submit enrollments.
 * Accepts the legacy single-line `address` as a fallback for the structured
 * fields so already-onboarded practices aren't blocked.
 */
export function computeReadiness(p: any): ProfileReadiness {
  const missingFields: string[] = [];
  if (!p?.name) missingFields.push('name');
  const npiValid = isValidNpi(p?.npi);
  if (!p?.npi) missingFields.push('npi');
  else if (!npiValid) missingFields.push('npiInvalid');
  if (!p?.npiType) missingFields.push('npiType');
  if (!p?.taxId) missingFields.push('taxId');
  const hasStructuredAddr = p?.addressStreet && p?.addressCity && p?.addressState && p?.addressZip;
  if (!hasStructuredAddr && !p?.address) missingFields.push('address');
  else if (!hasStructuredAddr) missingFields.push('addressStructured');
  if (!p?.billingContactName) missingFields.push('billingContactName');
  if (!p?.billingContactEmail) missingFields.push('billingContactEmail');
  if (!p?.taxonomyCode) missingFields.push('taxonomyCode');
  const authorized = !!p?.enrollmentAuthorizedAt;
  if (!authorized) missingFields.push('enrollmentAuthorization');
  const hasStediProvider = !!p?.stediProviderId;

  return {
    // "complete" = everything except the Stedi provider record, which is a
    // separate Phase-2 action gated on completeness.
    complete: missingFields.length === 0,
    npiValid,
    authorized,
    hasStediProvider,
    missing: missingFields.map((k) => READINESS_FIELD_LABELS[k] ?? k),
    missingFields,
  };
}
