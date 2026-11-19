/**
 * Accounting ledger (QA demo pass 2026-11-19, Accounting page finding).
 *
 * The Accounting page read `stats.totalRevenue`, `insuranceRevenue`,
 * `patientRevenue` and `t.paymentType`, none of which the API returned, so
 * its Insurance and Patient revenue cards were always $0 and the CSV /
 * QuickBooks exports wrote `undefined` for date, type and method.
 *
 * Money reaches the practice through two tables: patient payments in
 * `payment_transactions` (copays, balances, self-pay, Stripe or manual) and
 * insurance payments in `payment_postings` (ERA / manual postings against
 * claims). This module merges both into one ledger with a single row shape
 * the page and its exports can rely on. Pure: callers pass the rows.
 */

export interface LedgerRow {
  /** Stable across sources: "txn-<id>" or "posting-<id>". */
  id: string;
  source: 'patient' | 'insurance';
  /** Calendar day, YYYY-MM-DD. */
  date: string;
  amount: number;
  /** payment | refund | adjustment | write_off (patient); payment (insurance). */
  type: string;
  /** copay | deductible | coinsurance | self_pay | balance | ... for patient rows; 'insurance' for postings. */
  category: string | null;
  /** stripe | manual | cash | check | era | ... */
  method: string | null;
  status: string;
  /** Patient name for patient rows, payer name for insurance rows. */
  party: string;
  patientId: number | null;
  claimId: number | null;
  checkNumber: string | null;
}

export interface PatientPaymentLike {
  id: number;
  patientId?: number | null;
  claimId?: number | null;
  amount: string | number | null;
  type: string | null;
  category?: string | null;
  processor?: string | null;
  status?: string | null;
  processedAt?: Date | string | null;
  createdAt?: Date | string | null;
  checkNumber?: string | null;
}

export interface InsurancePostingLike {
  id: number;
  claimId: number;
  payerName: string | null;
  paymentDate: Date | string | null;
  paymentAmount: string | number | null;
  checkNumber?: string | null;
  source?: string | null;
  postedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

/** The YYYY-MM-DD part of a Date or ISO/date string; null when absent. */
export function isoDay(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * Query-string period → bounds. A date-only `endDate` means the whole of
 * that day: the page sends "To: today" and the previous `new Date('YYYY-MM-DD')`
 * (UTC midnight) excluded everything that happened today.
 */
export function periodBounds(startDate?: string, endDate?: string): {
  start?: Date;
  end?: Date;
  startDay?: string;
  endDay?: string;
} {
  const out: { start?: Date; end?: Date; startDay?: string; endDay?: string } = {};
  if (startDate) {
    const d = new Date(startDate);
    if (!Number.isNaN(d.getTime())) {
      out.start = d;
      out.startDay = isoDay(d) ?? undefined;
    }
  }
  if (endDate) {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(endDate);
    const d = new Date(dateOnly ? `${endDate}T23:59:59.999Z` : endDate);
    if (!Number.isNaN(d.getTime())) {
      out.end = d;
      out.endDay = dateOnly ? endDate : (isoDay(d) ?? undefined);
    }
  }
  return out;
}

function money(value: string | number | null | undefined): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

export function buildLedger(
  transactions: PatientPaymentLike[],
  postings: InsurancePostingLike[],
  patientNames: Map<number, string>,
): LedgerRow[] {
  const rows: LedgerRow[] = [];

  for (const t of transactions) {
    rows.push({
      id: `txn-${t.id}`,
      source: 'patient',
      date: isoDay(t.processedAt) ?? isoDay(t.createdAt) ?? '',
      amount: money(t.amount),
      type: t.type || 'payment',
      category: t.category ?? null,
      method: t.processor ?? null,
      status: t.status || 'pending',
      party: (t.patientId != null && patientNames.get(t.patientId)) || 'Patient',
      patientId: t.patientId ?? null,
      claimId: t.claimId ?? null,
      checkNumber: t.checkNumber ?? null,
    });
  }

  for (const p of postings) {
    rows.push({
      id: `posting-${p.id}`,
      source: 'insurance',
      date: isoDay(p.paymentDate) ?? isoDay(p.postedAt) ?? isoDay(p.createdAt) ?? '',
      amount: money(p.paymentAmount),
      type: 'payment',
      category: 'insurance',
      method: p.source === 'era' ? 'era' : p.checkNumber ? 'check' : (p.source ?? 'manual'),
      status: 'completed',
      party: p.payerName || 'Insurance',
      patientId: null,
      claimId: p.claimId,
      checkNumber: p.checkNumber ?? null,
    });
  }

  // Newest first; ties keep patient rows ahead of insurance rows, then by id.
  const sourceRank = (r: LedgerRow) => (r.source === 'patient' ? 0 : 1);
  rows.sort((a, b) => b.date.localeCompare(a.date) || sourceRank(a) - sourceRank(b) || a.id.localeCompare(b.id));
  return rows;
}
