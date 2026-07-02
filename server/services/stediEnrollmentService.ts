/**
 * Stedi Transaction Enrollment — WRITE path (Phases 2 & 3, multi-practice
 * enrollment, 2026-05-30).
 *
 * The READ/reconcile side lives in stediEnrollmentSyncService.ts. This
 * module is the missing WRITE side: creating the per-practice Stedi
 * provider record (Phase 2) and submitting enrollment requests (Phase 3),
 * so practices no longer need the manual portal CSV.
 *
 * Stedi enrollment API (verified against Stedi's OpenAPI spec 2026-07-02 —
 * the original guessed paths /enrollment/create-provider and
 * /enrollment/create-enrollment returned 404 in production):
 *   Base:  https://enrollments.us.stedi.com/2024-09-01
 *   Auth:  Authorization: Key <apiKey>   (same scheme as healthcare API)
 *   POST /providers    { name, npi, taxId, taxIdType: EIN|SSN, contacts:[{firstName,lastName,organizationName,email,phone,streetAddress1,city,state,zipCode}] }
 *   POST /enrollments  { provider:{id}, payer:{idOrAlias}, transactions:{<txn>:{enroll:true}}, primaryContact:{...}, userEmail, status: DRAFT|STEDI_ACTION_REQUIRED }
 *   GET  /enrollments  list (used by the sync service)
 * Notes:
 *   - aggregationPreference is ONLY valid for claimPayment (ERA) enrollments;
 *     Stedi rejects non-ERA requests that include it with HTTP 400.
 *   - status defaults to DRAFT; STEDI_ACTION_REQUIRED submits it for processing.
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

/** Contact shape shared by provider records and enrollment primary contacts. */
export interface StediContactInput {
  firstName?: string;
  lastName?: string;
  organizationName?: string;
  email?: string;
  phone?: string;
  streetAddress1?: string;
  streetAddress2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

export interface CreateProviderInput {
  displayName: string;
  npi: string;
  taxId: string;
  /** Defaults to EIN (organizations). Pass SSN for individual providers billing under one. */
  taxIdType?: 'EIN' | 'SSN';
  contact?: StediContactInput;
}

/**
 * Strip undefined/empty values so we don't send empty strings to Stedi, and
 * enforce Stedi's contact-name rule: a contact is EITHER a person
 * (firstName + lastName) OR an organization (organizationName) — sending all
 * three is a 400. Prefer the person when both names are present.
 */
function compactContact(c: StediContactInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  if (out.firstName && out.lastName) {
    delete out.organizationName;
  } else {
    delete out.firstName;
    delete out.lastName;
  }
  return out;
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
  const contact = input.contact ? compactContact(input.contact) : undefined;
  const body: Record<string, any> = {
    name: input.displayName,
    npi: input.npi,
    taxId: input.taxId,
    taxIdType: input.taxIdType || 'EIN',
  };
  if (contact && Object.keys(contact).length > 0) body.contacts = [contact];

  try {
    const resp = await fetchImpl(`${ENROLLMENT_API_BASE}/providers`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      logger.warn('Stedi create-provider failed', { status: resp.status, error: data?.message });
      return { ok: false, status: resp.status, raw: data, error: data?.message || `http_${resp.status}` };
    }
    const providerId = data?.id || data?.providerId;
    if (!providerId) {
      return { ok: false, raw: data, error: 'no_provider_id_in_response' };
    }
    return { ok: true, providerId: String(providerId), raw: data };
  } catch (err: any) {
    logger.error('Stedi create-provider error', { error: err?.message || String(err) });
    return { ok: false, error: err?.message || 'network_error' };
  }
}

/**
 * Find an existing Stedi provider record by NPI (GET /providers has no
 * server-side filter, so this pages through and matches client-side).
 */
export async function findStediProviderByNpi(
  apiKey: string,
  npi: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CreateProviderResult> {
  try {
    let pageToken: string | undefined;
    do {
      const url = new URL(`${ENROLLMENT_API_BASE}/providers`);
      url.searchParams.set('pageSize', '100');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const resp = await fetchImpl(url.toString(), { headers: authHeaders(apiKey) });
      const data: any = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return { ok: false, status: resp.status, raw: data, error: data?.message || `http_${resp.status}` };
      }
      const hit = (data?.items || []).find((x: any) => String(x?.npi) === npi);
      if (hit?.id) return { ok: true, providerId: String(hit.id), raw: hit };
      pageToken = data?.nextPageToken || undefined;
    } while (pageToken);
    return { ok: false, error: 'provider_not_found' };
  } catch (err: any) {
    logger.error('Stedi list-providers error', { error: err?.message || String(err) });
    return { ok: false, error: err?.message || 'network_error' };
  }
}

/**
 * Create the provider record, or — if Stedi reports one already exists for
 * this NPI (e.g. it was created manually in the Stedi console) — look it up
 * and return the existing id.
 */
export async function ensureStediProvider(
  apiKey: string,
  input: CreateProviderInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CreateProviderResult> {
  const created = await createStediProvider(apiKey, input, fetchImpl);
  if (created.ok) return created;
  if (created.status === 400 && /already exists/i.test(created.error || '')) {
    const found = await findStediProviderByNpi(apiKey, input.npi, fetchImpl);
    if (found.ok) {
      logger.info('Stedi provider already existed — reusing', { providerId: found.providerId });
      return found;
    }
  }
  return created;
}

// ---- Phase 3: enrollment request ---------------------------------------

export interface CreateEnrollmentInput {
  providerId: string;
  /** Stedi payer id or any alias (sent as payer.idOrAlias). */
  payerId: string;
  /** Stedi transaction value, e.g. from mapTransactionTypeToStedi(). */
  transaction: string;
  userEmail: string;
  /** Required by Stedi: email, phone, streetAddress1, city, state, zipCode. */
  primaryContact: StediContactInput;
  /** YYYY-MM-DD; defaults to undefined (Stedi uses today). */
  requestedEffectiveDate?: string;
  /** ERA (claimPayment) only — Stedi 400s if sent on other transactions. */
  aggregationPreference?: 'NPI' | 'TIN';
  /** true → submit for processing (STEDI_ACTION_REQUIRED); false → DRAFT. */
  submit?: boolean;
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
    provider: { id: input.providerId },
    payer: { idOrAlias: input.payerId },
    transactions: { [input.transaction]: { enroll: true } },
    primaryContact: compactContact(input.primaryContact),
    userEmail: input.userEmail,
    status: input.submit ? 'STEDI_ACTION_REQUIRED' : 'DRAFT',
  };
  if (input.transaction === 'claimPayment' && input.aggregationPreference) {
    body.aggregationPreference = input.aggregationPreference;
  }
  if (input.requestedEffectiveDate) body.requestedEffectiveDate = input.requestedEffectiveDate;

  try {
    const resp = await fetchImpl(`${ENROLLMENT_API_BASE}/enrollments`, {
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
