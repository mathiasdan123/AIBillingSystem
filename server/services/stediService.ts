/**
 * Stedi Healthcare Clearinghouse Integration
 *
 * Handles:
 * - Eligibility verification (270/271)
 * - Claims submission (837P for professional claims)
 * - Claim status inquiries (276/277)
 * - Electronic remittance advice (835)
 */

import type { BenefitTier, NetworkTiers } from '@shared/schema';

// Stedi API base URL (same for test and production — the API key determines the environment)
const STEDI_API_BASE = 'https://healthcare.us.stedi.com/2024-04-01';

// Real Stedi endpoint paths (Change-compatible JSON API). The short paths this
// file originally used — /eligibility-checks, /claims, /claim-status — do not
// exist on Stedi's API and returned NOT_FOUND for every call (observed in
// production 2026-08-18; verified by probe: the paths below answer 401 without
// auth, the short ones answer 404). StediAdapter always used the correct
// eligibility path, which is why the interactive endpoints worked while
// everything routed through this file silently failed.
const STEDI_ELIGIBILITY_PATH = '/change/medicalnetwork/eligibility/v3';
const STEDI_CLAIMS_PATH = '/change/medicalnetwork/professionalclaims/v3/submission';
const STEDI_CLAIM_STATUS_PATH = '/change/medicalnetwork/claimstatus/v2';

// Check if Stedi is configured (globally or for a practice)
export function isStediConfigured(): boolean {
  return !!process.env.STEDI_API_KEY;
}

/**
 * Resolve the Stedi API key for a specific practice.
 * - If practice is in sandbox mode (or has no key), uses the global test key
 * - If practice is in live mode with a key, decrypts and uses the practice's key
 */
export async function getStediApiKeyForPractice(practiceId: number): Promise<{ apiKey: string; isSandbox: boolean }> {
  try {
    const { storage } = await import('../storage');
    const { decryptField } = await import('./phiEncryptionService');
    const practice = await storage.getPractice(practiceId);
    // Live ONLY on an explicit sandboxMode === false.
    //
    // This was `!practice.sandboxMode`, which also treated NULL as live. The
    // column's DB default is true and the Settings toggle renders NULL as
    // Sandbox (`sandboxMode !== false`), so for a legacy row predating the
    // column the UI said "sandbox, nothing is being sent" while this function
    // said "live" and transmitted real 837Ps to real payers under the
    // practice's own NPI. That mismatch is the exact failure the sandbox
    // guard in submitClaim exists to prevent.
    //
    // Unset now means sandbox: an unanswered question resolves to the state
    // that cannot file a claim by accident. Flipping the toggle in Settings
    // writes an explicit false and puts the practice live.
    if (practice && practice.sandboxMode === false) {
      // Live mode — use practice's own key if set, otherwise global production key
      if (practice.stediApiKey) {
        const decryptedKey = typeof practice.stediApiKey === 'string'
          ? practice.stediApiKey
          : decryptField(practice.stediApiKey as any);
        if (decryptedKey) {
          return { apiKey: decryptedKey, isSandbox: false };
        }
      }
      // No practice-specific key — use global key in live mode
      const globalKey = process.env.STEDI_API_KEY;
      if (!globalKey) {
        throw new Error('STEDI_API_KEY environment variable is not configured');
      }
      return { apiKey: globalKey, isSandbox: false };
    }
  } catch {
    // Fall through to global key in sandbox mode
  }

  // Sandbox mode — use global key (test environment)
  const globalKey = process.env.STEDI_API_KEY;
  if (!globalKey) {
    throw new Error('STEDI_API_KEY environment variable is not configured');
  }
  return { apiKey: globalKey, isSandbox: true };
}

// Get headers for Stedi API requests (accepts optional API key override)
function getHeaders(apiKeyOverride?: string): HeadersInit {
  const apiKey = apiKeyOverride || process.env.STEDI_API_KEY;
  if (!apiKey) {
    throw new Error('STEDI_API_KEY environment variable is not configured');
  }
  return {
    'Authorization': `Key ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

// Payer IDs for common insurance companies
export const PAYER_IDS: Record<string, string> = {
  'aetna': '60054',
  'anthem': '00805',
  // Horizon BCBS of New Jersey — must come before the generic 'bcbs' entry so
  // substring matching routes "Horizon Blue Cross Blue Shield NJ" to Horizon.
  'horizon': '22099',
  'bcbs': '00590', // Varies by state
  'cigna': '62308',
  'humana': '61101',
  'kaiser': '91617',
  'medicare': 'CMS',
  'medicaid': 'SKMED', // Varies by state
  'united': '87726',
  'tricare': '99726',
};

/**
 * Eligibility Verification (270/271)
 * Check if a patient has active insurance coverage
 */
export interface EligibilityRequest {
  // Subscriber (primary insurance holder)
  subscriber: {
    memberId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string; // YYYY-MM-DD
  };
  // Patient (if different from subscriber)
  patient?: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    relationshipToSubscriber: 'self' | 'spouse' | 'child' | 'other';
  };
  // Provider info
  provider: {
    npi: string;
    organizationName?: string;
    firstName?: string;
    lastName?: string;
  };
  // Payer info
  payer: {
    id: string; // Payer ID
    name?: string;
  };
  // Service type codes (optional)
  serviceTypeCodes?: string[];
  // Date of service (optional, defaults to today)
  dateOfService?: string;
}

// Practice specialty → Service Type Codes sent on the Stedi 270.
// '30' is always included as a fallback so payers that don't recognize
// the specialty-specific STC still return something useful.
export type PracticeSpecialty = 'OT' | 'PT' | 'ST' | 'MH' | 'MIXED';

export const SPECIALTY_TO_STC: Record<PracticeSpecialty, string[]> = {
  OT: ['AE', '30'],    // AE = Occupational Therapy (X12 STC)
  PT: ['AD', '30'],    // AD = Physical Therapy
  ST: ['AF', '30'],    // AF = Speech Therapy
  MH: ['MH', '30'],    // MH = Mental Health
  MIXED: ['AE', 'AD', 'AF', 'MH', '30'],
};

/**
 * Resolve the STCs to send for a given practice specialty. Null/undefined
 * specialty falls back to MIXED (safe default — payers tolerate multiple
 * STCs on a 270 request).
 */
export function stcsForSpecialty(specialty: string | null | undefined): string[] {
  const key = (specialty || 'MIXED').toUpperCase() as PracticeSpecialty;
  return SPECIALTY_TO_STC[key] ?? SPECIALTY_TO_STC.MIXED;
}

/**
 * Phase 6 — NUCC provider taxonomy defaults per therapy specialty.
 * Used when a practice has not explicitly set `practice.taxonomyCode`.
 * Codes sourced from the current NUCC Health Care Provider Taxonomy
 * (non-pediatric-specific so they match any therapist age focus).
 *
 *   OT  → 225X00000X (Occupational Therapist)
 *   PT  → 225100000X (Physical Therapist)
 *   ST  → 235Z00000X (Speech-Language Pathologist)
 *   MH  → 101YM0800X (Mental Health Counselor)
 *   MIXED → 101YM0800X (preserves pre-Phase-6 behavior — practices that
 *           set specialty=MIXED need to set taxonomyCode explicitly
 *           because there's no "mixed" NUCC code.)
 */
const DEFAULT_TAXONOMY_BY_SPECIALTY: Record<PracticeSpecialty, string> = {
  OT: '225X00000X',
  PT: '225100000X',
  ST: '235Z00000X',
  MH: '101YM0800X',
  MIXED: '101YM0800X',
};

/**
 * Resolve the NUCC taxonomy code for an outgoing 837P claim. Preference:
 *   1. `user.taxonomyCode` — rendering therapist's own override (Slice 2).
 *      Matters for mixed-discipline practices where the OT, PT, and SLP
 *      on staff each file under different taxonomies.
 *   2. `practice.taxonomyCode` — admin-set practice-wide override
 *   3. Specialty-based default from DEFAULT_TAXONOMY_BY_SPECIALTY
 *   4. Final fallback '101YM0800X' — matches pre-Phase-6 behavior so a
 *      misconfigured practice still submits with exactly what it did
 *      before the change. No regression risk for unconfigured practices.
 *
 * Accepts a loose shape so callers can pass plain objects without needing
 * the full Practice/User types.
 *
 * Backward-compat: the single-argument form still works if any caller
 * passes only a practice-like object. The user argument is optional.
 */
export function resolveTaxonomyCode(
  practice: {
    taxonomyCode?: string | null;
    specialty?: string | null;
  } | null | undefined,
  user?: { taxonomyCode?: string | null } | null
): string {
  if (user?.taxonomyCode) return user.taxonomyCode;
  if (practice?.taxonomyCode) return practice.taxonomyCode;
  const key = ((practice?.specialty || 'MIXED').toUpperCase()) as PracticeSpecialty;
  return DEFAULT_TAXONOMY_BY_SPECIALTY[key] ?? '101YM0800X';
}

/**
 * Phase 4 — extract the Service Type Codes the payer actually answered with
 * from a raw Stedi 271 response. Stedi normalizes each benefit entry with a
 * `serviceTypeCodes: string[]` field; we flatten + dedupe across all entries.
 * Returns an empty array if nothing parseable is found (safe for callers).
 */
export function extractReturnedStcsFromRawStediResponse(raw: any): string[] {
  if (!raw) return [];
  const benefits: any[] = Array.isArray(raw.benefitsInformation)
    ? raw.benefitsInformation
    : [];
  const set = new Set<string>();
  for (const b of benefits) {
    const codes = Array.isArray(b?.serviceTypeCodes) ? b.serviceTypeCodes : [];
    for (const c of codes) {
      if (typeof c === 'string' && c.length > 0) set.add(c);
    }
  }
  // Fallback for clients that use the coverageDetails shape (stediService's
  // own parser path) — also handle the `serviceType` singular field.
  const coverage: any[] = Array.isArray(raw.coverageDetails) ? raw.coverageDetails : [];
  for (const d of coverage) {
    if (typeof d?.serviceType === 'string' && d.serviceType.length > 0) {
      set.add(d.serviceType);
    }
  }
  return Array.from(set);
}

/**
 * Phase 4 — detect an STC "downgrade". We asked for therapy-specific STCs
 * (e.g. [AE]=OT) but the payer only answered with generic [30]. Signals
 * that benefits returned are generic, not therapy-specific, and the
 * receptionist/biller should treat visit limits + copays with caution.
 */
export function isStcDowngrade(sent: string[], returned: string[]): boolean {
  const therapySpecificRequested = sent.some((c) => c !== '30');
  if (!therapySpecificRequested) return false;
  if (returned.length === 0) return true;
  return returned.every((c) => c === '30');
}

/**
 * Normalize a 271 EB07 coinsurance value to a whole-number percentage.
 *
 * X12 271 EB07 carries a decimal fraction — 0.5 means 50% — but
 * `eligibility_checks.coinsurance` is an integer column meaning "50 for 50%".
 * Passing the raw fraction straight through made Postgres reject the whole
 * insert with `invalid input syntax for type integer: "0.5"`, so a *successful*
 * eligibility check (real deductible and out-of-pocket figures from the payer)
 * was discarded at the final step and surfaced to the front desk as "Failed to
 * check eligibility". Observed in production 2026-08-06.
 *
 * Values > 1 are passed through rather than multiplied: not every payer honours
 * the spec, and some send 20 meaning 20%. Treating that as 2000% would be worse
 * than the bug being fixed.
 *
 * Ambiguity worth knowing about: a payer sending exactly 1 could mean 1% or
 * 100%. This reads it as 100%, which is the far likelier intent for a
 * coinsurance field — 100% coinsurance (patient pays all) is a real benefit
 * configuration, 1% is not.
 */
export function normalizeCoinsurancePercent(percent: number | null | undefined): number | undefined {
  if (percent === null || percent === undefined) return undefined;
  if (!Number.isFinite(percent) || percent <= 0) return undefined;
  const asPercent = percent <= 1 ? percent * 100 : percent;
  return Math.round(asPercent);
}

/**
 * X12 EB12 (in-plan-network) for a 271 benefit row. Stedi puts the code in
 * `inPlanNetworkIndicatorCode` ('Y'/'N'/'U'/'W') and a human-readable word in
 * `inPlanNetworkIndicator` ("Yes"/"No"/"Not Applicable"). Both parsers used to
 * compare the word against 'N', which never matched — out-of-network rows
 * leaked into the "in-network" summary in production (Horizon, 2026-08-18:
 * the OON family deductible displayed as THE deductible).
 * Returns 'N' only for definitively out-of-network rows; unknown ('U'),
 * not-applicable ('W'), and unlabeled rows are treated as in-network by
 * callers, preserving the long-standing default.
 */
export function networkIndicatorOf(benefit: any): 'Y' | 'N' | 'U' | 'W' | '' {
  const code = String(benefit?.inPlanNetworkIndicatorCode ?? '').toUpperCase();
  if (code === 'Y' || code === 'N' || code === 'U' || code === 'W') return code;
  const text = String(benefit?.inPlanNetworkIndicator ?? '').trim().toLowerCase();
  if (text === 'y' || text === 'yes') return 'Y';
  if (text === 'n' || text === 'no') return 'N';
  if (text === 'u' || text === 'unknown') return 'U';
  if (text === 'w' || text === 'not applicable') return 'W';
  return '';
}

/**
 * Split a 271's benefitsInformation into in-network vs out-of-network
 * cost-sharing tiers. Single source of truth used by BOTH the StediAdapter
 * (live interactive path) and parseDetailedBenefitsResponse — the two
 * parsers diverging is what let the 2026-08-06 coinsurance fix miss the
 * adapter and recur in production on 2026-08-18.
 *
 * Rows labeled 'N' (EB12) go to the outOfNetwork tier; 'Y', unknown ('U'),
 * not-applicable ('W'), and unlabeled rows go to inNetwork, preserving the
 * long-standing default. First value wins per field: payers order rows from
 * general (STC 30) to service-specific, and the generic row is the safer
 * headline number.
 */
export function parseNetworkTiers(benefits: any[]): NetworkTiers {
  type Acc = {
    copay?: number;
    coinsurance?: number;
    ded: { ind?: number; fam?: number; indRem?: number; famRem?: number };
    oop: { ind?: number; fam?: number; indRem?: number; famRem?: number };
    sawCostShare: boolean;
  };
  const makeAcc = (): Acc => ({ ded: {}, oop: {}, sawCostShare: false });
  const inNet = makeAcc();
  const oon = makeAcc();

  for (const benefit of benefits || []) {
    const code = benefit?.code;
    const amount = parseFloat(benefit?.benefitAmount || benefit?.amount || '0');
    const percent = parseFloat(benefit?.benefitPercent || benefit?.percent || '0');
    const tier = networkIndicatorOf(benefit) === 'N' ? oon : inNet;
    const isFamily = (benefit?.coverageLevelCode || benefit?.coverageLevel) === 'FAM';
    // Time qualifier 29 = "Remaining"; anything else is the plan-period total.
    const isRemaining = (benefit?.timeQualifierCode || benefit?.timePeriodQualifier) === '29';

    if (code === 'B' && !isRemaining && amount > 0) {
      tier.copay = tier.copay ?? amount;
      tier.sawCostShare = true;
    } else if (code === 'A' && percent > 0) {
      tier.coinsurance = tier.coinsurance ?? normalizeCoinsurancePercent(percent);
      tier.sawCostShare = true;
    } else if (code === 'C' || code === 'G') {
      const bucket = code === 'C' ? tier.ded : tier.oop;
      if (isRemaining) {
        if (isFamily) bucket.famRem = bucket.famRem ?? amount;
        else bucket.indRem = bucket.indRem ?? amount;
      } else if (amount > 0) {
        if (isFamily) bucket.fam = bucket.fam ?? amount;
        else bucket.ind = bucket.ind ?? amount;
        tier.sawCostShare = true;
      }
    }
  }

  // "Met" derives from the payer's remaining rows: met = total − remaining.
  // When only a remaining row exists (no total), met stays undefined.
  const met = (total?: number, remaining?: number) =>
    total !== undefined && remaining !== undefined ? Math.max(0, total - remaining) : undefined;
  const finalize = (acc: Acc): BenefitTier => ({
    copay: acc.copay,
    coinsurance: acc.coinsurance,
    deductible: {
      individual: acc.ded.ind,
      individualMet: met(acc.ded.ind, acc.ded.indRem),
      family: acc.ded.fam,
      familyMet: met(acc.ded.fam, acc.ded.famRem),
    },
    outOfPocketMax: {
      individual: acc.oop.ind,
      individualMet: met(acc.oop.ind, acc.oop.indRem),
      family: acc.oop.fam,
      familyMet: met(acc.oop.fam, acc.oop.famRem),
    },
  });

  return {
    inNetwork: finalize(inNet),
    outOfNetwork: finalize(oon),
    hasOutOfNetworkBenefits: oon.sawCostShare,
  };
}

export interface EligibilityResponse {
  status: 'active' | 'inactive' | 'unknown';
  raw: any;
  planName?: string;
  planNumber?: string;
  groupNumber?: string;
  effectiveDate?: string;
  terminationDate?: string;
  copay?: {
    primary?: number;
    specialist?: number;
    urgentCare?: number;
    emergency?: number;
  };
  deductible?: {
    individual?: number;
    family?: number;
    remaining?: number;
  };
  outOfPocketMax?: {
    individual?: number;
    family?: number;
    remaining?: number;
  };
  coinsurance?: number; // percentage — see normalizeCoinsurancePercent
  coverageDetails?: Array<{
    serviceType: string;
    coverage: string;
    inNetwork: boolean;
    limitations?: string;
  }>;
  // Phase 2 — STC audit fields
  /** STCs we actually sent on the 270 for this check (resolved from the
   *  practice specialty unless the caller overrode). */
  sentServiceTypeCodes?: string[];
  /** STCs the payer returned on the 271. */
  returnedServiceTypeCodes?: string[];
  /** True if we asked for a therapy-specific STC (AE/AD/AF/MH) and the
   *  payer only answered with generic 30. Surfaced in the UI so the
   *  receptionist knows benefits are generic, not therapy-specific. */
  stcDowngraded?: boolean;
  errors?: string[];
}

export async function checkEligibility(request: EligibilityRequest, practiceId?: number): Promise<EligibilityResponse> {
  const stediKey = practiceId ? await getStediApiKeyForPractice(practiceId) : undefined;

  // Resolve STCs: explicit request.serviceTypeCodes wins, else derive from
  // the practice's specialty (Phase 2). Falls back to generic '30' if neither
  // is available — keeps legacy call sites working until they're migrated.
  let resolvedStcs: string[] = request.serviceTypeCodes ?? [];
  if (resolvedStcs.length === 0 && practiceId) {
    try {
      const { storage } = await import('../storage');
      const practice = await (storage as any).getPractice?.(practiceId);
      if (practice?.specialty) {
        resolvedStcs = stcsForSpecialty(practice.specialty);
      }
    } catch {
      // storage unavailable during tests — silently fall through
    }
  }
  if (resolvedStcs.length === 0) {
    resolvedStcs = ['30'];
  }

  const payload = {
    controlNumber: generateControlNumber(),
    tradingPartnerServiceId: request.payer.id,
    provider: {
      organizationName: request.provider.organizationName,
      npi: request.provider.npi,
      ...(request.provider.firstName && {
        firstName: request.provider.firstName,
        lastName: request.provider.lastName,
      }),
    },
    subscriber: {
      memberId: request.subscriber.memberId,
      firstName: request.subscriber.firstName,
      lastName: request.subscriber.lastName,
      dateOfBirth: request.subscriber.dateOfBirth,
    },
    ...(request.patient && request.patient.relationshipToSubscriber !== 'self' && {
      dependent: {
        firstName: request.patient.firstName,
        lastName: request.patient.lastName,
        dateOfBirth: request.patient.dateOfBirth,
        relationshipCode: getRelationshipCode(request.patient.relationshipToSubscriber),
      },
    }),
    encounter: {
      serviceTypeCodes: resolvedStcs,
      dateOfService: request.dateOfService || new Date().toISOString().split('T')[0],
    },
  };

  try {
    const response = await fetch(`${STEDI_API_BASE}${STEDI_ELIGIBILITY_PATH}`, {
      method: 'POST',
      headers: getHeaders(stediKey?.apiKey),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Stedi eligibility error:', error);
      return {
        status: 'unknown',
        raw: error,
        errors: [error.message || 'Failed to check eligibility'],
      };
    }

    const data = await response.json();
    const parsed = parseEligibilityResponse(data);

    // Phase 2: attach STC audit metadata. Read the service-type codes straight
    // from the raw 271 (`benefitsInformation[].serviceTypeCodes`) via the shared
    // helper. The realtime path's parser (parseEligibilityResponse) never sets
    // `parsed.coverageDetails` — only the separate detailed-benefits parser
    // does — so reading that here always yielded [] and flagged EVERY check as
    // stcDowngraded, turning the "payer only returned generic benefits" warning
    // into noise.
    const returnedStcs = extractReturnedStcsFromRawStediResponse(data);
    const therapySpecificRequested = resolvedStcs.some((c) => c !== '30');
    const onlyGenericReturned =
      therapySpecificRequested &&
      (returnedStcs.length === 0 || returnedStcs.every((c) => c === '30'));

    parsed.sentServiceTypeCodes = resolvedStcs;
    parsed.returnedServiceTypeCodes = returnedStcs;
    parsed.stcDowngraded = onlyGenericReturned;
    return parsed;
  } catch (error: any) {
    console.error('Stedi eligibility error:', error);
    return {
      status: 'unknown',
      raw: null,
      errors: [error.message || 'Network error checking eligibility'],
    };
  }
}

/**
 * Claims Submission (837P - Professional)
 */
export interface ClaimSubmission {
  // Claim info
  claimId: string;
  totalAmount: number;
  placeOfService: string; // '11' = office, '12' = home, etc.
  dateOfService: string;

  // Patient info
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    gender: 'M' | 'F' | 'U';
    address: {
      line1: string;
      line2?: string;
      city: string;
      state: string;
      zip: string;
    };
    memberId: string;
  };

  // Subscriber (if different from patient)
  subscriber?: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    memberId: string;
    relationshipToPatient: string;
  };

  // Provider info
  provider: {
    npi: string;
    taxId: string;
    organizationName?: string;
    firstName?: string;
    lastName?: string;
    address: {
      line1: string;
      city: string;
      state: string;
      zip: string;
    };
    // Phase 6 — explicit NUCC taxonomy on the claim. If not set,
    // resolveTaxonomyCode() in build837P falls back in this order:
    //   user (renderingProviderTaxonomy) → practice (practiceTaxonomy)
    //   → specialty default → legacy fallback.
    taxonomy?: string;
    renderingProviderTaxonomy?: string | null;
    practiceTaxonomy?: string | null;
    practiceSpecialty?: string | null;
  };

  // Payer info
  payer: {
    id: string;
    name: string;
  };

  // Service lines
  serviceLines: Array<{
    procedureCode: string;
    modifiers?: string[];
    diagnosisCodes: string[];
    amount: number;
    units: number;
    dateOfService: string;
    description?: string;
  }>;

  // Diagnosis codes (ICD-10)
  diagnosisCodes: string[];

  // Prior authorization number (if applicable)
  priorAuthNumber?: string;

  // Phase 3 — when set AND the practice has strictStcValidation enabled,
  // the 837P envelope will include these STCs on the encounter/claim
  // information block so payers can match the service type to the
  // eligibility check that preceded this claim. Pull these from the
  // patient's most-recent eligibility check before calling submitClaim.
  serviceTypeCodes?: string[];
  strictStcValidation?: boolean;
  // True when this claim is being sent as a correction/replacement (i.e. it
  // was previously denied or rejected, the biller fixed something via the
  // reopen flow, and we're now resubmitting). Drives claimFrequencyCode
  // in the 837P envelope: '7' (replacement) instead of '1' (original).
  // Set this from claims.resubmissionCount > 0 in the calling route.
  isResubmission?: boolean;
}

export interface ClaimSubmissionResponse {
  success: boolean;
  claimId: string;
  stediClaimId?: string;
  status: 'accepted' | 'rejected' | 'pending';
  raw: any;
  errors?: string[];
  warnings?: string[];
}

export async function submitClaim(
  claim: ClaimSubmission,
  practiceId?: number,
  options: { testMode?: boolean } = {},
): Promise<ClaimSubmissionResponse> {
  const { testMode = false } = options;
  const stediKey = practiceId ? await getStediApiKeyForPractice(practiceId) : undefined;

  // Sandbox mode must actually mean sandbox. Settings tells the practice
  // "Claims are sent to a test environment. No real submissions to insurance
  // companies" — but sandbox resolved to the SAME global production key, and
  // isSandbox was read nowhere, so a practice that believed it was testing
  // would file real 837Ps to real payers under its own NPI. Refuse instead.
  // A TEST claim is exempt: usageIndicator 'T' means Stedi's test
  // clearinghouse handles it and never forwards it to the payer, which is
  // precisely what a sandbox practice should be able to do. Blocking it here
  // would leave sandbox mode with no way to test anything, which is the
  // opposite of its purpose.
  if (stediKey?.isSandbox && !testMode) {
    return {
      success: false,
      claimId: claim.claimId,
      status: 'rejected',
      raw: null,
      errors: [
        'This practice is in Sandbox Mode, so the claim was not transmitted. ' +
          'Switch to Live Mode in Settings → Clearinghouse when you are ready to send real claims.',
      ],
    };
  }

  // No practiceId means we cannot tell sandbox from live. Refuse rather than
  // fall through to the global production key on an unknown practice.
  if (!practiceId) {
    return {
      success: false,
      claimId: claim.claimId,
      status: 'rejected',
      raw: null,
      errors: ['Internal error: claim submission attempted without a practice context.'],
    };
  }

  const payload = build837P(claim, testMode);

  try {
    const response = await fetch(`${STEDI_API_BASE}${STEDI_CLAIMS_PATH}`, {
      method: 'POST',
      headers: getHeaders(stediKey?.apiKey),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Stedi claim submission error:', error);
      return {
        success: false,
        claimId: claim.claimId,
        status: 'rejected',
        raw: error,
        errors: [error.message || 'Failed to submit claim'],
      };
    }

    const data = await response.json();

    // A 2xx does NOT mean the clearinghouse accepted the claim — edit-level
    // rejections come back with a success HTTP status and the detail in the
    // body. Treating every 2xx as 'accepted' reported rejected claims as
    // submitted, so nobody looked at them again until the timely-filing
    // window had closed.
    const bodyErrors: string[] = [];
    if (Array.isArray(data?.errors)) {
      bodyErrors.push(...data.errors.map((e: any) => (typeof e === 'string' ? e : e?.message ?? JSON.stringify(e))));
    } else if (typeof data?.errors === 'string') {
      bodyErrors.push(data.errors);
    }
    if (typeof data?.error === 'string') bodyErrors.push(data.error);

    const statusText = String(data?.status ?? data?.claimStatus ?? '').toLowerCase();
    const statusRejected = /reject|denied|error|fail/.test(statusText);
    const stediClaimId = data?.claimId || data?.id;

    if (bodyErrors.length > 0 || statusRejected || data?.success === false) {
      return {
        success: false,
        claimId: claim.claimId,
        stediClaimId,
        status: 'rejected',
        raw: data,
        errors: bodyErrors.length
          ? bodyErrors
          : [`Clearinghouse rejected the claim${statusText ? ` (status: ${statusText})` : ''}`],
      };
    }

    // Accepted responses carry an identifier we can track the claim by. No
    // identifier and no error means we cannot confirm it was accepted — say
    // so rather than assert success we can't back up.
    if (!stediClaimId) {
      return {
        success: false,
        claimId: claim.claimId,
        status: 'pending',
        raw: data,
        errors: [
          'Clearinghouse returned no claim identifier — submission could not be confirmed. ' +
            'Check the clearinghouse portal before resubmitting to avoid a duplicate.',
        ],
      };
    }

    return {
      success: true,
      claimId: claim.claimId,
      stediClaimId,
      status: 'accepted',
      raw: data,
      warnings: Array.isArray(data?.warnings)
        ? data.warnings.map((w: any) => (typeof w === 'string' ? w : w?.message ?? JSON.stringify(w)))
        : undefined,
    };
  } catch (error: any) {
    console.error('Stedi claim submission error:', error);
    return {
      success: false,
      claimId: claim.claimId,
      status: 'rejected',
      raw: null,
      errors: [error.message || 'Network error submitting claim'],
    };
  }
}

/**
 * Claim Status Inquiry (276/277)
 */
export interface ClaimStatusRequest {
  claimId: string;
  payer: {
    id: string;
  };
  provider: {
    npi: string;
    taxId?: string;
  };
  subscriber: {
    memberId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
  };
  dateOfService: string;
  claimAmount?: number;
}

/**
 * Narrow internal status buckets used by downstream workflows (claim update,
 * notifications, analytics). A finer-grained `statusCategoryCode` is also
 * surfaced alongside so the UI can distinguish "rejected for invalid data"
 * from "rejected for relational error" — both bucket to 'rejected' here.
 */
export type ClaimStatusBucket =
  | 'received'                    // A0/A1/A2 — acknowledged, not yet acted on
  | 'pending'                     // P0-P5 — payer still working it
  | 'returned_for_correction'     // A3 — needs resubmission
  | 'rejected_invalid_data'       // A7 — fixable data problem
  | 'rejected_relational_error'   // A8 — fixable relational problem
  | 'rejected'                    // A4/A6/R/generic rejection
  | 'paid'                        // F1/F2
  | 'finalized_denied'            // F4/D0/D1
  | 'error_submission'            // E0-E4 — our submission, not payer's decision
  | 'unknown';

export interface ClaimStatusResponse {
  claimId: string;
  status: ClaimStatusBucket;
  statusCode?: string;
  statusDescription?: string;
  /** X12 277CA category code (e.g. "A1", "A7", "F1"). */
  statusCategoryCode?: string;
  /** Human-readable label corresponding to statusCategoryCode. */
  statusCategoryValue?: string;
  paidAmount?: number;
  paidDate?: string;
  checkNumber?: string;
  denialReason?: string;
  raw: any;
  errors?: string[];
}

// practiceId is REQUIRED, not optional. It was optional, and four of the five
// call sites simply omitted it — the 4-hourly status cron included — so
// getHeaders fell through to the global STEDI_API_KEY and every practice's 276
// went out under the platform key rather than its own. An optional argument
// that must always be passed is not a safeguard; the type is.
export async function checkClaimStatus(request: ClaimStatusRequest, practiceId: number): Promise<ClaimStatusResponse> {
  const stediKey = await getStediApiKeyForPractice(practiceId);
  const payload = {
    controlNumber: generateControlNumber(),
    tradingPartnerServiceId: request.payer.id,
    provider: {
      npi: request.provider.npi,
      taxId: request.provider.taxId,
    },
    subscriber: {
      memberId: request.subscriber.memberId,
      firstName: request.subscriber.firstName,
      lastName: request.subscriber.lastName,
      dateOfBirth: request.subscriber.dateOfBirth,
    },
    claimInformation: {
      patientControlNumber: request.claimId,
      dateOfService: request.dateOfService,
      ...(request.claimAmount && { claimAmount: request.claimAmount }),
    },
  };

  try {
    const response = await fetch(`${STEDI_API_BASE}${STEDI_CLAIM_STATUS_PATH}`, {
      method: 'POST',
      headers: getHeaders(stediKey?.apiKey),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        claimId: request.claimId,
        status: 'unknown',
        raw: error,
        errors: [error.message || 'Failed to check claim status'],
      };
    }

    const data = await response.json();
    return parseClaimStatusResponse(request.claimId, data);
  } catch (error: any) {
    return {
      claimId: request.claimId,
      status: 'unknown',
      raw: null,
      errors: [error.message || 'Network error checking claim status'],
    };
  }
}

// Helper functions

function generateControlNumber(): string {
  return `${Date.now()}${Math.random().toString(36).substring(2, 8)}`.toUpperCase();
}

function getRelationshipCode(relationship: string): string {
  const codes: Record<string, string> = {
    'self': '18',
    'spouse': '01',
    'child': '19',
    'other': '21',
  };
  return codes[relationship] || '21';
}

function parseEligibilityResponse(data: any): EligibilityResponse {
  // Parse the 271 response from Stedi
  // This is a simplified parser - real implementation would be more comprehensive

  const response: EligibilityResponse = {
    status: 'unknown',
    raw: data,
  };

  try {
    // Check for active coverage
    const benefitsInfo = data.benefitsInformation || [];
    const activeBenefit = benefitsInfo.find((b: any) =>
      b.code === '1' || b.informationCode === 'A' // Active coverage
    );

    if (activeBenefit) {
      response.status = 'active';
    } else {
      const inactiveBenefit = benefitsInfo.find((b: any) =>
        b.code === '6' || b.informationCode === 'I' // Inactive
      );
      if (inactiveBenefit) {
        response.status = 'inactive';
      }
    }

    // Extract plan info
    const planInfo = data.planInformation || {};
    response.planName = planInfo.planName || data.planName;
    response.planNumber = planInfo.planNumber || data.planNumber;
    response.groupNumber = planInfo.groupNumber || data.groupNumber;

    // Extract dates
    response.effectiveDate = data.planDateInformation?.planBegin;
    response.terminationDate = data.planDateInformation?.planEnd;

    // Extract copay info
    const copays: any = {};
    benefitsInfo.forEach((benefit: any) => {
      if (benefit.code === 'B' && benefit.amount) { // Copay
        const serviceType = benefit.serviceTypeCode || benefit.serviceType;
        if (serviceType === '98') copays.primary = benefit.amount; // Professional
        if (serviceType === 'AL') copays.specialist = benefit.amount; // Specialist
        if (serviceType === 'UC') copays.urgentCare = benefit.amount; // Urgent care
        if (serviceType === 'ER') copays.emergency = benefit.amount; // Emergency
      }
    });
    if (Object.keys(copays).length > 0) {
      response.copay = copays;
    }

    // Extract deductible info
    const deductibleBenefit = benefitsInfo.find((b: any) => b.code === 'C');
    if (deductibleBenefit) {
      response.deductible = {
        individual: deductibleBenefit.amount,
        remaining: deductibleBenefit.remainingAmount,
      };
    }

    // Extract out-of-pocket max
    const oopBenefit = benefitsInfo.find((b: any) => b.code === 'G');
    if (oopBenefit) {
      response.outOfPocketMax = {
        individual: oopBenefit.amount,
        remaining: oopBenefit.remainingAmount,
      };
    }

    // Extract coinsurance
    const coinsuranceBenefit = benefitsInfo.find((b: any) => b.code === 'A' && b.percent);
    if (coinsuranceBenefit) {
      response.coinsurance = normalizeCoinsurancePercent(coinsuranceBenefit.percent);
    }

  } catch (error) {
    console.error('Error parsing eligibility response:', error);
  }

  return response;
}

/**
 * X12 277CA health care claim status category codes. Every code practices
 * actually see from Stedi is represented here — no more fall-through to
 * "unknown" for common rejection codes.
 *
 * Source: ASC X12 277 CAT03 / HL7 v2 Claim Status Category values.
 */
const STATUS_CATEGORY_MAP: Record<
  string,
  { bucket: ClaimStatusBucket; label: string }
> = {
  // Acknowledgement
  A0: { bucket: 'received', label: 'Acknowledgement / Forwarded' },
  A1: { bucket: 'received', label: 'Acknowledgement / Receipt' },
  A2: { bucket: 'received', label: 'Acknowledgement / Accepted for processing' },
  A3: { bucket: 'returned_for_correction', label: 'Acknowledgement / Returned as unprocessable' },
  A4: { bucket: 'rejected', label: 'Acknowledgement / Not found' },
  A5: { bucket: 'rejected', label: 'Acknowledgement / Split claim' },
  A6: { bucket: 'rejected', label: 'Acknowledgement / Rejected for missing information' },
  A7: { bucket: 'rejected_invalid_data', label: 'Acknowledgement / Rejected for invalid data' },
  A8: { bucket: 'rejected_relational_error', label: 'Acknowledgement / Rejected for relational field in error' },

  // Pending
  P0: { bucket: 'pending', label: 'Pending / Adjudication' },
  P1: { bucket: 'pending', label: 'Pending / In Process' },
  P2: { bucket: 'pending', label: 'Pending / Payer Review' },
  P3: { bucket: 'pending', label: 'Pending / Provider Requested Information' },
  P4: { bucket: 'pending', label: 'Pending / Patient Requested Information' },
  P5: { bucket: 'pending', label: 'Pending / Medical Review' },

  // Finalized
  F0: { bucket: 'finalized_denied', label: 'Finalized / Forwarded' },
  F1: { bucket: 'paid', label: 'Finalized / Payment complete' },
  F2: { bucket: 'paid', label: 'Finalized / Partial payment' },
  F3: { bucket: 'paid', label: 'Finalized / Revised' },
  F3F: { bucket: 'paid', label: 'Finalized / Adjudication complete' },
  F4: { bucket: 'finalized_denied', label: 'Finalized / Denied' },

  // Errors (our submission had a problem, not the payer's coverage decision)
  E0: { bucket: 'error_submission', label: 'Response not possible — system status' },
  E1: { bucket: 'error_submission', label: 'Response not possible — payer status' },
  E2: { bucket: 'error_submission', label: 'Information holder is not a payer' },
  E3: { bucket: 'error_submission', label: 'Correction required — relational data error' },
  E4: { bucket: 'error_submission', label: 'Trading partner agreement specific' },

  // Legacy codes that may still appear from older Stedi responses
  R: { bucket: 'rejected', label: 'Rejected' },
  D0: { bucket: 'finalized_denied', label: 'Denied' },
  D1: { bucket: 'finalized_denied', label: 'Denied / Post-adjudication' },
};

function parseClaimStatusResponse(claimId: string, data: any): ClaimStatusResponse {
  const response: ClaimStatusResponse = {
    claimId,
    status: 'unknown',
    raw: data,
  };

  try {
    const statusInfo = data.claimStatus || data;

    // Read the X12 277CA field names explicitly. Stedi's normalized response
    // may put these under `healthCareClaimStatusCategoryCode` +
    // `...CategoryCodeValue` (the X12 spec names) or fall back to the older
    // generic fields that earlier versions of this code used.
    const statusCategoryCode: string | undefined =
      statusInfo.healthCareClaimStatusCategoryCode
      ?? statusInfo.statusCategoryCode
      ?? statusInfo.categoryCode
      ?? statusInfo.code;

    const statusCategoryValue: string | undefined =
      statusInfo.healthCareClaimStatusCategoryCodeValue
      ?? statusInfo.statusCategoryCodeValue
      ?? statusInfo.categoryCodeValue;

    const mapped = statusCategoryCode ? STATUS_CATEGORY_MAP[statusCategoryCode] : undefined;

    response.status = mapped?.bucket ?? 'unknown';
    response.statusCode = statusCategoryCode;
    response.statusCategoryCode = statusCategoryCode;
    // Prefer the payer-returned value, then our label table, then finally the
    // raw description — whichever is most informative to the receptionist.
    response.statusCategoryValue = statusCategoryValue ?? mapped?.label;
    response.statusDescription =
      statusInfo.statusDescription ?? statusInfo.message ?? response.statusCategoryValue;

    if (response.status === 'paid') {
      response.paidAmount = statusInfo.paidAmount || statusInfo.amount;
      response.paidDate = statusInfo.paidDate;
      response.checkNumber = statusInfo.checkNumber || statusInfo.referenceNumber;
    }

    if (response.status === 'finalized_denied') {
      response.denialReason = statusInfo.denialReason || statusInfo.message || response.statusCategoryValue;
    }

    if (
      response.status === 'rejected' ||
      response.status === 'rejected_invalid_data' ||
      response.status === 'rejected_relational_error' ||
      response.status === 'returned_for_correction'
    ) {
      // Surface rejection reason (fixable) so the UI can show a "Fix Required" badge.
      response.denialReason = statusInfo.denialReason || statusInfo.message || response.statusCategoryValue;
    }
  } catch (error) {
    console.error('Error parsing claim status response:', error);
  }

  return response;
}

export function build837P(claim: ClaimSubmission, testMode = false): any {
  // Build the 837P claim payload for Stedi
  // This is a simplified version - real implementation would be more comprehensive

  return {
    controlNumber: generateControlNumber(),
    // ISA15. Stedi's rule: "all API claim submissions are sent as production
    // claims unless you explicitly designate them as test data." This field
    // did not exist anywhere in the codebase, which meant there was no way to
    // rehearse a claim — the FIRST 837P a practice ever sent was a real one to
    // a real payer, on a code path that had never once succeeded. 'T' routes
    // to Stedi's test clearinghouse, which returns a 277CA and never forwards
    // to the payer.
    usageIndicator: testMode ? 'T' : 'P',
    tradingPartnerServiceId: claim.payer.id,
    submitter: {
      organizationName: claim.provider.organizationName,
      contactInformation: {
        name: claim.provider.organizationName || `${claim.provider.firstName} ${claim.provider.lastName}`,
        phoneNumber: '0000000000', // Should be from practice settings
      },
    },
    receiver: {
      organizationName: claim.payer.name,
    },
    subscriber: {
      memberId: claim.subscriber?.memberId || claim.patient.memberId,
      firstName: claim.subscriber?.firstName || claim.patient.firstName,
      lastName: claim.subscriber?.lastName || claim.patient.lastName,
      dateOfBirth: claim.subscriber?.dateOfBirth || claim.patient.dateOfBirth,
      address: claim.patient.address,
    },
    ...(claim.subscriber && {
      patient: {
        firstName: claim.patient.firstName,
        lastName: claim.patient.lastName,
        dateOfBirth: claim.patient.dateOfBirth,
        gender: claim.patient.gender,
        address: claim.patient.address,
        relationshipToSubscriberCode: getRelationshipCode(claim.subscriber.relationshipToPatient),
      },
    }),
    billing: {
      npi: claim.provider.npi,
      // Phase 6 — per-claim override wins; otherwise resolve from user → practice.
      // Was hardcoded to 101YM0800X (Mental Health Counselor) for every claim
      // regardless of actual discipline — soft-deny risk on therapy CPTs.
      // Billing block uses the practice-level default (not the rendering user)
      // because the billing entity IS the practice, not the provider.
      taxonomyCode: claim.provider.taxonomy || resolveTaxonomyCode({
        taxonomyCode: claim.provider.practiceTaxonomy,
        specialty: claim.provider.practiceSpecialty,
      }),
      organizationName: claim.provider.organizationName,
      address: claim.provider.address,
      taxId: claim.provider.taxId,
    },
    rendering: {
      npi: claim.provider.npi,
      // Rendering block is the actual therapist — their own taxonomy wins
      // if set (Slice 2), then practice-level, then specialty default.
      taxonomyCode: claim.provider.taxonomy || resolveTaxonomyCode(
        {
          taxonomyCode: claim.provider.practiceTaxonomy,
          specialty: claim.provider.practiceSpecialty,
        },
        { taxonomyCode: claim.provider.renderingProviderTaxonomy }
      ),
      firstName: claim.provider.firstName,
      lastName: claim.provider.lastName,
    },
    claimInformation: {
      patientControlNumber: claim.claimId,
      claimChargeAmount: claim.totalAmount.toString(),
      placeOfServiceCode: claim.placeOfService,
      // 837P claim frequency per X12:
      //   '1' = original (first submission of this claim)
      //   '7' = replacement (payer should replace the prior claim with this one)
      // After a reopen-and-fix cycle we bump to '7' so payers treat it as a
      // correction, not a duplicate. Determined by the caller via
      // `claim.isResubmission` (set from claims.resubmissionCount > 0 at the
      // route layer). Default to '1' for original submissions.
      claimFrequencyCode: claim.isResubmission ? '7' : '1',
      signatureIndicator: 'Y',
      planParticipationCode: 'A', // Assigned
      releaseOfInformationCode: 'Y',
      diagnosisCodes: claim.diagnosisCodes.map((code, index) => ({
        code,
        type: 'ABK', // ICD-10
        pointer: index + 1,
      })),
      ...(claim.priorAuthNumber && {
        priorAuthorizationNumber: claim.priorAuthNumber,
      }),
      // Phase 3 — only include STCs on the envelope when the practice
      // has explicitly opted into strict STC validation. Off by default
      // so the payload shape stays unchanged for practices that haven't
      // tested the envelope field yet.
      ...(claim.strictStcValidation &&
          Array.isArray(claim.serviceTypeCodes) &&
          claim.serviceTypeCodes.length > 0 && {
            serviceTypeCodes: claim.serviceTypeCodes,
          }),
    },
    serviceLines: claim.serviceLines.map((line, index) => ({
      serviceLineNumber: index + 1,
      procedureCode: line.procedureCode,
      procedureModifiers: line.modifiers || [],
      chargeAmount: line.amount.toString(),
      unitCount: line.units.toString(),
      serviceDate: line.dateOfService,
      diagnosisCodePointers: line.diagnosisCodes.map((_, i) => i + 1),
      description: line.description,
    })),
  };
}

/**
 * Payer Crosswalk Routing
 *
 * Resolves the correct trading partner ID for a claim by checking the patient's
 * insurance plan name against the payer crosswalk table. This handles cases where
 * insurance companies have subsidiaries (e.g., Aetna Better Health vs Aetna CVS Health)
 * that require different payer IDs for claim submission.
 */
export interface PayerRoutingResult {
  tradingPartnerId: string;
  matchedSubPlan: string | null;
  routingSource: 'crosswalk' | 'static_map' | 'insurance_record' | 'default';
}

export async function resolvePayerId(
  insuranceName: string,
  patientInsuranceProvider: string | null,
  insurancePayerCode: string | null,
): Promise<PayerRoutingResult> {
  const normalizedInsuranceName = insuranceName?.toLowerCase().trim() || '';
  const normalizedPatientPlan = patientInsuranceProvider?.toLowerCase().trim() || '';

  // 1. Try crosswalk table first — match patient's plan name against sub-plan keywords
  try {
    const { getDb } = await import('../db');
    const { payerCrosswalk } = await import('../../shared/schema');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();

    const crosswalkEntries = await db
      .select()
      .from(payerCrosswalk)
      .where(eq(payerCrosswalk.isActive, true));

    // Check patient's insurance provider name against sub-plan keywords
    const searchText = normalizedPatientPlan || normalizedInsuranceName;
    for (const entry of crosswalkEntries) {
      const keywords = (entry.subPlanKeywords as string[]) || [];
      const subPlanLower = entry.subPlanName.toLowerCase();

      // Exact sub-plan name match
      if (searchText === subPlanLower || searchText.includes(subPlanLower)) {
        return {
          tradingPartnerId: entry.tradingPartnerId,
          matchedSubPlan: entry.subPlanName,
          routingSource: 'crosswalk',
        };
      }

      // Keyword match
      for (const keyword of keywords) {
        if (searchText.includes(keyword.toLowerCase())) {
          return {
            tradingPartnerId: entry.tradingPartnerId,
            matchedSubPlan: entry.subPlanName,
            routingSource: 'crosswalk',
          };
        }
      }
    }
  } catch (error) {
    // If crosswalk lookup fails, fall through to static map
    console.error('Payer crosswalk lookup failed, falling back to static map:', error);
  }

  // 2. Fall back to static PAYER_IDS map
  if (PAYER_IDS[normalizedInsuranceName]) {
    return {
      tradingPartnerId: PAYER_IDS[normalizedInsuranceName],
      matchedSubPlan: null,
      routingSource: 'static_map',
    };
  }

  // 3. Fall back to insurance record's payerCode
  if (insurancePayerCode) {
    return {
      tradingPartnerId: insurancePayerCode,
      matchedSubPlan: null,
      routingSource: 'insurance_record',
    };
  }

  // 4. Default fallback
  return {
    tradingPartnerId: '00000',
    matchedSubPlan: null,
    routingSource: 'default',
  };
}

/**
 * Detailed Benefits Verification
 *
 * Enhanced eligibility check that returns therapy-specific visit limits,
 * complete financial details, and plan classification.
 */

export interface DetailedBenefits {
  // Plan status
  planStatus: 'active' | 'inactive' | 'unknown';
  planName?: string;
  planNumber?: string;
  groupNumber?: string;
  planType?: string; // HMO, PPO, EPO, POS, self-funded, fully-funded, etc.

  // Effective dates
  effectiveDate?: string;
  terminationDate?: string;

  // Therapy-specific visit limits
  therapyVisits?: {
    ot?: { allowed?: number; used?: number; remaining?: number };
    pt?: { allowed?: number; used?: number; remaining?: number };
    st?: { allowed?: number; used?: number; remaining?: number };
    mentalHealth?: { allowed?: number; used?: number; remaining?: number };
    combined?: { allowed?: number; used?: number; remaining?: number };
  };

  // Prior authorization
  authRequired: boolean;
  authNotes?: string;
  // Per-service-type prior-authorization detail derived from the 271's
  // authOrCertIndicator + free-text additionalInformation. Surfaces what
  // would otherwise require a payer phone call.
  authDetails?: Array<{
    serviceTypeCode?: string;
    serviceTypeName?: string;
    benefitCode?: string;
    indicator: 'Y' | 'N' | 'U';
    notes: string[];
    inNetwork: boolean;
  }>;

  // Financial details
  copay?: number;
  specialistCopay?: number;
  coinsurance?: number; // percentage
  deductible?: {
    individual?: number;
    individualMet?: number;
    family?: number;
    familyMet?: number;
  };
  outOfPocketMax?: {
    individual?: number;
    individualMet?: number;
    family?: number;
    familyMet?: number;
  };

  // Tier-separated cost sharing. The flat fields above remain the IN-NETWORK
  // numbers for backward compatibility; tier-aware consumers (OON practices)
  // should read networkTiers.
  networkTiers?: NetworkTiers;

  // Coverage details from raw response
  coverageDetails?: Array<{
    serviceType: string;
    serviceTypeCode?: string;
    coverage: string;
    inNetwork: boolean;
    amount?: number;
    percent?: number;
    quantity?: number;
    quantityQualifier?: string;
    limitations?: string;
  }>;

  // Meta
  checkedAt: string;
  source: 'stedi' | 'mock' | 'mock_fallback';
  errors?: string[];
}

/**
 * Get detailed benefits for a patient, including therapy-specific visit limits.
 * This performs a real-time eligibility check and parses the full 271 response.
 */
export async function getDetailedBenefits(
  patientId: number,
  practiceId: number,
): Promise<DetailedBenefits> {
  const { storage } = await import('../storage');
  const patient = await storage.getPatient(patientId);
  if (!patient) {
    throw new Error('Patient not found');
  }

  const practice = await storage.getPractice(practiceId);
  if (!practice) {
    throw new Error('Practice not found');
  }

  // Resolve payer ID. Precedence mirrors performStediEligibilityCheck: the
  // patient's insurancePayerId (written by the payer-search dropdown) is
  // authoritative; name matching is a last resort. The old chain —
  // `PAYER_IDS[name] || patient.insuranceId || '60054'` — was broken three
  // ways: exact-key lookup never matched a real carrier name ("Horizon Blue
  // Cross Blue Shield" is not the key 'horizon'), patient.insuranceId is the
  // MEMBER id, not a trading partner id, and the final fallback silently sent
  // the request (PHI included) to Aetna regardless of the patient's payer.
  const insuranceName = (patient.insuranceProvider || '').toLowerCase().replace(/[^a-z]/g, '');
  const nameMatch = Object.entries(PAYER_IDS).find(([key]) => insuranceName.includes(key))?.[1];
  const payerId = patient.insurancePayerId || nameMatch;
  if (!payerId) {
    return {
      planStatus: 'unknown',
      authRequired: false,
      checkedAt: new Date().toISOString(),
      source: 'stedi',
      errors: [
        `No payer ID on file for "${patient.insuranceProvider || 'unknown payer'}". ` +
          'Edit the patient’s insurance and pick the payer from the payer search dropdown.',
      ],
    };
  }

  // Run eligibility check with multiple service type codes for therapy-specific data.
  // Uses the X12-spec therapy STCs — prior to this fix the list used A7/A8/A9
  // (which aren't standard codes), so payers silently ignored them and returned
  // only generic coverage. With AE/AD/AF the payer actually answers about OT/PT/ST.
  //
  //   30 = Health Benefit Plan Coverage (generic fallback)
  //   AE = Occupational Therapy
  //   AD = Physical Therapy
  //   AF = Speech Therapy
  //   MH = Mental Health
  const serviceTypeCodes = ['30', 'AE', 'AD', 'AF', 'MH'];

  let stediKey;
  try {
    stediKey = await getStediApiKeyForPractice(practiceId);
  } catch {
    // Fall through to global key
  }

  const payload = {
    controlNumber: generateControlNumber(),
    tradingPartnerServiceId: payerId,
    provider: {
      organizationName: practice.name || undefined,
      npi: practice.npi || '',
    },
    subscriber: {
      memberId: patient.insuranceId || patient.policyNumber || '',
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth || '',
    },
    encounter: {
      serviceTypeCodes,
      dateOfService: new Date().toISOString().split('T')[0],
    },
  };

  try {
    const response = await fetch(`${STEDI_API_BASE}${STEDI_ELIGIBILITY_PATH}`, {
      method: 'POST',
      headers: getHeaders(stediKey?.apiKey),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Stedi detailed benefits error:', error);
      return {
        planStatus: 'unknown',
        authRequired: false,
        checkedAt: new Date().toISOString(),
        source: 'stedi',
        errors: [error.message || 'Failed to check eligibility'],
      };
    }

    const data = await response.json();
    return parseDetailedBenefitsResponse(data);
  } catch (error: any) {
    console.error('Stedi detailed benefits error:', error);
    return {
      planStatus: 'unknown',
      authRequired: false,
      checkedAt: new Date().toISOString(),
      source: 'stedi',
      errors: [error.message || 'Network error checking eligibility'],
    };
  }
}

/**
 * Parse full 271 response into DetailedBenefits with therapy-specific data.
 */
function parseDetailedBenefitsResponse(data: any): DetailedBenefits {
  const result: DetailedBenefits = {
    planStatus: 'unknown',
    authRequired: false,
    checkedAt: new Date().toISOString(),
    source: 'stedi',
  };

  try {
    const benefitsInfo = data.benefitsInformation || [];

    // Both cost-sharing tiers, from the shared tier parser.
    result.networkTiers = parseNetworkTiers(benefitsInfo);

    // Determine plan status
    const activeBenefit = benefitsInfo.find((b: any) =>
      b.code === '1' || b.informationCode === 'A'
    );
    if (activeBenefit) {
      result.planStatus = 'active';
    } else {
      const inactiveBenefit = benefitsInfo.find((b: any) =>
        b.code === '6' || b.informationCode === 'I'
      );
      result.planStatus = inactiveBenefit ? 'inactive' : 'unknown';
    }

    // Plan info
    const planInfo = data.planInformation || {};
    result.planName = planInfo.planName || data.planName;
    result.planNumber = planInfo.planNumber || data.planNumber;
    result.groupNumber = planInfo.groupNumber || data.groupNumber;

    // Plan type classification
    const planDesc = (result.planName || '').toLowerCase();
    if (planDesc.includes('hmo')) result.planType = 'HMO';
    else if (planDesc.includes('epo')) result.planType = 'EPO';
    else if (planDesc.includes('pos')) result.planType = 'POS';
    else if (planDesc.includes('ppo')) result.planType = 'PPO';
    else if (planDesc.includes('hdhp') || planDesc.includes('high deductible')) result.planType = 'HDHP';
    else if (planDesc.includes('medicaid')) result.planType = 'Medicaid';
    else if (planDesc.includes('medicare')) result.planType = 'Medicare';
    else result.planType = data.coverageType || undefined;

    // Effective dates
    result.effectiveDate = data.planDateInformation?.planBegin;
    result.terminationDate = data.planDateInformation?.planEnd;

    // Service type code to therapy type mapping.
    // Canonical X12 codes: AE=OT, AD=PT, AF=ST, MH=Mental Health.
    // Legacy A7/A8/A9 aliases kept so we still parse responses from any payer
    // that happens to echo back the non-standard codes we used to send.
    const serviceTypeToTherapy: Record<string, keyof NonNullable<DetailedBenefits['therapyVisits']>> = {
      'AE': 'ot', 'A7': 'ot', 'OT': 'ot',
      'AD': 'pt', 'A8': 'pt', 'PT': 'pt',
      'AF': 'st', 'A9': 'st', 'ST': 'st',
      'MH': 'mentalHealth',
    };

    // Initialize therapy visits
    const therapyVisits: DetailedBenefits['therapyVisits'] = {};

    // Parse copay, deductible, OOP, coinsurance, visits, auth
    const deductible: DetailedBenefits['deductible'] = {};
    const outOfPocketMax: DetailedBenefits['outOfPocketMax'] = {};
    const coverageDetails: DetailedBenefits['coverageDetails'] = [];
    const authDetails: NonNullable<DetailedBenefits['authDetails']> = [];

    for (const benefit of benefitsInfo) {
      const code = benefit.code;
      const amount = parseFloat(benefit.amount || benefit.benefitAmount || '0');
      const percent = parseFloat(benefit.percent || benefit.benefitPercent || '0');
      const serviceTypeCode = benefit.serviceTypeCode || benefit.serviceType || '';
      const inNetwork = networkIndicatorOf(benefit) !== 'N';
      const coverageLevel = benefit.coverageLevelCode || '';

      // Only process in-network benefits for primary display; both tiers are
      // captured separately in result.networkTiers below.
      if (!inNetwork) continue;

      // Copay
      if (code === 'B' && amount > 0) {
        const therapyKey = serviceTypeToTherapy[serviceTypeCode];
        if (serviceTypeCode === '98' || serviceTypeCode === '30' || !serviceTypeCode) {
          result.copay = amount;
        }
        if (serviceTypeCode === 'AL' || serviceTypeCode === '98') {
          result.specialistCopay = amount;
        }
      }

      // Co-Insurance
      if (code === 'A' && percent > 0) {
        result.coinsurance = normalizeCoinsurancePercent(percent);
      }

      // Deductible
      if (code === 'C' && amount > 0) {
        if (coverageLevel === 'FAM') {
          deductible.family = amount;
        } else {
          deductible.individual = amount;
        }
      }
      // Deductible met / remaining
      if (code === 'C' && benefit.timePeriodQualifier === '29') {
        // Remaining deductible
        if (coverageLevel === 'FAM') {
          deductible.familyMet = (deductible.family || 0) - amount;
        } else {
          deductible.individualMet = (deductible.individual || 0) - amount;
        }
      }

      // Out of Pocket Max
      if (code === 'G' && amount > 0) {
        if (coverageLevel === 'FAM') {
          outOfPocketMax.family = amount;
        } else {
          outOfPocketMax.individual = amount;
        }
      }
      if (code === 'G' && benefit.timePeriodQualifier === '29') {
        if (coverageLevel === 'FAM') {
          outOfPocketMax.familyMet = (outOfPocketMax.family || 0) - amount;
        } else {
          outOfPocketMax.individualMet = (outOfPocketMax.individual || 0) - amount;
        }
      }

      // Visit limitations by therapy type
      if (code === 'F' && benefit.quantityQualifier === 'VS') {
        const qty = parseInt(benefit.quantity || '0');
        const therapyKey = serviceTypeToTherapy[serviceTypeCode];
        if (therapyKey && qty > 0) {
          if (!therapyVisits[therapyKey]) therapyVisits[therapyKey] = {};
          therapyVisits[therapyKey]!.allowed = qty;
        } else if (qty > 0) {
          // Generic visit limit
          if (!therapyVisits.combined) therapyVisits.combined = {};
          therapyVisits.combined.allowed = qty;
        }
      }

      // Authorization required (CB benefit code path)
      if (code === 'CB') {
        result.authRequired = true;
        const therapyKey = serviceTypeToTherapy[serviceTypeCode];
        if (therapyKey) {
          result.authNotes = `Prior authorization required for ${therapyKey.toUpperCase()} services`;
        }
      }

      // Per-benefit prior-auth indicator + free-text notes (the data the
      // Stedi blog calls out as replacing payer phone calls).
      const indicatorRaw: string | undefined = benefit.authOrCertIndicator;
      const additionalInfo: Array<{ description?: string }> | undefined =
        Array.isArray(benefit.additionalInformation) ? benefit.additionalInformation : undefined;
      const notes = (additionalInfo || [])
        .map((n) => (n && typeof n.description === 'string' ? n.description.trim() : ''))
        .filter(Boolean);
      const indicator: 'Y' | 'N' | 'U' | undefined =
        indicatorRaw === 'Y' || indicatorRaw === 'N' || indicatorRaw === 'U' ? indicatorRaw : undefined;
      const looksLikeAuthNote = notes.some((n) => /(prior\s*authoriz|pre[-\s]*auth|precertific)/i.test(n));
      if (indicator || looksLikeAuthNote) {
        authDetails.push({
          serviceTypeCode: serviceTypeCode || undefined,
          serviceTypeName: benefit.serviceTypeName,
          benefitCode: code,
          indicator: indicator ?? 'U',
          notes,
          inNetwork,
        });
        if (indicator === 'Y' || looksLikeAuthNote) {
          result.authRequired = true;
        }
      }

      // Build coverage details
      if (code && (amount > 0 || percent > 0)) {
        coverageDetails.push({
          serviceType: benefit.serviceTypeName || serviceTypeCode,
          serviceTypeCode,
          coverage: getBenefitCodeDescription(code),
          inNetwork,
          amount: amount || undefined,
          percent: percent || undefined,
          quantity: benefit.quantity ? parseInt(benefit.quantity) : undefined,
          quantityQualifier: benefit.quantityQualifier,
          limitations: benefit.additionalInformation?.join('; '),
        });
      }
    }

    // Set parsed financial values
    if (Object.keys(deductible).length > 0) result.deductible = deductible;
    if (Object.keys(outOfPocketMax).length > 0) result.outOfPocketMax = outOfPocketMax;
    if (Object.keys(therapyVisits).length > 0) result.therapyVisits = therapyVisits;
    if (coverageDetails.length > 0) result.coverageDetails = coverageDetails;
    if (authDetails.length > 0) result.authDetails = authDetails;

  } catch (error) {
    console.error('Error parsing detailed benefits response:', error);
  }

  return result;
}

function getBenefitCodeDescription(code: string): string {
  const descriptions: Record<string, string> = {
    '1': 'Active Coverage',
    '6': 'Inactive',
    'A': 'Co-Insurance',
    'B': 'Co-Payment',
    'C': 'Deductible',
    'CB': 'Authorization Required',
    'F': 'Limitations',
    'G': 'Out of Pocket Maximum',
    'I': 'Non-Covered',
    'Y': 'Contact Payer',
  };
  return descriptions[code] || code;
}

/**
 * A single payer result from a live Stedi Payer Network search, flattened to
 * the fields a biller actually needs to pick the right payer ID. Transaction
 * support tells the user what they can do today vs. what needs enrollment.
 */
export interface PayerSearchResult {
  /** Primary payer ID to use in eligibility/claim requests (e.g. "60054"). */
  payerId: string;
  /** Human-readable payer name (e.g. "Aetna"). */
  displayName: string;
  /** Alternate payer IDs/aliases Stedi also accepts for this payer. */
  aliases: string[];
  /** States the payer operates in, or ["NATIONAL"]. */
  operatingStates: string[];
  /** Coverage types: medical / dental / vision. */
  coverageTypes: string[];
  /** Per-transaction support: SUPPORTED | NOT_SUPPORTED | ENROLLMENT_REQUIRED. */
  transactionSupport: {
    eligibilityCheck?: string;
    professionalClaimSubmission?: string;
    claimStatus?: string;
    claimPayment?: string; // ERA / 835
  };
}

/**
 * Search Stedi's live Payer Network by name, ID, or alias (fuzzy matching).
 * This is the authoritative source for payer IDs — far better than the static
 * PAYER_IDS map, because it returns every entity (commercial vs. Medicaid
 * "Better Health" vs. Senior Supplemental) with that entity's exact ID and
 * what transactions it supports today.
 *
 * Powers the `search_payer` MCP tool so the in-app assistant stops guessing
 * payer IDs and returns verified ones with transaction support.
 */
export async function searchPayers(
  query: string,
  options: { pageSize?: number; practiceId?: number } = {},
): Promise<PayerSearchResult[]> {
  // pageSize must be an integer 10-100 per Stedi's API; default to 10.
  // Coerce defensively in case a non-number (or NaN) reaches us from a tool call.
  const rawSize = Number(options.pageSize);
  const pageSize = Number.isFinite(rawSize)
    ? Math.min(100, Math.max(10, Math.trunc(rawSize)))
    : 10;

  let apiKey = process.env.STEDI_API_KEY;
  if (options.practiceId !== undefined) {
    try {
      const resolved = await getStediApiKeyForPractice(options.practiceId);
      apiKey = resolved.apiKey;
    } catch {
      // Fall through to global key.
    }
  }
  if (!apiKey) {
    throw new Error('STEDI_API_KEY environment variable is not configured');
  }

  const url = `${STEDI_API_BASE}/payers/search?query=${encodeURIComponent(
    query,
  )}&pageSize=${pageSize}`;

  // Reuse getHeaders() so this stays in lockstep with every other Stedi call
  // if the auth/header format ever changes.
  const response = await fetch(url, {
    method: 'GET',
    headers: getHeaders(apiKey),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Stedi payer search failed (${response.status}): ${body.slice(0, 300)}`,
    );
  }

  // Guard against a 200 with a non-JSON body (HTML error page, gateway timeout
  // page, etc.) so we degrade gracefully like the other Stedi service functions
  // rather than throwing a raw SyntaxError at the caller.
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error('Stedi payer search returned a non-JSON response body.');
  }

  const items: any[] = Array.isArray(data?.items) ? data.items : [];

  return items
    .map((item): PayerSearchResult => {
      // Stedi nests the payer record under `payer` in search responses, but some
      // endpoints return it flat — handle both.
      const p = item?.payer ?? item;
      const ts = p?.transactionSupport ?? {};
      return {
        payerId: p?.primaryPayerId ?? p?.stediId ?? '',
        displayName: p?.displayName ?? '',
        aliases: Array.isArray(p?.aliases) ? p.aliases : [],
        operatingStates: Array.isArray(p?.operatingStates) ? p.operatingStates : [],
        coverageTypes: Array.isArray(p?.coverageTypes) ? p.coverageTypes : [],
        transactionSupport: {
          eligibilityCheck: ts.eligibilityCheck,
          professionalClaimSubmission: ts.professionalClaimSubmission,
          claimStatus: ts.claimStatus,
          claimPayment: ts.claimPayment,
        },
      };
    })
    // Drop any degenerate result with no usable payer ID — the whole point of
    // this tool is returning IDs a biller can actually use.
    .filter((r) => r.payerId !== '');
}

export default {
  isStediConfigured,
  checkEligibility,
  submitClaim,
  checkClaimStatus,
  resolvePayerId,
  searchPayers,
  getDetailedBenefits,
  PAYER_IDS,
};
