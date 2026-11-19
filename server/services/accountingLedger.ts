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

import { getBusinessTimeZone, zonedAddDays, zonedDateString, zonedInstant } from '../utils/timezone';

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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar day of a value. A date-only string (a `date` column such as
 * payment_date) is taken as is. A Date or timestamp is read in the practice
 * zone, so a payment processed at 8:30 PM Eastern on the 18th is the 18th,
 * not the 19th it would be in UTC.
 */
export function isoDay(value: Date | string | null | undefined, timeZone: string = getBusinessTimeZone()): string | null {
  if (!value) return null;
  if (typeof value === 'string' && DATE_ONLY.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    // Not a timestamp: accept a leading YYYY-MM-DD if there is one.
    const s = String(value);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  }
  return zonedDateString(d, timeZone);
}

/**
 * Query-string period → bounds, in the practice's timezone. A date-only
 * `startDate` is local midnight of that day; a date-only `endDate` is the
 * last millisecond of that local day, so "To: today" includes a payment
 * taken this evening (the previous `new Date('YYYY-MM-DD')` was UTC
 * midnight, which cut the whole local day off). A full timestamp is used as
 * given. `startDay` / `endDay` are the calendar days for `date` columns.
 */
export function periodBounds(
  startDate?: string,
  endDate?: string,
  timeZone: string = getBusinessTimeZone(),
): {
  start?: Date;
  end?: Date;
  startDay?: string;
  endDay?: string;
} {
  const out: { start?: Date; end?: Date; startDay?: string; endDay?: string } = {};
  if (startDate) {
    if (DATE_ONLY.test(startDate)) {
      const d = zonedInstant(startDate, '00:00', timeZone);
      if (!Number.isNaN(d.getTime())) {
        out.start = d;
        out.startDay = startDate;
      }
    } else {
      const d = new Date(startDate);
      if (!Number.isNaN(d.getTime())) {
        out.start = d;
        out.startDay = zonedDateString(d, timeZone);
      }
    }
  }
  if (endDate) {
    if (DATE_ONLY.test(endDate)) {
      // Start of the next local day, minus one millisecond: an inclusive bound
      // for the `lte` the storage queries use.
      const nextDay = zonedInstant(endDate, '00:00', timeZone);
      if (!Number.isNaN(nextDay.getTime())) {
        const nextLocalMidnight = zonedInstant(zonedDateString(zonedAddDays(nextDay, 1, timeZone), timeZone), '00:00', timeZone);
        out.end = new Date(nextLocalMidnight.getTime() - 1);
        out.endDay = endDate;
      }
    } else {
      const d = new Date(endDate);
      if (!Number.isNaN(d.getTime())) {
        out.end = d;
        out.endDay = zonedDateString(d, timeZone);
      }
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
  timeZone: string = getBusinessTimeZone(),
): LedgerRow[] {
  const rows: LedgerRow[] = [];

  for (const t of transactions) {
    rows.push({
      id: `txn-${t.id}`,
      source: 'patient',
      date: isoDay(t.processedAt, timeZone) ?? isoDay(t.createdAt, timeZone) ?? '',
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
      date: isoDay(p.paymentDate, timeZone) ?? isoDay(p.postedAt, timeZone) ?? isoDay(p.createdAt, timeZone) ?? '',
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
