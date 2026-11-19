/**
 * Payment evidence for a remittance line (#497 third review).
 *
 * Read-only. Answers "was THIS line's payment recorded?" from the
 * payment_postings rows themselves — never from matchType or markers on the
 * line (the manual match route writes the match before it posts, so a failed
 * or crashed posting leaves a matched line with no money) and never from
 * "some ERA posting exists on the claim" (that may belong to another line or
 * an older remittance).
 *
 * Postings do not carry the line id, so the evidence is the posting's
 * fingerprint, which both posting paths write from the line and its
 * remittance: same claim, source 'era', not reversed, the remittance's check
 * number and payment date, the line's paid amount and patient
 * responsibility, posted no earlier than the line was matched (both paths
 * match first, then post; a small tolerance covers clock skew). When several
 * lines of the remittance share a fingerprint on one claim, each needs its
 * own posting; fewer postings than lines is AMBIGUOUS and fails closed.
 *
 * Every denial entry path (manual match, retry-denial, Auto-Match) and the
 * remittance completion decision use this. 'recorded' is the only answer
 * that lets a denial be applied or a remittance be marked processed.
 */

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { paymentPostings } from '@shared/schema';
import { db } from '../db';

export type PaymentEvidence = 'recorded' | 'not_recorded' | 'ambiguous';

export interface EvidenceRemittance {
  checkNumber?: string | null;
  checkDate?: string | null;
  receivedDate?: string | null;
}

export interface EvidenceLine {
  id: number;
  status?: string | null;
  claimId?: number | null;
  paidAmount?: string | number | null;
  patientResponsibility?: string | number | null;
  matchedAt?: Date | string | null;
}

/** Clock skew between the app's matchedAt and the database's posted_at default. */
export const POSTING_WINDOW_MS = 5 * 60 * 1000;

const cents = (v: string | number | null | undefined): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

const toMs = (v: Date | string | null | undefined): number | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

/** The payment date both posting paths write for a remittance's lines. */
export function remittancePaymentDate(remittance: EvidenceRemittance): string | null {
  return remittance.checkDate ?? remittance.receivedDate ?? null;
}

function fingerprint(line: EvidenceLine): string {
  return `${line.claimId}|${cents(line.paidAmount)}|${cents(line.patientResponsibility)}`;
}

/**
 * Evidence for every MATCHED line of a remittance, by line id. One query.
 * Unmatched lines are absent from the map.
 */
export async function remittancePaymentEvidence(
  practiceId: number,
  remittance: EvidenceRemittance,
  lines: EvidenceLine[],
): Promise<Map<number, PaymentEvidence>> {
  const out = new Map<number, PaymentEvidence>();
  const matched = lines.filter((l) => l.status === 'matched' && l.claimId != null);
  if (matched.length === 0) return out;

  const claimIds = Array.from(new Set(matched.map((l) => l.claimId as number)));
  const paymentDate = remittancePaymentDate(remittance);
  const conditions = [
    eq(paymentPostings.practiceId, practiceId),
    inArray(paymentPostings.claimId, claimIds),
    eq(paymentPostings.source, 'era'),
    eq(paymentPostings.reversed, false),
    remittance.checkNumber ? eq(paymentPostings.checkNumber, remittance.checkNumber) : isNull(paymentPostings.checkNumber),
  ];
  if (paymentDate) conditions.push(eq(paymentPostings.paymentDate, paymentDate));

  const postings = (await db
    .select({
      id: paymentPostings.id,
      claimId: paymentPostings.claimId,
      paymentAmount: paymentPostings.paymentAmount,
      patientResponsibility: paymentPostings.patientResponsibility,
      postedAt: paymentPostings.postedAt,
    })
    .from(paymentPostings)
    .where(and(...conditions))) as Array<{
    id: number;
    claimId: number;
    paymentAmount: string | null;
    patientResponsibility: string | null;
    postedAt: Date | string | null;
  }>;

  // Lines sharing a fingerprint on the same claim each need their own posting.
  const groups = new Map<string, EvidenceLine[]>();
  for (const line of matched) {
    const key = fingerprint(line);
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  for (const [key, groupLines] of Array.from(groups.entries())) {
    const matchedAts = groupLines.map((l: EvidenceLine) => toMs(l.matchedAt)).filter((t: number | null): t is number => t != null);
    const earliestMatch = matchedAts.length ? Math.min(...matchedAts) : null;
    const count = postings.filter((p) => {
      if (`${p.claimId}|${cents(p.paymentAmount)}|${cents(p.patientResponsibility)}` !== key) return false;
      if (earliestMatch == null) return true; // no matchedAt on record (legacy): no time constraint
      const postedAt = toMs(p.postedAt);
      return postedAt == null ? false : postedAt >= earliestMatch - POSTING_WINDOW_MS;
    }).length;
    const evidence: PaymentEvidence = count === 0 ? 'not_recorded' : count >= groupLines.length ? 'recorded' : 'ambiguous';
    for (const line of groupLines) out.set(line.id, evidence);
  }
  return out;
}

/** Evidence for one line of a remittance (its siblings matter for ambiguity). */
export async function linePaymentEvidence(
  practiceId: number,
  remittance: EvidenceRemittance,
  lines: EvidenceLine[],
  lineId: number,
): Promise<PaymentEvidence> {
  const map = await remittancePaymentEvidence(practiceId, remittance, lines);
  return map.get(lineId) ?? 'not_recorded';
}

export function describePaymentEvidence(evidence: PaymentEvidence): string {
  switch (evidence) {
    case 'recorded':
      return 'payment recorded';
    case 'ambiguous':
      return 'payment evidence is ambiguous (fewer postings than identical lines on this claim) — needs manual review';
    default:
      return 'payment not recorded — needs manual review';
  }
}
