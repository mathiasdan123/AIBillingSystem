/**
 * Stedi Transaction Enrollment — WRITE path (Phases 2 & 3, multi-practice
 * enrollment, 2026-05-30).
 *
 * The READ/reconcile side lives in stediEnrollmentSyncService.ts. This
 * module is the missing WRITE side: creating the per-practice Stedi
 * provider record (Phase 2) and submitting enrollment requests (Phase 3),
 * so practices no longer need the manual portal CSV.
 *
 * Stedi enrollment API (confirmed 2026-05-30):
 *   Base:  https://enrollments.us.stedi.com/2024-09-01
 *   Auth:  Authorization: Key <apiKey>   (same scheme as healthcare API)
 *   POST /enrollment/create-provider     { displayName, npi, taxId, contacts:[...] }
 *   POST /enrollment/create-enrollment   { providerId, payerId, transaction, userEmail, ... }
 *   GET  /enrollments                    list (used by the sync service)
 *
 * Transaction values: eligibilityCheck (270/271), claimStatus (276/277),
 * professionalClaimSubmission (837P), claimPayment (835 ERA).
 *
 * Enrollment lifecycle: DRAFT → STEDI_ACTION_REQUIRED → PROVIDER_ACTION_REQUIRED
 * → PROVISIONING → LIVE | REJECTED.
 *
 * Design: every network call is best-effort and returns a structured
 * { ok, ...} result instead of throwing, mirroring the rest of the Stedi
 * integration. Callers decide how to surface failures.
 */

import logger from './logger';

export const ENROLLMENT_API_BASE =
  process.env.STEDI_ENROLLMENT_API_BASE || 'https://enrollments.us.stedi.com/2024-09-01';

// Our local enums (mirror payer_enrollments columns).
export type LocalEnrollmentStatus = 'not_enrolled' | 'pending' | 'enrolled' | 'rejected';
export type LocalTransactionType = 'eligibility' | 'claims' | 'era';

/**
 * Local transaction type → Stedi enrollment `transaction` value.
 * We submit 837P for "claims" (professional). ERA = claimPayment.
 */
export function mapTransactionTypeToStedi(t: LocalTransactionType): string | null {
  switch (t) {
    case 'eligibility':
      return 'eligibilityCheck';
    case 'claims':
      return 'professionalClaimSubmission';
    case 'era':
      return 'claimPayment';
    default:
      return null;
  }
}

/**
 * Stedi enrollment lifecycle state → our 4-value enum.
 *   LIVE                          → enrolled
 *   REJECTED                      → rejected
 *   DRAFT / *_ACTION_REQUIRED /
 *   PROVISIONING / SUBMITTED      → pending
 *   (null / unknown)              → pending (surface it, don't hide it)
 */
export function mapStediEnrollmentStatus(raw: string | null | undefined): LocalEnrollmentStatus {
  if (!raw) return 'not_enrolled';
  const v = String(raw).trim().toUpperCase();
  if (v === 'LIVE' || v === 'ACTIVE' || v === 'ENROLLED' || v === 'APPROVED' || v === 'COMPLETED') {
    return 'enrolled';
  }
  if (v === 'REJECTED' || v === 'DENIED' || v === 'FAILED' || v === 'ERROR') {
    return 'rejected';
  }
  if (v === 'NOT_ENROLLED' || v === 'WITHDRAWN' || v === 'CANCELLED' || v === 'CANCELED' || v === 'NONE') {
    return 'not_enrolled';
  }
  // DRAFT, STEDI_ACTION_REQUIRED, PROVIDER_ACTION_REQUIRED, PROVISIONING, SUBMITTED, ...
  return 'pending';
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Key ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

// ---- Phase 2: provider record ------------------------------------------

export interface CreateProviderInput {
  displayName: string;
  npi: string;
  taxId: string;
  contactName?: string;
  address?: string;
  email?: string;
  phone?: string;
}

export interface CreateProviderResult {
  ok: boolean;
  providerId?: string;
  raw?: any;
  error?: string;
  status?: number;
}

/**
 * Create (or re-create) the Stedi provider record for a practice.
 * Returns the Stedi provider id on success.
 */
export async function createStediProvider(
  apiKey: string,
  input: CreateProviderInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CreateProviderResult> {
  const body = {
    displayName: input.displayName,
    npi: input.npi,
    taxId: input.taxId,
    contacts: [
      {
        name: input.contactName || input.displayName,
        address: input.address || undefined,
        email: input.email || undefined,
        phone: input.phone || undefined,
      },
    ],
  };

  try {
    const resp = await fetchImpl(`${ENROLLMENT_API_BASE}/enrollment/create-provider`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      logger.warn('Stedi create-provider failed', { status: resp.status, error: data?.message });
      return { ok: false, status: resp.status, raw: data, error: data?.message || `http_${resp.status}` };
    }
    const providerId =
      data?.providerId || data?.id || data?.provider?.id || data?.provider?.providerId;
    if (!providerId) {
      return { ok: false, raw: data, error: 'no_provider_id_in_response' };
    }
    return { ok: true, providerId: String(providerId), raw: data };
  } catch (err: any) {
    logger.error('Stedi create-provider error', { error: err?.message || String(err) });
    return { ok: false, error: err?.message || 'network_error' };
  }
}

// ---- Phase 3: enrollment request ---------------------------------------

export interface CreateEnrollmentInput {
  providerId: string;
  payerId: string;
  /** Stedi transaction value, e.g. from mapTransactionTypeToStedi(). */
  transaction: string;
  userEmail: string;
  /** YYYYMMDD; defaults to undefined (Stedi uses today). */
  requestedEffectiveDate?: string;
  aggregationPreference?: 'NPI' | 'TIN';
}

export interface CreateEnrollmentResult {
  ok: boolean;
  enrollmentId?: string;
  status?: string; // raw Stedi status
  localStatus?: LocalEnrollmentStatus;
  raw?: any;
  error?: string;
  httpStatus?: number;
}

/**
 * Submit a single transaction enrollment request to Stedi.
 */
export async function createStediEnrollment(
  apiKey: string,
  input: CreateEnrollmentInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CreateEnrollmentResult> {
  const body: Record<string, any> = {
    providerId: input.providerId,
    payerId: input.payerId,
    transaction: input.transaction,
    userEmail: input.userEmail,
    aggregationPreference: input.aggregationPreference || 'NPI',
  };
  if (input.requestedEffectiveDate) body.requestedEffectiveDate = input.requestedEffectiveDate;

  try {
    const resp = await fetchImpl(`${ENROLLMENT_API_BASE}/enrollment/create-enrollment`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      logger.warn('Stedi create-enrollment failed', { status: resp.status, error: data?.message });
      return {
        ok: false,
        httpStatus: resp.status,
        raw: data,
        error: data?.message || `http_${resp.status}`,
      };
    }
    const enrollmentId = data?.enrollmentId || data?.id;
    const status = data?.status || data?.state;
    return {
      ok: true,
      enrollmentId: enrollmentId ? String(enrollmentId) : undefined,
      status: status ? String(status) : undefined,
      localStatus: mapStediEnrollmentStatus(status),
      raw: data,
    };
  } catch (err: any) {
    logger.error('Stedi create-enrollment error', { error: err?.message || String(err) });
    return { ok: false, error: err?.message || 'network_error' };
  }
}
