/**
 * Stedi Healthcare Clearinghouse Integration
 *
 * Handles:
 * - Eligibility verification (270/271)
 * - Claims submission (837P for professional claims)
 * - Claim status inquiries (276/277)
 * - Electronic remittance advice (835)
 */

// Stedi API base URL (same for test and production — the API key determines the environment)
const STEDI_API_BASE = 'https://healthcare.us.stedi.com/2024-04-01';

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
    if (practice && !practice.sandboxMode) {
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
  coinsurance?: number;
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
    const response = await fetch(`${STEDI_API_BASE}/eligibility-checks`, {
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

    // Phase 2: attach STC audit metadata. We use the coverageDetails[].serviceType
    // values the payer returned as the canonical answer, because Stedi
    // normalizes each benefit entry to its STC.
    const returnedStcs = Array.from(
      new Set(
        (parsed.coverageDetails ?? [])
          .map((d: any) => d?.serviceType)
          .filter((s: any): s is string => typeof s === 'string' && s.length > 0)
      )
    );
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
    taxonomy?: string;
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

export async function submitClaim(claim: ClaimSubmission, practiceId?: number): Promise<ClaimSubmissionResponse> {
  const stediKey = practiceId ? await getStediApiKeyForPractice(practiceId) : undefined;
  const payload = build837P(claim);

  try {
    const response = await fetch(`${STEDI_API_BASE}/claims`, {
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
    return {
      success: true,
      claimId: claim.claimId,
      stediClaimId: data.claimId || data.id,
      status: 'accepted',
      raw: data,
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

export async function checkClaimStatus(request: ClaimStatusRequest, practiceId?: number): Promise<ClaimStatusResponse> {
  const stediKey = practiceId ? await getStediApiKeyForPractice(practiceId) : undefined;
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
    const response = await fetch(`${STEDI_API_BASE}/claim-status`, {
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
      response.coinsurance = coinsuranceBenefit.percent;
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

export function build837P(claim: ClaimSubmission): any {
  // Build the 837P claim payload for Stedi
  // This is a simplified version - real implementation would be more comprehensive

  return {
    controlNumber: generateControlNumber(),
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
      taxonomyCode: claim.provider.taxonomy || '101YM0800X', // Mental health counselor
      organizationName: claim.provider.organizationName,
      address: claim.provider.address,
      taxId: claim.provider.taxId,
    },
    rendering: {
      npi: claim.provider.npi,
      taxonomyCode: claim.provider.taxonomy || '101YM0800X',
      firstName: claim.provider.firstName,
      lastName: claim.provider.lastName,
    },
    claimInformation: {
      patientControlNumber: claim.claimId,
      claimChargeAmount: claim.totalAmount.toString(),
      placeOfServiceCode: claim.placeOfService,
      claimFrequencyCode: '1', // Original claim
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

  // Resolve payer ID
  const insuranceName = (patient.insuranceProvider || '').toLowerCase();
  const payerId = PAYER_IDS[insuranceName] || patient.insuranceId || '60054';

  // Run eligibility check with multiple service type codes for therapy-specific data
  // 30 = Health Benefit Plan Coverage
  // A7 = Occupational Therapy
  // A8 = Physical Therapy
  // A9 = Speech Therapy
  // MH = Mental Health
  const serviceTypeCodes = ['30', 'A7', 'A8', 'A9', 'MH'];

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
    const response = await fetch(`${STEDI_API_BASE}/eligibility-checks`, {
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

    // Service type code to therapy type mapping
    const serviceTypeToTherapy: Record<string, keyof NonNullable<DetailedBenefits['therapyVisits']>> = {
      'A7': 'ot', 'OT': 'ot',
      'A8': 'pt', 'PT': 'pt',
      'A9': 'st', 'ST': 'st',
      'MH': 'mentalHealth',
    };

    // Initialize therapy visits
    const therapyVisits: DetailedBenefits['therapyVisits'] = {};

    // Parse copay, deductible, OOP, coinsurance, visits, auth
    const deductible: DetailedBenefits['deductible'] = {};
    const outOfPocketMax: DetailedBenefits['outOfPocketMax'] = {};
    const coverageDetails: DetailedBenefits['coverageDetails'] = [];

    for (const benefit of benefitsInfo) {
      const code = benefit.code;
      const amount = parseFloat(benefit.amount || benefit.benefitAmount || '0');
      const percent = parseFloat(benefit.percent || benefit.benefitPercent || '0');
      const serviceTypeCode = benefit.serviceTypeCode || benefit.serviceType || '';
      const inNetwork = benefit.inPlanNetworkIndicator !== 'N';
      const coverageLevel = benefit.coverageLevelCode || '';

      // Only process in-network benefits for primary display
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
        result.coinsurance = percent;
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

      // Authorization required
      if (code === 'CB') {
        result.authRequired = true;
        const therapyKey = serviceTypeToTherapy[serviceTypeCode];
        if (therapyKey) {
          result.authNotes = `Prior authorization required for ${therapyKey.toUpperCase()} services`;
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

export default {
  isStediConfigured,
  checkEligibility,
  submitClaim,
  checkClaimStatus,
  resolvePayerId,
  getDetailedBenefits,
  PAYER_IDS,
};
