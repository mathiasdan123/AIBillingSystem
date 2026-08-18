/**
 * Shared eligibility verification for the interactive endpoints
 * (insurance/eligibility, appointments/:id/check-eligibility,
 * eligibility/batch-verify).
 *
 * Honesty contract — the fix for the "silent fabricating fallbacks" audit
 * finding: a real (non-demo) practice NEVER receives invented benefits data.
 *   - Demo practices (practices.isDemo) get plausible generated numbers so the
 *     seeded demo stays lively. Tagged source: 'demo_mock'.
 *   - No Stedi key configured  → the caller returns 503; nothing is persisted.
 *   - Stedi call fails         → the caller returns 502; nothing fabricated.
 * Fabricated rows are indistinguishable from payer truth once persisted (they
 * feed the front-desk copay display and eligibility alerts), which is why the
 * fallback lives here behind an isDemo check instead of in each route.
 */

import { StediAdapter } from '../payer-integrations/adapters/payers/StediAdapter';
import { stcsForSpecialty, getStediApiKeyForPractice } from './stediService';

export interface EligibilityResult {
  status: string;
  coverageType: string | null;
  effectiveDate: string | null;
  terminationDate: string | null;
  copay: number | string | null | undefined;
  deductible: number | string | null | undefined;
  deductibleMet: number | string | null | undefined;
  outOfPocketMax: number | string | null | undefined;
  outOfPocketMet: number | string | null | undefined;
  coinsurance: number | null | undefined;
  visitsAllowed: number | null | undefined;
  visitsUsed: number | null | undefined;
  authRequired: boolean | null | undefined;
  planName: string | null | undefined;
  source: string;
  [key: string]: any;
}

/** Resolve the Stedi API key for a practice (practice-specific key, else env). */
export async function resolveStediApiKey(practiceId: number): Promise<string | null> {
  const keyInfo = await getStediApiKeyForPractice(practiceId).catch(() => null);
  return keyInfo?.apiKey || process.env.STEDI_API_KEY || null;
}

/**
 * Real 270/271 eligibility check via Stedi. Throws on any transport/payer
 * failure — callers surface that as an error response, never as made-up data.
 */
export async function performStediEligibilityCheck(opts: {
  patient: any;
  insurance: any | null;
  practice: any | null;
  stediApiKey: string;
}): Promise<EligibilityResult> {
  const { patient, insurance, practice, stediApiKey } = opts;

  const adapter = new StediAdapter(stediApiKey);
  const sentStcs = stcsForSpecialty(practice?.specialty ?? null);

  const result = await adapter.checkEligibility({
    providerNpi: practice?.npi || '1234567890',
    providerName: practice?.name || 'Practice',
    memberFirstName: patient.firstName,
    memberLastName: patient.lastName,
    memberDob: patient.dateOfBirth || '',
    memberId: patient.insuranceId || '',
    groupNumber: patient.groupNumber || undefined,
    // An explicit payer ID is authoritative when set; the payerName is then
    // only a last-resort fallback. Precedence: the insurances-catalog row's
    // payerCode, then the patient's own insurancePayerId (written by the
    // payer-search dropdown at intake/edit). Without these the adapter fell
    // back to name matching — and the name map can't distinguish the ~35
    // regional Blue Cross companies, so spelled-out BCBS plans failed with
    // "No trading partner ID found".
    tradingPartnerServiceId: insurance?.payerCode || patient.insurancePayerId || undefined,
    payerName: insurance?.name || patient.insuranceProvider || 'Unknown',
    practiceSpecialty: practice?.specialty ?? null,
  });

  // Infer returned STCs from the normalized benefits shape (the adapter
  // already filters to in-network benefits keyed by service type).
  const returnedStcs: string[] = Array.from(
    new Set(
      Object.keys(result.benefits || {}).filter((k) =>
        ['ot', 'pt', 'st', 'mh', 'ae', 'ad', 'af'].includes(k.toLowerCase()),
      ),
    ),
  );
  const therapySpecificRequested = sentStcs.some((c) => c !== '30');
  const onlyGenericReturned =
    therapySpecificRequested &&
    (returnedStcs.length === 0 || returnedStcs.every((c) => c === '30'));

  return {
    // Three-state, straight from the 271. 'unknown' must stay 'unknown' —
    // collapsing it into 'inactive' told a front desk that coverage "has been
    // terminated" when the payer had actually rejected the request outright.
    status: result.eligibility.status ?? (result.eligibility.isEligible ? 'active' : 'unknown'),
    coverageType: result.eligibility.planType || 'Commercial',
    effectiveDate: result.eligibility.effectiveDate ?? null,
    terminationDate: result.eligibility.terminationDate ?? null,
    copay: result.benefits.copay,
    // Some payers (e.g. Horizon) answer generic STC 30 with FAMILY-level
    // deductible/OOP rows only — fall back to family so the headline number
    // isn't a misleading 0. networkTiers below carries the labeled breakdown.
    deductible: result.benefits.deductible?.individual || result.benefits.deductible?.family,
    deductibleMet: result.benefits.deductible?.individualMet || result.benefits.deductible?.familyMet,
    outOfPocketMax: result.benefits.outOfPocketMax?.individual || result.benefits.outOfPocketMax?.family,
    outOfPocketMet: result.benefits.outOfPocketMax?.individualMet || result.benefits.outOfPocketMax?.familyMet,
    coinsurance: result.benefits.coinsurance,
    networkTiers: result.benefits.networkTiers,
    visitsAllowed: result.benefits.visitsAllowed,
    visitsUsed: result.benefits.visitsUsed,
    authRequired: result.benefits.priorAuthRequired,
    planName: result.eligibility.planName,
    groupNumber: result.eligibility.groupNumber,
    source: 'stedi',
    sentServiceTypeCodes: sentStcs,
    returnedServiceTypeCodes: returnedStcs,
    stcDowngraded: onlyGenericReturned,
    raw: result.raw,
  };
}

/**
 * Generated eligibility for DEMO practices only. Callers must gate on
 * practice.isDemo — never call this for a real practice.
 */
export function generateDemoEligibility(patient: any, insurance: any | null): EligibilityResult {
  const isActive = Math.random() > 0.1;
  const copay = [20, 25, 30, 35, 40, 50][Math.floor(Math.random() * 6)];
  const deductible = [500, 1000, 1500, 2000, 2500][Math.floor(Math.random() * 5)];
  const deductibleMet = Math.floor(Math.random() * deductible);
  const oopMax = [3000, 5000, 6000, 7500, 10000][Math.floor(Math.random() * 5)];
  const oopMet = Math.floor(Math.random() * oopMax * 0.5);

  return {
    status: isActive ? 'active' : 'inactive',
    coverageType: 'Commercial',
    effectiveDate: '2024-01-01',
    terminationDate: null,
    copay,
    deductible,
    deductibleMet,
    outOfPocketMax: oopMax,
    outOfPocketMet: oopMet,
    coinsurance: 20,
    visitsAllowed: 30,
    visitsUsed: Math.floor(Math.random() * 15),
    authRequired: Math.random() > 0.7,
    planName: insurance?.name || patient?.insuranceProvider || 'Standard Plan',
    source: 'demo_mock',
  };
}

export const ELIGIBILITY_NOT_CONFIGURED_MESSAGE =
  'Eligibility verification is not configured for this practice (no clearinghouse API key). ' +
  'No check was run — nothing was saved.';

export const ELIGIBILITY_CHECK_FAILED_MESSAGE =
  'The eligibility check could not be completed. No data was saved — please try again. ' +
  'If this keeps happening, verify the patient’s member ID and payer.';
