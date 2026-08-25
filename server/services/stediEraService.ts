/**
 * Stedi ERA (835) retrieval client.
 *
 * ENDPOINTS ARE VERIFIED, NOT GUESSED. This repo has twice shipped invented
 * Stedi paths that returned 404 for every call in production — the short
 * `/claims`, `/eligibility-checks`, `/claim-status` paths in stediService, and
 * `/enrollment/create-provider` in stediEnrollmentService. Both were silent:
 * the code looked correct and simply never worked.
 *
 * So these two were probed unauthenticated on 2026-08-25, where 401 proves the
 * route exists and 404 proves it does not:
 *
 *   401  GET core.us.stedi.com/2023-08-01/polling/transactions
 *   401  GET healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/reports/v2/{id}/835
 *   404  GET core.us.stedi.com/2023-08-01/healthcare/reports/835?transactionId=...
 *
 * That last one is what Stedi's own integration guide describes, and it does
 * not exist — with or without the query parameter. Do not "fix" the paths
 * below to match that doc without re-probing first.
 *
 * Note the two DIFFERENT hosts: polling lives on core, the report lives on the
 * same healthcare base the claims client already uses.
 */
import logger from './logger';

/** Polling lives on the core API, not the healthcare one. */
const STEDI_CORE_BASE = process.env.STEDI_CORE_BASE || 'https://core.us.stedi.com/2023-08-01';
/** Reports live on the healthcare base, same as claims/eligibility. */
const STEDI_HEALTHCARE_BASE =
  process.env.STEDI_HEALTHCARE_BASE || 'https://healthcare.us.stedi.com/2024-04-01';

const POLL_PATH = '/polling/transactions';
const report835Path = (transactionId: string) =>
  `/change/medicalnetwork/reports/v2/${encodeURIComponent(transactionId)}/835`;

export interface PolledTransaction {
  transactionId: string;
  /** '835' for a remittance, '277' for a claim acknowledgment. */
  transactionType?: string | null;
  createdAt?: string | null;
}

export interface PollTransactionsResult {
  transactions: PolledTransaction[];
  nextPageToken: string | null;
}

function headers(apiKey: string): Record<string, string> {
  return { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' };
}

/**
 * List transactions Stedi has processed for this account.
 *
 * Either startDateTime or pageToken is required by the API. We always pass one.
 */
export async function pollTransactions(params: {
  apiKey: string;
  startDateTime?: string;
  pageToken?: string;
}): Promise<PollTransactionsResult> {
  const { apiKey, startDateTime, pageToken } = params;

  const qs = new URLSearchParams();
  if (pageToken) qs.set('pageToken', pageToken);
  else if (startDateTime) qs.set('startDateTime', startDateTime);
  else throw new Error('pollTransactions requires startDateTime or pageToken');

  const url = `${STEDI_CORE_BASE}${POLL_PATH}?${qs.toString()}`;
  const response = await fetch(url, { method: 'GET', headers: headers(apiKey) });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // 404 here means the PATH is wrong, not that there is nothing to poll —
    // an empty poll is a 200 with an empty array. Say so explicitly, because
    // the previous incarnation of this mistake looked like "no ERAs yet" for
    // months.
    if (response.status === 404) {
      throw new Error(
        `Stedi polling endpoint returned 404 — the path is wrong, not empty. URL: ${url}`,
      );
    }
    throw new Error(`Stedi polling failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data: any = await response.json();

  // Be liberal about the envelope: the field has been named differently across
  // Stedi API generations, and guessing one shape and silently reading an
  // empty list is the failure mode this whole file exists to avoid.
  const list: any[] =
    data?.transactions ?? data?.items ?? data?.results ?? (Array.isArray(data) ? data : []);

  if (!Array.isArray(list)) {
    logger.warn('Stedi polling returned an unexpected envelope', {
      keys: Object.keys(data ?? {}),
    });
    return { transactions: [], nextPageToken: null };
  }

  return {
    transactions: list.map((t: any) => ({
      transactionId: t.transactionId ?? t.id,
      transactionType: String(
        t.transactionType ?? t.transactionSetId ?? t.type ?? '',
      ) || null,
      createdAt: t.createdAt ?? t.processedAt ?? null,
    })).filter((t: PolledTransaction) => !!t.transactionId),
    nextPageToken: data?.nextPageToken ?? data?.pageToken ?? null,
  };
}

/**
 * Retrieve one processed 835 as JSON.
 *
 * Stedi returns the same JSON shape as the Change Healthcare Convert Reports
 * API, which is what stedi835Normalizer maps.
 */
export async function fetch835Report(params: {
  apiKey: string;
  transactionId: string;
}): Promise<any> {
  const { apiKey, transactionId } = params;
  const url = `${STEDI_HEALTHCARE_BASE}${report835Path(transactionId)}`;

  const response = await fetch(url, { method: 'GET', headers: headers(apiKey) });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Stedi 835 report fetch failed for ${transactionId} (${response.status}): ${body.slice(0, 300)}`,
    );
  }

  return response.json();
}

/** True when a polled transaction is a remittance rather than a 277CA. */
export function is835(transaction: PolledTransaction): boolean {
  return String(transaction.transactionType ?? '').includes('835');
}
