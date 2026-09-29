/**
 * ERA line-item auto-matching — the match/post split.
 *
 * What these pin, and why each matters with real money:
 *
 *  - CLP01 claim-reference matching: the 837 sends claims.claimNumber as
 *    patientControlNumber and the payer echoes it back, so a reference match
 *    names OUR OWN claim. It links even when the payer mangles the patient
 *    name — but never when the money disagrees with the claim.
 *  - Ambiguity is a human's call: several plausible claims, or a reference
 *    that fits more than one, leaves the line unmatched with a visible
 *    review reason. Auto-match never guesses where dollars land.
 *  - Idempotency: the poller re-sees transactions by design (the cursor
 *    rewinds 90 minutes every run), so re-matching must be a no-op for
 *    every line already matched — and a manual match is never overwritten.
 *  - Matching posts nothing. Posting is a separate step, gated by
 *    ERA_AUTO_POST in the poller, and autoMatchRemittance posts each
 *    auto-matched line's payment exactly once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  state: {
    remittance: null as any,
    claims: [] as any[],
    claimLines: [] as any[],
    cptCodes: [] as any[],
    feeSchedules: [] as any[],
    lineItemUpdateCount: 0,
    claimUpdates: [] as any[],
    remitUpdates: [] as any[],
  },
  postPayment: vi.fn(),
  ensureFollowUp: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/phiEncryptionService', () => ({
  decryptRemittanceLineItem: (i: any) => i,
  decryptField: (v: any) => v,
}));
vi.mock('../services/paymentPostingService', () => ({ postPayment: H.postPayment }));
vi.mock('../services/underpaymentPipelineService', () => ({
  ensureUnderpaymentFollowUp: H.ensureFollowUp,
}));

vi.mock('../db', async () => {
  // Pull real table objects so from(table) can be told apart by identity.
  // (schema has no dependency on ../db, so importing it here is safe.)
  const schema = await import('@shared/schema');
  const tables = () => schema;

  /** Recursively pull bound parameter values out of a drizzle SQL tree. */
  const paramValues = (node: any, out: any[] = []): any[] => {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      for (const n of node) paramValues(n, out);
      return out;
    }
    if ('value' in node && 'encoder' in node) {
      out.push(node.value);
      return out;
    }
    if (node.queryChunks) paramValues(node.queryChunks, out);
    return out;
  };

  const rowsFor = (table: any, shape: any): any[] => {
    const { claims, claimLineItems, cptCodes, remittanceLineItems, feeSchedules } = tables();
    const s = H.state;
    if (table === claims) {
      if (shape && 'patientFirstName' in shape) return s.claims.map((c: any) => ({ ...c }));
      return s.claims.map((c: any) => ({ claimId: c.claimId, claimNumber: c.claimNumber }));
    }
    if (table === claimLineItems) return s.claimLines.map((l: any) => ({ ...l }));
    if (table === cptCodes) return s.cptCodes.map((c: any) => ({ ...c }));
    if (table === feeSchedules) return s.feeSchedules.map((f: any) => ({ ...f }));
    if (table === remittanceLineItems) return s.remittance.lineItems.map((li: any) => ({ ...li }));
    return [];
  };

  const makeBuilder = (shape: any) => {
    let table: any = null;
    const b: any = {
      from: (t: any) => ((table = t), b),
      innerJoin: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => b,
      then: (resolve: any, reject: any) => {
        try {
          return Promise.resolve(rowsFor(table, shape)).then(resolve, reject);
        } catch (e) {
          return Promise.reject(e).then(resolve, reject);
        }
      },
    };
    return b;
  };

  const db: any = {
    select: (shape?: any) => makeBuilder(shape),
    selectDistinct: (shape?: any) => makeBuilder(shape),
    update: (table: any) => ({
      set: (values: any) => ({
        where: (cond: any) => {
          const { claims, remittanceLineItems, remittanceAdvice } = tables();
          const s = H.state;
          if (table === remittanceLineItems) {
            const id = paramValues(cond).find((v) => typeof v === 'number');
            const line = s.remittance.lineItems.find((li: any) => li.id === id);
            if (line) Object.assign(line, values);
            s.lineItemUpdateCount++;
          } else if (table === claims) {
            s.claimUpdates.push(values);
          } else if (table === remittanceAdvice) {
            s.remitUpdates.push(values);
            H.state.remittance.status = values.status;
          }
          return Promise.resolve([]);
        },
      }),
    }),
    query: {
      remittanceAdvice: {
        findFirst: async () => {
          const r = H.state.remittance;
          if (!r) return undefined;
          return { ...r, lineItems: r.lineItems.map((li: any) => ({ ...li })) };
        },
      },
    },
  };
  return { db, getDb: () => db };
});

import {
  matchRemittanceLineItems,
  autoMatchRemittance,
} from '../services/eraAutoMatchService';

const claim = (over: any = {}) => ({
  claimId: 7,
  claimNumber: 'CLM-1001',
  patientId: 70,
  patientFirstName: 'John',
  patientLastName: 'Smith',
  totalAmount: '250.00',
  status: 'submitted',
  createdAt: new Date('2026-08-01'),
  ...over,
});

const line = (over: any = {}) => ({
  id: 1,
  remittanceId: 500,
  claimId: null,
  status: 'unmatched',
  patientName: 'John Smith',
  memberId: 'M1',
  claimReference: null,
  payerClaimId: null,
  serviceDate: '2026-08-12',
  cptCode: '97153',
  chargedAmount: '250.00',
  allowedAmount: '200.00',
  paidAmount: '160.00',
  adjustmentAmount: '90.00',
  patientResponsibility: '40.00',
  matchType: null,
  matchedAt: null,
  matchReviewReason: null,
  autoPostedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.state.remittance = {
    id: 500,
    practiceId: 1,
    payerName: 'Horizon BCBS NJ',
    checkNumber: 'CHK-1',
    checkDate: '2026-08-20',
    receivedDate: '2026-08-21',
    status: 'pending',
    lineItems: [],
  };
  H.state.claims = [];
  H.state.claimLines = [];
  H.state.cptCodes = [];
  H.state.feeSchedules = [];
  H.state.lineItemUpdateCount = 0;
  H.state.claimUpdates = [];
  H.state.remitUpdates = [];
  H.postPayment.mockResolvedValue({ id: 1 });
});

describe('matchRemittanceLineItems — claim reference (CLP01)', () => {
  it('links a line to the claim named by its claim reference', async () => {
    H.state.claims = [claim()];
    // Payer mangled the name — the reference is OUR claim number and wins.
    H.state.remittance.lineItems = [line({ claimReference: 'CLM-1001', patientName: 'SMITH^JOHN Q' })];

    const result = await matchRemittanceLineItems(1, 500);

    expect(result).not.toBeNull();
    expect(result!.linked).toBe(1);
    const li = H.state.remittance.lineItems[0];
    expect(li.claimId).toBe(7);
    expect(li.status).toBe('matched');
    expect(li.matchType).toBe('claim_number');
    expect(li.matchReviewReason).toBeNull();
  });

  it('matches the reference case-insensitively and via the CLM{id} fallback', async () => {
    H.state.claims = [claim({ claimId: 9, claimNumber: null })];
    H.state.remittance.lineItems = [line({ claimReference: 'clm9', patientName: 'Nobody Known' })];

    const result = await matchRemittanceLineItems(1, 500);

    expect(result!.linked).toBe(1);
    expect(H.state.remittance.lineItems[0].claimId).toBe(9);
  });

  it('leaves the line unmatched when the referenced claim disagrees on amount', async () => {
    H.state.claims = [claim({ totalAmount: '250.00' })];
    H.state.remittance.lineItems = [line({ claimReference: 'CLM-1001', chargedAmount: '990.00' })];

    const result = await matchRemittanceLineItems(1, 500);

    // The reference says one claim, the money says otherwise — a human must
    // decide. Never link on a guess.
    expect(result!.linked).toBe(0);
    expect(result!.needsReview).toBe(1);
    const li = H.state.remittance.lineItems[0];
    expect(li.claimId).toBeNull();
    expect(li.status).toBe('unmatched');
    expect(li.matchReviewReason).toBe('claim_number_amount_mismatch');
  });

  it('tolerates a sub-dollar amount difference on a reference match', async () => {
    H.state.claims = [claim({ totalAmount: '250.00' })];
    H.state.remittance.lineItems = [line({ claimReference: 'CLM-1001', chargedAmount: '250.75' })];

    const result = await matchRemittanceLineItems(1, 500);

    expect(result!.linked).toBe(1);
    expect(H.state.remittance.lineItems[0].claimId).toBe(7);
  });

  it('accepts a per-service-line charge on a multi-line claim', async () => {
    H.state.claims = [claim({ totalAmount: '400.00' })];
    H.state.claimLines = [
      { id: 1, claimId: 7, cptCodeId: 1, dateOfService: '2026-08-12', amount: '250.00' },
      { id: 2, claimId: 7, cptCodeId: 2, dateOfService: '2026-08-12', amount: '150.00' },
    ];
    // An 835 SVC line carries the line charge, not the claim total.
    H.state.remittance.lineItems = [line({ claimReference: 'CLM-1001', chargedAmount: '150.00' })];

    const result = await matchRemittanceLineItems(1, 500);

    expect(result!.linked).toBe(1);
  });

  it('flags a reference that fits more than one claim instead of picking one', async () => {
    H.state.claims = [
      claim({ claimId: 7, claimNumber: 'CLM-1001' }),
      claim({ claimId: 8, claimNumber: 'clm-1001', patientId: 71 }),
    ];
    H.state.remittance.lineItems = [line({ claimReference: 'CLM-1001' })];

    const result = await matchRemittanceLineItems(1, 500);

    expect(result!.linked).toBe(0);
    expect(H.state.remittance.lineItems[0].matchReviewReason).toBe('ambiguous_claim_reference');
    expect(H.state.remittance.lineItems[0].claimId).toBeNull();
  });
});

describe('matchRemittanceLineItems — scored fallback and ambiguity', () => {
  it('falls back to identity scoring when there is no usable reference', async () => {
    H.state.claims = [claim()];
    H.state.remittance.lineItems = [line({ claimReference: null })];

    const result = await matchRemittanceLineItems(1, 500);

    expect(result!.linked).toBe(1);
    const li = H.state.remittance.lineItems[0];
    expect(li.claimId).toBe(7);
    expect(li.matchType).toContain('exact_name');
  });

  it('leaves the line unmatched when several claims are equally plausible', async () => {
    // Same patient, two submitted claims, and the line carries nothing that
    // separates them: both score identically on name alone.
    H.state.claims = [
      claim({ claimId: 7, claimNumber: 'A', totalAmount: '999.00' }),
      claim({ claimId: 8, claimNumber: 'B', totalAmount: '888.00' }),
    ];
    H.state.remittance.lineItems = [
      line({ claimReference: null, serviceDate: null, cptCode: null, chargedAmount: null }),
    ];

    const result = await matchRemittanceLineItems(1, 500);

    expect(result!.linked).toBe(0);
    expect(result!.needsReview).toBe(1);
    const li = H.state.remittance.lineItems[0];
    expect(li.status).toBe('unmatched');
    expect(li.claimId).toBeNull();
    expect(li.matchReviewReason).toBe('multiple_candidates');
  });

  it('still links when corroboration clearly separates one claim from the rest', async () => {
    H.state.cptCodes = [{ id: 42, code: '97153' }];
    H.state.claimLines = [
      { id: 1, claimId: 7, cptCodeId: 42, dateOfService: '2026-08-12', amount: '250.00' },
    ];
    H.state.claims = [
      claim({ claimId: 7, claimNumber: 'A' }), // name + date + cpt + amount
      claim({ claimId: 8, claimNumber: 'B', totalAmount: '888.00' }), // name only
    ];
    H.state.remittance.lineItems = [line({ claimReference: null })];

    const result = await matchRemittanceLineItems(1, 500);

    expect(result!.linked).toBe(1);
    expect(H.state.remittance.lineItems[0].claimId).toBe(7);
  });

  it('matches nothing below the identity threshold', async () => {
    H.state.claims = [claim({ patientFirstName: 'Ada', patientLastName: 'Lovelace' })];
    H.state.remittance.lineItems = [line({ patientName: 'John Smith', claimReference: null })];

    const result = await matchRemittanceLineItems(1, 500);

    expect(result!.linked).toBe(0);
    expect(result!.needsReview).toBe(0);
    expect(H.state.remittance.lineItems[0].status).toBe('unmatched');
  });
});

describe('matchRemittanceLineItems — idempotency and manual matches', () => {
  it('is a no-op on re-run: matched lines are never re-decided', async () => {
    H.state.claims = [claim()];
    H.state.remittance.lineItems = [line({ claimReference: 'CLM-1001' })];

    const first = await matchRemittanceLineItems(1, 500);
    expect(first!.linked).toBe(1);
    const updatesAfterFirst = H.state.lineItemUpdateCount;

    // The poller rewinds its cursor 90 minutes every run, so the same
    // remittance is re-seen by design. Nothing may change on the re-run.
    const second = await matchRemittanceLineItems(1, 500);
    expect(second!.linked).toBe(0);
    expect(second!.total).toBe(0);
    expect(H.state.lineItemUpdateCount).toBe(updatesAfterFirst);
  });

  it('never overwrites a manual match, even when the reference disagrees', async () => {
    H.state.claims = [claim({ claimId: 7, claimNumber: 'CLM-1001' })];
    // A human already put this line on claim 99. The reference points at 7.
    H.state.remittance.lineItems = [
      line({ status: 'matched', claimId: 99, matchType: 'manual', claimReference: 'CLM-1001' }),
    ];

    const result = await matchRemittanceLineItems(1, 500);

    expect(result!.total).toBe(0);
    expect(H.state.remittance.lineItems[0].claimId).toBe(99);
    expect(H.state.remittance.lineItems[0].matchType).toBe('manual');
    expect(H.state.lineItemUpdateCount).toBe(0);
  });

  it('posts NO payment — matching is not the money step', async () => {
    H.state.claims = [claim()];
    H.state.remittance.lineItems = [line({ claimReference: 'CLM-1001' })];

    await matchRemittanceLineItems(1, 500);

    expect(H.postPayment).not.toHaveBeenCalled();
    expect(H.ensureFollowUp).not.toHaveBeenCalled();
  });

  it('returns null for a remittance that does not exist for the practice', async () => {
    H.state.remittance = null;
    expect(await matchRemittanceLineItems(1, 500)).toBeNull();
  });
});

describe('autoMatchRemittance — posting the matched lines', () => {
  it('matches and posts a fresh remittance in one pass', async () => {
    H.state.claims = [claim()];
    H.state.remittance.lineItems = [line({ claimReference: 'CLM-1001' })];

    const result = await autoMatchRemittance(1, 500, 'user-1');

    expect(result!.matched).toBe(1);
    expect(result!.posted).toBe(1);
    expect(H.postPayment).toHaveBeenCalledTimes(1);
    const [practiceId, posting] = H.postPayment.mock.calls[0];
    expect(practiceId).toBe(1);
    expect(posting.claimId).toBe(7);
    expect(posting.source).toBe('era');
    expect(posting.paymentAmount).toBe('160.00');
    expect(H.state.remittance.lineItems[0].autoPostedAt).not.toBeNull();
    // Everything matched and posted — the remittance is done.
    expect(H.state.remitUpdates.at(-1).status).toBe('processed');
  });

  it('posts a line an earlier match-only pass linked while auto-post was off', async () => {
    H.state.claims = [claim()];
    H.state.remittance.lineItems = [
      line({ status: 'matched', claimId: 7, matchType: 'claim_number', autoPostedAt: null }),
    ];

    const result = await autoMatchRemittance(1, 500, 'user-1');

    expect(result!.matched).toBe(0); // nothing new to match…
    expect(result!.posted).toBe(1); // …but the money gets recorded
    expect(result!.total).toBe(1);
    expect(H.postPayment).toHaveBeenCalledTimes(1);
  });

  it('never re-posts: a second run records nothing new', async () => {
    H.state.claims = [claim()];
    H.state.remittance.lineItems = [line({ claimReference: 'CLM-1001' })];

    await autoMatchRemittance(1, 500, null);
    await autoMatchRemittance(1, 500, null);

    // The second run must not double-count the payment — postPayment does
    // not dedupe ERA postings, so this gate is the only defence.
    expect(H.postPayment).toHaveBeenCalledTimes(1);
  });

  it('does not post legacy or manual matches', async () => {
    H.state.claims = [claim()];
    H.state.remittance.lineItems = [
      // Matched before the split existed: posted under the old fused path.
      line({ id: 1, status: 'matched', claimId: 7, matchType: null }),
      // Matched by a human: the manual-match route posted it itself.
      line({ id: 2, status: 'matched', claimId: 7, matchType: 'manual' }),
    ];

    const result = await autoMatchRemittance(1, 500, null);

    expect(result!.posted).toBe(0);
    expect(H.postPayment).not.toHaveBeenCalled();
  });

  it('surfaces a posting failure and leaves the line eligible for retry', async () => {
    H.state.claims = [claim()];
    H.state.remittance.lineItems = [line({ claimReference: 'CLM-1001' })];
    H.postPayment.mockRejectedValueOnce(new Error('db down'));

    const result = await autoMatchRemittance(1, 500, null);

    expect(result!.postingFailures).toEqual([{ claimId: 7, lineItemId: 1 }]);
    expect(H.state.remittance.lineItems[0].autoPostedAt).toBeNull();
    // Matched-but-unposted must NOT read as done.
    expect(H.state.remitUpdates.at(-1).status).toBe('pending');

    // The button can be pressed again once the underlying problem is fixed.
    const retry = await autoMatchRemittance(1, 500, null);
    expect(retry!.posted).toBe(1);
  });
});
