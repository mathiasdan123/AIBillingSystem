/**
 * Stedi enrollment mappers + response normalization — pure, db-free.
 *
 * Extracted from stediEnrollmentSyncService so these can be unit-tested
 * without provisioning a database (the sync service imports storage/db at
 * module load). The sync service re-exports everything here for back-compat.
 */

import { mapStediEnrollmentStatus } from './stediEnrollmentService';

// Our 4-value enum
export type LocalEnrollmentStatus = 'not_enrolled' | 'pending' | 'enrolled' | 'rejected';
// Our 3-value transaction type enum (mirrors payer_enrollments.transactionType)
export type LocalTransactionType = 'eligibility' | 'claims' | 'era';

/**
 * Stedi → local status map. Delegates to the centralized map in
 * stediEnrollmentService so the READ (sync) and WRITE (create) paths agree
 * on Stedi's 6-state lifecycle.
 */
export function mapStediStatus(raw: string | null | undefined): LocalEnrollmentStatus {
  return mapStediEnrollmentStatus(raw);
}

/**
 * Stedi → local transaction type map (substring-based, lenient). Used for
 * the legacy flat enrollment shape. NOTE: for the `transactions` object
 * keys, use mapStediTransactionKey instead — `claimPayment` must map to ERA.
 */
export function mapStediTransactionType(raw: string | null | undefined): LocalTransactionType | null {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  if (v.includes('eligib') || v.includes('270') || v.includes('271')) return 'eligibility';
  if (v.includes('era') || v.includes('remit') || v.includes('835')) return 'era';
  if (v.includes('claim') || v.includes('837') || v.includes('276') || v.includes('277')) return 'claims';
  return null;
}

/**
 * Stedi transaction KEY (from an enrollment's `transactions` object) → our
 * 3-value enum. Exact-match (not substring): `claimPayment` → ERA, not claims.
 */
export function mapStediTransactionKey(key: string): LocalTransactionType | null {
  switch (key) {
    case 'eligibilityCheck':
      return 'eligibility';
    case 'claimPayment':
      return 'era';
    case 'professionalClaimSubmission':
    case 'institutionalClaimSubmission':
    case 'dentalClaimSubmission':
    case 'claimStatus':
      return 'claims';
    default:
      return null;
  }
}

export interface StediEnrollmentRow {
  payerName: string;
  payerId?: string | null;
  transactionType: LocalTransactionType;
  status: LocalEnrollmentStatus;
  rejectionReason?: string | null;
  approvedAt?: Date | null;
  rejectedAt?: Date | null;
}

/**
 * Normalize Stedi's enrollment list response into our row shape. Handles:
 *   - the confirmed shape: items with a `transactions` object keyed by
 *     transaction name (one enrollment → many rows),
 *   - `transactions` as an array of names (status from the item),
 *   - legacy flat items ({ payerName, transactionType, status }).
 */
export function normalizeStediResponse(data: any): StediEnrollmentRow[] {
  const list: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.enrollments)
      ? data.enrollments
      : Array.isArray(data?.items)
        ? data.items
        : [];

  const rows: StediEnrollmentRow[] = [];
  for (const item of list) {
    if (!item) continue;
    const payerName: string | undefined =
      item.payerName || item.payer?.name || item.tradingPartnerName;
    const payerId: string | undefined | null =
      item.payerId ||
      item.payer?.stediId ||
      item.payer?.primaryPayerId ||
      item.tradingPartnerServiceId ||
      item.tradingPartnerId ||
      item.payer?.id ||
      null;
    if (!payerName) continue;

    const cleanPayerId = payerId ? String(payerId) : null;
    const approvedAt = item.approvedAt ? new Date(item.approvedAt) : null;
    const rejectedAt = item.rejectedAt ? new Date(item.rejectedAt) : null;
    const rejectionReason =
      item.rejectionReason || item.reason || item.denialReason || null;
    const pushRow = (transactionType: LocalTransactionType, rawStatus: any) => {
      rows.push({
        payerName: String(payerName),
        payerId: cleanPayerId,
        transactionType,
        status: mapStediStatus(typeof rawStatus === 'string' ? rawStatus : rawStatus?.status),
        rejectionReason,
        approvedAt: approvedAt && !isNaN(approvedAt.getTime()) ? approvedAt : null,
        rejectedAt: rejectedAt && !isNaN(rejectedAt.getTime()) ? rejectedAt : null,
      });
    };

    // Preferred shape: a `transactions` object keyed by Stedi transaction
    // name, each with its own status. One enrollment → many local rows.
    const txObj = item.transactions;
    if (txObj && typeof txObj === 'object' && !Array.isArray(txObj)) {
      for (const [key, val] of Object.entries(txObj)) {
        const mapped = mapStediTransactionKey(key);
        if (!mapped) continue;
        pushRow(mapped, val ?? item.status ?? item.state);
      }
      continue;
    }

    // `transactions` as an array of transaction-name strings; status from item.
    if (Array.isArray(txObj)) {
      for (const key of txObj) {
        const mapped = typeof key === 'string' ? mapStediTransactionKey(key) : null;
        if (!mapped) continue;
        pushRow(mapped, item.status ?? item.state);
      }
      continue;
    }

    // Legacy flat shape: a single transactionType + status on the item.
    const rawTx: string | undefined =
      item.transactionType || item.transaction || item.type || item.kind;
    const transactionType = mapStediTransactionType(rawTx);
    if (!transactionType) continue;
    pushRow(transactionType, item.status || item.enrollmentStatus || item.state);
  }
  return rows;
}
