/**
 * Stedi Claim Lifecycle API client (launched 2026-09; GET /claims on the
 * healthcare base). Returns clearinghouse-side claim records: submission →
 * acknowledgment → adjudication status, plus totalClaimPaidAmount once the
 * 835 arrives. Our join key is patientControlNumber, which claim submission
 * sets to the platform's claim id.
 *
 * READ-ONLY for now: this service fetches and reports. It deliberately does
 * NOT rewrite platform claim statuses — Lifecycle statuses are coarser than
 * the 277-based reaper's, and auto-regressing a claim a biller already
 * reconciled is worse than showing both sources side by side. Wiring it into
 * status updates is a follow-up product decision.
 */
import logger from './logger';

// NOTE the dedicated host: the Lifecycle API lives on claims.us.stedi.com
// with its own version date — NOT the healthcare base. The healthcare base
// answers /claims with an empty 200, which is a false-empty (verified live):
// exactly the failure mode the 404 guard below exists for, but sneakier.
const STEDI_CLAIMS_BASE =
  process.env.STEDI_CLAIMS_BASE || 'https://claims.us.stedi.com/2025-03-07';

export type LifecycleStatus =
  | 'SUBMITTED'
  | 'RECEIVED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'PROCESSED'
  | 'DENIED'
  | 'UNKNOWN';

export interface LifecycleClaim {
  id: string;
  patientControlNumber: string | null;
  status: LifecycleStatus;
  statusReportedBy: string | null;
  stediPayerId: string | null;
  type: string | null;
  submittedAt: string | null;
  totalClaimChargeAmount: string | null;
  totalClaimPaidAmount: string | null;
  datesOfService: { start?: string; end?: string } | null;
}

export interface LifecyclePage {
  claims: LifecycleClaim[];
  nextPageToken: string | null;
}

export async function listLifecycleClaims(params: {
  apiKey: string;
  submittedAfter?: string;
  submittedBefore?: string;
  statuses?: LifecycleStatus[];
  patientControlNumbers?: string[];
  pageToken?: string;
  pageSize?: number;
}): Promise<LifecyclePage> {
  const qs = new URLSearchParams();
  if (params.pageToken) {
    qs.set('pageToken', params.pageToken);
  } else {
    if (params.submittedAfter) qs.set('submittedAfter', params.submittedAfter);
    if (params.submittedBefore) qs.set('submittedBefore', params.submittedBefore);
    for (const s of params.statuses ?? []) qs.append('status', s);
    for (const p of params.patientControlNumbers ?? []) qs.append('patientControlNumbers', p);
    qs.set('pageSize', String(params.pageSize ?? 100));
  }

  const url = `${STEDI_CLAIMS_BASE}/claims?${qs.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Key ${params.apiKey}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // Same rule as the ERA poller: a 404 means the PATH is wrong, not that
    // there are no claims — an empty list is a 200. Never let a broken
    // endpoint impersonate an empty result.
    if (response.status === 404) {
      throw new Error(`Claim Lifecycle endpoint returned 404 — path is wrong, not empty. URL: ${url}`);
    }
    throw new Error(`Claim Lifecycle list failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data: any = await response.json();
  const list: any[] = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.claims)
      ? data.claims
      : [];
  if (!Array.isArray(data?.items) && !Array.isArray(data?.claims) && data && Object.keys(data).length > 0) {
    logger.warn('Claim Lifecycle returned an unexpected envelope', { keys: Object.keys(data) });
  }

  const claims: LifecycleClaim[] = list.map((c: any) => ({
    id: c.id,
    patientControlNumber: c.patientControlNumber ?? null,
    status: (c.status ?? 'UNKNOWN') as LifecycleStatus,
    statusReportedBy: c.statusReportedBy ?? null,
    stediPayerId: c.stediPayerId ?? null,
    type: c.type ?? null,
    submittedAt: c.submittedAt ?? null,
    totalClaimChargeAmount: c.totalClaimChargeAmount ?? null,
    totalClaimPaidAmount: c.totalClaimPaidAmount ?? null,
    datesOfService: c.datesOfService ?? null,
  }));

  return {
    claims,
    // Mirror the ERA poller lesson: an empty page ends the walk regardless of
    // any token the API returns.
    nextPageToken: claims.length === 0 ? null : (data?.nextPageToken ?? null),
  };
}
