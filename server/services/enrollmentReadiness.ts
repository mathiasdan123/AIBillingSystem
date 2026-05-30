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
  missing: string[];
}

/**
 * Compute what's still needed before this practice can submit enrollments.
 * Accepts the legacy single-line `address` as a fallback for the structured
 * fields so already-onboarded practices aren't blocked.
 */
export function computeReadiness(p: any): ProfileReadiness {
  const missing: string[] = [];
  if (!p?.name) missing.push('name');
  const npiValid = isValidNpi(p?.npi);
  if (!p?.npi) missing.push('npi');
  else if (!npiValid) missing.push('npi (invalid — failed checksum)');
  if (!p?.npiType) missing.push('npiType');
  if (!p?.taxId) missing.push('taxId');
  const hasStructuredAddr = p?.addressStreet && p?.addressCity && p?.addressState && p?.addressZip;
  if (!hasStructuredAddr && !p?.address) missing.push('billing address');
  else if (!hasStructuredAddr) missing.push('structured address (street/city/state/zip)');
  if (!p?.billingContactName) missing.push('billingContactName');
  if (!p?.billingContactEmail) missing.push('billingContactEmail');
  if (!p?.taxonomyCode) missing.push('taxonomyCode');
  const authorized = !!p?.enrollmentAuthorizedAt;
  if (!authorized) missing.push('enrollment authorization');
  const hasStediProvider = !!p?.stediProviderId;

  return {
    // "complete" = everything except the Stedi provider record, which is a
    // separate Phase-2 action gated on completeness.
    complete: missing.length === 0,
    npiValid,
    authorized,
    hasStediProvider,
    missing,
  };
}
