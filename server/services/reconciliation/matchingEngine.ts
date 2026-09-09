/**
 * Deposit reconciliation matching engine. Pure function: takes a practice's
 * unmatched bank credits and unreconciled remittances, returns matches +
 * exceptions. Persistence is the caller's job (reconciliationService).
 *
 * Rules, in order of confidence:
 *  1. trace  — the ERA's EFT trace/check number appears in the bank descriptor
 *              (CCD+ reassociation). Deterministic, confidence 1.0.
 *  2. exact  — a single remittance whose amount equals the deposit, payer name
 *              in the descriptor, within the date window. Confidence 0.9.
 *  3. bundle — >=2 same-payer remittances in window summing exactly to the
 *              deposit. Confidence 0.75.
 * Ambiguity is never guessed: two identical candidates wait for trace info or
 * manual matching rather than a coin flip.
 */

export interface ExpectedDeposit {
  remittanceId: number;
  payerName: string;
  /** EFT trace / check number from the 835 TRN segment, when present. */
  traceNumber: string | null;
  /** YYYY-MM-DD the payer says funds were issued. */
  effectiveDate: string;
  /** Remitted amount in integer cents. */
  amountCents: number;
}

export interface CandidateTransaction {
  bankTransactionId: number;
  /** YYYY-MM-DD posting date. */
  postedDate: string;
  descriptor: string;
  /** Positive = credit. */
  amountCents: number;
  pending: boolean;
}

export type MatchKind = 'trace' | 'exact' | 'bundle';

export interface EngineMatch {
  bankTransactionId: number;
  kind: MatchKind;
  confidence: number;
  remittanceIds: number[];
}

export type EngineExceptionType = 'missing_deposit' | 'amount_mismatch' | 'unmatched_deposit';

export interface EngineException {
  type: EngineExceptionType;
  remittanceId?: number;
  bankTransactionId?: number;
  detail: string;
}

export interface EngineOptions {
  /** Deposit may post this many business days after the ERA effective date. */
  windowBusinessDays?: number;
  /** Remittance with no deposit after this many business days -> missing_deposit. */
  missingAfterBusinessDays?: number;
  /** "Today" for aging decisions, YYYY-MM-DD. */
  today: string;
  /** Max same-payer candidates considered for bundle subset-sum. */
  maxBundleCandidates?: number;
}

export interface EngineOutcome {
  matches: EngineMatch[];
  exceptions: EngineException[];
}

const DEFAULTS = {
  windowBusinessDays: 5,
  missingAfterBusinessDays: 7,
  maxBundleCandidates: 16,
};

export function runMatching(
  transactions: CandidateTransaction[],
  expected: ExpectedDeposit[],
  opts: EngineOptions,
): EngineOutcome {
  const windowDays = opts.windowBusinessDays ?? DEFAULTS.windowBusinessDays;
  const missingAfter = opts.missingAfterBusinessDays ?? DEFAULTS.missingAfterBusinessDays;
  const maxCandidates = opts.maxBundleCandidates ?? DEFAULTS.maxBundleCandidates;

  const matches: EngineMatch[] = [];
  const exceptions: EngineException[] = [];
  const openTxns = transactions
    .filter((t) => !t.pending && t.amountCents > 0)
    .sort((a, b) => a.postedDate.localeCompare(b.postedDate));
  const openEds = new Map(expected.map((e) => [e.remittanceId, e]));
  const matchedTxnIds = new Set<number>();

  const take = (txn: CandidateTransaction, kind: MatchKind, confidence: number, eds: ExpectedDeposit[]) => {
    matches.push({
      bankTransactionId: txn.bankTransactionId,
      kind,
      confidence,
      remittanceIds: eds.map((e) => e.remittanceId),
    });
    matchedTxnIds.add(txn.bankTransactionId);
    for (const e of eds) openEds.delete(e.remittanceId);
  };

  // 1. Trace matches
  for (const txn of openTxns) {
    const traced = Array.from(openEds.values()).filter(
      (e) => e.traceNumber && descriptorContainsTrace(txn.descriptor, e.traceNumber),
    );
    if (traced.length === 0) continue;
    const sum = traced.reduce((s, e) => s + e.amountCents, 0);
    take(txn, 'trace', 1.0, traced);
    if (sum !== txn.amountCents) {
      // Trace linkage is certain, so this is a real discrepancy, not a miss —
      // e.g. an undocumented offset or recoupment.
      exceptions.push({
        type: 'amount_mismatch',
        bankTransactionId: txn.bankTransactionId,
        detail: `Trace-matched deposit of ${fmt(txn.amountCents)} vs remittance total ${fmt(sum)} (remittances: ${traced.map((e) => e.remittanceId).join(', ')})`,
      });
    }
  }

  // 2. Exact single-remittance matches
  for (const txn of openTxns) {
    if (matchedTxnIds.has(txn.bankTransactionId)) continue;
    const candidates = Array.from(openEds.values()).filter(
      (e) =>
        e.amountCents === txn.amountCents &&
        payerInDescriptor(txn.descriptor, e.payerName) &&
        withinWindow(e.effectiveDate, txn.postedDate, windowDays),
    );
    // Only match when unambiguous.
    if (candidates.length === 1) take(txn, 'exact', 0.9, [candidates[0]!]);
  }

  // 3. Bundle matches (one deposit covers several remittances from one payer)
  for (const txn of openTxns) {
    if (matchedTxnIds.has(txn.bankTransactionId)) continue;
    const byPayer = new Map<string, ExpectedDeposit[]>();
    for (const e of Array.from(openEds.values())) {
      if (!payerInDescriptor(txn.descriptor, e.payerName)) continue;
      if (!withinWindow(e.effectiveDate, txn.postedDate, windowDays)) continue;
      const key = normalize(e.payerName);
      (byPayer.get(key) ?? byPayer.set(key, []).get(key)!).push(e);
    }
    for (const group of Array.from(byPayer.values())) {
      if (group.length < 2 || group.length > maxCandidates) continue;
      const subset = subsetSum(group, txn.amountCents);
      // A single-remittance "bundle" is really an exact match rule 2 already
      // declined (ambiguous or out of window) — don't let it back in here.
      if (subset && subset.length >= 2) {
        take(txn, 'bundle', 0.75, subset);
        break;
      }
    }
  }

  // 4. Leftovers -> exceptions
  for (const e of Array.from(openEds.values())) {
    if (businessDaysBetween(e.effectiveDate, opts.today) > missingAfter) {
      exceptions.push({
        type: 'missing_deposit',
        remittanceId: e.remittanceId,
        detail: `${e.payerName} remitted ${fmt(e.amountCents)} on ${e.effectiveDate}; no matching deposit found`,
      });
    }
  }
  for (const txn of openTxns) {
    if (matchedTxnIds.has(txn.bankTransactionId)) continue;
    if (looksLikePayerPayment(txn.descriptor)) {
      exceptions.push({
        type: 'unmatched_deposit',
        bankTransactionId: txn.bankTransactionId,
        detail: `Deposit of ${fmt(txn.amountCents)} on ${txn.postedDate} ("${txn.descriptor}") matches no remittance`,
      });
    }
  }

  return { matches, exceptions };
}

// ---- helpers ----

function normalize(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function descriptorContainsTrace(descriptor: string, trace: string): boolean {
  // Trace numbers are digit runs; require a non-digit boundary so trace
  // "1234" does not match inside "612345".
  const re = new RegExp(`(?<![0-9])${escapeRe(trace)}(?![0-9])`);
  return re.test(descriptor);
}

function payerInDescriptor(descriptor: string, payerName: string): boolean {
  const d = normalize(descriptor);
  const tokens = normalize(payerName)
    .split(' ')
    .filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t));
  if (tokens.length === 0) return false;
  return tokens.some((t) => d.includes(t));
}

const GENERIC_TOKENS = new Set([
  'THE', 'INC', 'LLC', 'CORP', 'COMPANY', 'HEALTH', 'HEALTHCARE', 'INSURANCE',
  'PLAN', 'PLANS', 'GROUP', 'SERVICES', 'AND', 'OF',
]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Business days from `from` to `to` (exclusive of `from`, inclusive of `to`). */
export function businessDaysBetween(from: string, to: string): number {
  const sign = to >= from ? 1 : -1;
  const [lo, hi] = sign === 1 ? [from, to] : [to, from];
  let d = parseDate(lo);
  const end = parseDate(hi);
  let count = 0;
  while (d < end) {
    d = new Date(d.getTime() + 86_400_000);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return sign * count;
}

function withinWindow(effectiveDate: string, txnDate: string, windowDays: number): boolean {
  const diff = businessDaysBetween(effectiveDate, txnDate);
  return diff >= 0 && diff <= windowDays;
}

function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

/** Exact subset-sum over cents via DP; returns the smallest subset found or null. */
function subsetSum(items: ExpectedDeposit[], targetCents: number): ExpectedDeposit[] | null {
  const reachable = new Map<number, number[]>([[0, []]]);
  for (let i = 0; i < items.length; i++) {
    const amount = items[i]!.amountCents;
    // Snapshot to avoid reusing item i twice in one pass.
    for (const [sum, idxs] of Array.from(reachable.entries())) {
      const next = sum + amount;
      if (next > targetCents) continue;
      const existing = reachable.get(next);
      if (!existing || existing.length > idxs.length + 1) {
        reachable.set(next, [...idxs, i]);
      }
    }
  }
  const hit = reachable.get(targetCents);
  if (!hit || hit.length === 0) return null;
  return hit.map((i) => items[i]!);
}

function looksLikePayerPayment(descriptor: string): boolean {
  const d = normalize(descriptor);
  // EDI/ACH healthcare-payment markers. Ordinary revenue (interest, transfers,
  // card payouts) is left alone rather than flagged as an exception.
  return /\b(EDI|HCCLAIMPMT|TRN|EFT|CLAIMPMT|PYMNTS)\b/.test(d);
}

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
