/**
 * Payment evidence for a remittance line (#497 third review): "was THIS
 * line's payment recorded?" answered from payment_postings alone — not from
 * matchType or markers (a failed manual post leaves a matched line with no
 * money) and not from any other ERA on the claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({ postings: [] as any[], conds: [] as any[] }));

vi.mock('../db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: any) => {
          H.conds.push(cond);
          return Promise.resolve(H.postings);
        },
      }),
    }),
  },
}));

import { remittancePaymentEvidence, linePaymentEvidence, POSTING_WINDOW_MS } from '../services/paymentEvidenceService';

/** Bound parameter values and column names in a drizzle condition tree. */
function describeCondition(node: any, out: string[] = [], seen = new Set<any>()): string[] {
  if (!node || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) { for (const n of node) describeCondition(n, out, seen); return out; }
  if ('value' in node && 'encoder' in node) { out.push(`param:${String(node.value)}`); return out; }
  if (typeof node.name === 'string' && node.table) { out.push(`col:${node.name}`); return out; }
  if (node.queryChunks) describeCondition(node.queryChunks, out, seen);
  if (typeof node.value === 'string') out.push(`sql:${node.value}`);
  if (Array.isArray(node.value) && node.value.every((v: unknown) => typeof v === 'string')) out.push(`sql:${node.value.join('')}`);
  return out;
}

const REMIT = { checkNumber: 'QA-SYN-1', checkDate: '2026-11-18', receivedDate: '2026-11-19' };
const T0 = new Date('2026-11-19T15:00:00Z');
const later = (ms: number) => new Date(T0.getTime() + ms);
const line = (over: any = {}) => ({ id: 31, status: 'matched', claimId: 73, paidAmount: '0.00', patientResponsibility: '0.00', matchedAt: T0, ...over });
// What postPayment wrote for that line (the query already filtered on practice, claim, source, reversed, check number and payment date).
const posting = (over: any = {}) => ({ id: 1, claimId: 73, paymentAmount: '0.00', patientResponsibility: '0.00', postedAt: later(1000), ...over });

beforeEach(() => {
  H.postings = [];
  H.conds = [];
});

describe('remittancePaymentEvidence', () => {
  it('recorded: a non-reversed ERA posting on the claim with this line\'s amounts, posted after the match', async () => {
    H.postings = [posting()];
    const ev = await remittancePaymentEvidence(1, REMIT, [line()]);
    expect(ev.get(31)).toBe('recorded');
  });

  it('not_recorded: a failed manual post — the line is matched (manual) but no posting exists', async () => {
    H.postings = [];
    const ev = await remittancePaymentEvidence(1, REMIT, [line({ matchType: 'manual' })]);
    expect(ev.get(31)).toBe('not_recorded');
  });

  it('not_recorded: another receipt on the same claim is not this line\'s (different amounts)', async () => {
    // An earlier $0 ERA on the claim is filtered out by check number / date in
    // the query; here a same-check posting with different amounts is the
    // nearest thing to "any ERA on the claim" that reaches the matcher.
    H.postings = [posting({ paymentAmount: '160.00', patientResponsibility: '40.00' })];
    const ev = await remittancePaymentEvidence(1, REMIT, [line()]);
    expect(ev.get(31)).toBe('not_recorded');
  });

  it('not_recorded: a posting from before the line was matched belongs to something else', async () => {
    H.postings = [posting({ postedAt: new Date(T0.getTime() - POSTING_WINDOW_MS - 1000) })];
    const ev = await remittancePaymentEvidence(1, REMIT, [line()]);
    expect(ev.get(31)).toBe('not_recorded');
    // …but clock skew within the window is tolerated.
    H.postings = [posting({ postedAt: new Date(T0.getTime() - POSTING_WINDOW_MS + 1000) })];
    expect((await remittancePaymentEvidence(1, REMIT, [line()])).get(31)).toBe('recorded');
  });

  it('reversal: the query asks only for non-reversed postings (a reversed one is no evidence)', async () => {
    H.postings = [];
    await remittancePaymentEvidence(1, REMIT, [line()]);
    const parts = describeCondition(H.conds[0]);
    expect(parts).toContain('col:reversed');
    expect(parts).toContain('param:false');
    expect(parts).toContain('param:era');
    expect(parts).toContain('param:QA-SYN-1');
    expect(parts).toContain('param:2026-11-18');
  });

  it('ambiguous: two identical lines on one claim but only one posting (legacy data) fails closed for both', async () => {
    H.postings = [posting()];
    const ev = await remittancePaymentEvidence(1, REMIT, [line({ id: 31 }), line({ id: 32 })]);
    expect(ev.get(31)).toBe('ambiguous');
    expect(ev.get(32)).toBe('ambiguous');
    // Each line with its own posting is recorded.
    H.postings = [posting({ id: 1 }), posting({ id: 2 })];
    const ok = await remittancePaymentEvidence(1, REMIT, [line({ id: 31 }), line({ id: 32 })]);
    expect(ok.get(31)).toBe('recorded');
    expect(ok.get(32)).toBe('recorded');
  });

  it('a legacy line with no matchedAt is accepted on amounts alone; unmatched lines have no entry', async () => {
    H.postings = [posting({ postedAt: new Date('2025-01-01') })];
    const ev = await remittancePaymentEvidence(1, REMIT, [line({ matchedAt: null }), line({ id: 40, status: 'unmatched', claimId: null })]);
    expect(ev.get(31)).toBe('recorded');
    expect(ev.has(40)).toBe(false);
    expect(await linePaymentEvidence(1, REMIT, [line({ id: 40, status: 'unmatched', claimId: null })], 40)).toBe('not_recorded');
  });

  it('uses the received date when the remittance has no check date, and null check numbers match null', async () => {
    H.postings = [posting()];
    const ev = await remittancePaymentEvidence(1, { checkNumber: null, checkDate: null, receivedDate: '2026-11-19' }, [line()]);
    expect(ev.get(31)).toBe('recorded');
    const parts = describeCondition(H.conds[0]);
    expect(parts).toContain('param:2026-11-19');
    expect(parts.some((p) => /is null/i.test(p))).toBe(true);
  });
});
