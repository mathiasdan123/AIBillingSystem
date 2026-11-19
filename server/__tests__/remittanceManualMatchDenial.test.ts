/**
 * Manual ERA match route (demo billing test 2026-11-19, item 5; #497 reviews):
 *  - a line cannot be matched to a claim that has no recorded submission
 *    evidence (draft/held with no submission date, clearinghouse attempt or
 *    'submitted' event); a held claim the clearinghouse rejected, or
 *    sent-but-unconfirmed, or a reopened draft, CAN be — the ERA settles
 *    them — and the refusal never says "resubmit";
 *  - the posting carries the CARC / RARC and the LINE ID: one posting
 *    identity shared with the auto path, unique while active, so a
 *    simultaneous request or a retry is told "already posted";
 *  - lines matched before line ids were kept on postings fail closed: never
 *    posted again from here;
 *  - a denied line (CLP02 4) applies the denial after posting; the response
 *    reports the real pipeline state and a partial-success retry path;
 *  - the retry-denial route re-runs ONLY the denial step, never posts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  state: {
    remittance: null as any, lineItem: null as any, claim: null as any, events: [] as any[], receipt: null as any,
    allLines: [] as any[], lineUpdates: [] as any[], remitUpdates: [] as any[],
  },
  post: vi.fn(),
  receipt: vi.fn(),
  applyDenial: vi.fn(),
  autoMatch: vi.fn(),
}));

vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/paymentPostingService', () => ({ postRemittanceLinePayment: H.post, findLinePosting: H.receipt }));
vi.mock('../services/eraDenialService', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  applyRemittanceDenialToLine: H.applyDenial,
}));
vi.mock('../services/eraAutoMatchService', () => ({ autoMatchRemittance: H.autoMatch }));
vi.mock('../services/remittanceIngestionService', () => ({ ingestRemittance: vi.fn() }));
vi.mock('../services/underpaymentPipelineService', () => ({ ensureUnderpaymentFollowUp: vi.fn() }));
vi.mock('../services/underpaymentAnalyzer', () => ({ assessUnderpayment: vi.fn() }));
vi.mock('../services/phiEncryptionService', () => ({
  encryptRemittanceLineItem: (i: any) => i,
  decryptRemittanceLineItem: (i: any) => i,
  decryptField: (v: any) => v,
}));
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'biller-1' } };
    req.userRole = 'billing';
    req.userPracticeId = 1;
    next();
  },
}));
vi.mock('../db', async () => {
  const schema = await import('@shared/schema');
  /** Bound parameter values in a drizzle condition, to tell the by-id line select from the whole-remittance one. */
  const paramValues = (node: any, out: any[] = []): any[] => {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) { for (const n of node) paramValues(n, out); return out; }
    if ('value' in node && 'encoder' in node) { out.push(node.value); return out; }
    if (node.queryChunks) paramValues(node.queryChunks, out);
    return out;
  };
  const rowsFor = (table: any, cond: any): any[] => {
    const s = H.state;
    if (table === schema.remittanceLineItems) {
      const byId = paramValues(cond).filter((v) => typeof v === 'number').length >= 2;
      if (byId) return s.lineItem ? [s.lineItem] : [];
      return H.state.allLines.length ? H.state.allLines : s.lineItem ? [s.lineItem] : [];
    }
    if (table === schema.claims) return s.claim ? [s.claim] : [];
    if (table === schema.claimEvents) return s.events;
    return [];
  };
  const builder = () => {
    let table: any = null;
    let cond: any = null;
    const b: any = {
      from: (t: any) => ((table = t), b),
      where: (c: any) => ((cond = c), b),
      then: (resolve: any, reject: any) => Promise.resolve(rowsFor(table, cond)).then(resolve, reject),
    };
    return b;
  };
  const db: any = {
    select: () => builder(),
    update: (table: any) => ({
      set: (values: any) => ({
        where: () => {
          if (table === schema.remittanceLineItems) {
            H.state.lineUpdates.push(values);
            Object.assign(H.state.lineItem, values);
          }
          if (table === schema.remittanceAdvice) H.state.remitUpdates.push(values);
          return Promise.resolve([]);
        },
      }),
    }),
    query: { remittanceAdvice: { findFirst: async () => H.state.remittance } },
  };
  return { db, getDb: () => db };
});

import remittanceRouter from '../routes/remittance';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/remittance', remittanceRouter);
  return app;
}

const CARC_197 = 'CO-197: Contractual Obligations: Precertification/authorization/notification absent';
const DENIED_LINE = () => ({
  id: 31, remittanceId: 500, claimId: null, status: 'unmatched', matchType: null, patientName: 'Ethan Example', cptCode: '97140',
  chargedAmount: '100.00', allowedAmount: null, paidAmount: '0.00', adjustmentAmount: '100.00', patientResponsibility: '0.00',
  claimStatusCode: '4', autoPostedAt: null, postedAt: null, denialAppliedAt: null, denialError: null, denialAttempts: 0,
  adjustmentReasonCodes: [{ code: 'CO-197', description: 'Contractual Obligations: Precertification/authorization/notification absent' }],
  remarkCodes: [],
});
const PAID_LINE = () => ({
  ...DENIED_LINE(), id: 32, cptCode: '97530', chargedAmount: '250.00', allowedAmount: '200.00', paidAmount: '160.00', adjustmentAmount: '90.00',
  patientResponsibility: '40.00', claimStatusCode: '1',
  adjustmentReasonCodes: [{ code: 'CO-45', description: 'Contractual Obligations: Charge exceeds fee schedule/maximum allowable/contracted/legislated amount' }, { code: 'PR-2', description: 'Patient Responsibility: Coinsurance amount' }],
  remarkCodes: [{ code: 'N130', description: 'N130' }],
});
const CLAIM = () => ({
  id: 73, practiceId: 1, claimNumber: 'CLM-MWNVFA08-DIJSKH', status: 'submitted', totalAmount: '100.00',
  submittedAt: new Date('2026-11-18T15:00:00Z'), clearinghouseSubmittedAt: new Date('2026-11-18T15:00:00Z'), clearinghouseClaimId: 'STEDI-1',
});
const NEVER_SENT = { submittedAt: null, clearinghouseSubmittedAt: null, clearinghouseClaimId: null, clearinghouseStatus: null };

const APPLIED = { claimId: 73, denied: true, claimStatus: 'denied', denialReason: CARC_197, applied: true, pipeline: { ran: true, appealCreated: true, appealReused: false, appealId: 91, followUpCreated: true } };
const REUSED = { ...APPLIED, denied: false, pipeline: { ran: true, appealCreated: false, appealReused: true, appealId: 91, followUpCreated: false } };
const UNDER_APPEAL = { ...APPLIED, denied: false, claimStatus: 'appeal', pipeline: { ran: false, appealCreated: false, appealReused: true, followUpCreated: false } };
const PIPELINE_FAILED = { ...APPLIED, applied: false, pipeline: { ran: true, appealCreated: false, appealReused: false, followUpCreated: false, error: 'AI generator unavailable' } };
const MARKER_FAILED = { ...APPLIED, applied: false, persistenceError: 'Denial outcome could not be recorded on the remittance line (retry needed): db down', pipeline: { ...APPLIED.pipeline, error: 'Denial outcome could not be recorded on the remittance line (retry needed): db down' } };

const match = (lineId = 31) => request(makeApp()).post(`/api/remittance/500/line-items/${lineId}/match`).send({ claimId: 73 });
const retryDenial = (lineId = 31) => request(makeApp()).post(`/api/remittance/500/line-items/${lineId}/retry-denial`).send({});

beforeEach(() => {
  vi.clearAllMocks();
  // The posting identity, in miniature: the first posting for a line
  // "commits" a receipt the next findLinePosting sees; a second attempt for
  // the same line is refused with alreadyPosted (what the partial unique
  // index does in the real database).
  H.post.mockImplementation(async (_practiceId: number, data: any) => {
    if (H.state.receipt && H.state.receipt.remittanceLineItemId === data.remittanceLineItemId) {
      return { posting: H.state.receipt, alreadyPosted: true };
    }
    H.state.receipt = { id: 1, remittanceLineItemId: data.remittanceLineItemId, postedAt: new Date() };
    return { posting: H.state.receipt, alreadyPosted: false };
  });
  H.receipt.mockImplementation(async () => H.state.receipt);
  H.applyDenial.mockResolvedValue(APPLIED);
  H.state.remittance = { id: 500, practiceId: 1, payerName: 'Aetna QA Synthetic', checkNumber: 'QA-SYN-1', checkDate: '2026-11-18', receivedDate: '2026-11-19' };
  H.state.claim = CLAIM();
  H.state.lineItem = DENIED_LINE();
  H.state.receipt = null;
  H.state.events = [];
  H.state.allLines = [];
  H.state.lineUpdates = [];
  H.state.remitUpdates = [];
});

describe('manual match — which claims may receive a remittance', () => {
  it.each(['draft', 'held'])('refuses a %s claim with no recorded submission evidence, and says to verify, not to send', async (status) => {
    H.state.claim = { ...CLAIM(), ...NEVER_SENT, status };

    const res = await match();

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('claim_not_submitted');
    expect(res.body.message).toMatch(/TherapyBill has no record of it being sent to a payer/);
    expect(res.body.message).toMatch(/verify whether it was ever filed before taking any send action/);
    expect(res.body.message).not.toMatch(/never been sent|resubmit/i);
    expect(H.state.lineUpdates).toHaveLength(0);
    expect(H.post).not.toHaveBeenCalled();
    expect(H.applyDenial).not.toHaveBeenCalled();
  });

  it('accepts a held claim that was SENT but unconfirmed (clearinghouse attempt on record)', async () => {
    H.state.claim = { ...CLAIM(), ...NEVER_SENT, status: 'held', clearinghouseSubmittedAt: new Date('2026-11-18T15:00:00Z'), clearinghouseStatus: 'pending', holdReason: 'Clearinghouse submission failed: ...' };
    const res = await match();
    expect(res.status).toBe(200);
    expect(H.post).toHaveBeenCalledTimes(1);
  });

  it('accepts a held claim the clearinghouse rejected (it carries the attempt id)', async () => {
    H.state.claim = { ...CLAIM(), ...NEVER_SENT, status: 'held', clearinghouseClaimId: 'STEDI-REJ-1' };
    expect((await match()).status).toBe(200);
  });

  it('accepts a reopened draft whose history shows a submission', async () => {
    H.state.claim = { ...CLAIM(), ...NEVER_SENT, status: 'draft', resubmissionCount: 1 };
    H.state.events = [{ eventType: 'submitted' }];
    expect((await match()).status).toBe(200);
    expect(H.post).toHaveBeenCalledTimes(1);
  });

  it('a line matched to a different claim cannot be reassigned here — says so plainly, with or without money', async () => {
    H.state.lineItem = { ...DENIED_LINE(), claimId: 74, status: 'matched', matchType: 'manual' };
    H.state.receipt = null;
    let res = await match();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'line_already_matched', matchedClaimId: 74, paymentRecorded: false });
    expect(res.body.message).toMatch(/already matched to claim 74 and no payment is recorded for it/);
    expect(res.body.message).toMatch(/Reassigning a matched line to a different claim is not supported here/);
    expect(res.body.message).not.toMatch(/[Rr]everse/);

    H.state.receipt = { id: 9, remittanceLineItemId: 31 };
    res = await match();
    expect(res.body).toMatchObject({ paymentRecorded: true });
    expect(res.body.message).toMatch(/its payment is recorded on that claim/);
    expect(H.post).not.toHaveBeenCalled();
  });
});

describe('manual match — posting and the denial step', () => {
  it('a denied line: posts $0 with the line id and the CARC, matches AFTER the commit, then applies the denial, and says what the pipeline did', async () => {
    const res = await match();

    expect(res.status).toBe(200);
    expect(H.post).toHaveBeenCalledTimes(1);
    const [practiceId, posting] = H.post.mock.calls[0] as any[];
    expect(practiceId).toBe(1);
    expect(posting).toMatchObject({ remittanceLineItemId: 31, source: 'era', claimId: 73, paymentAmount: '0.00', adjustmentAmount: '100.00', adjustmentReason: CARC_197, remarkCode: null, postedBy: 'biller-1' });

    // The match + marker are written once, after the posting returned.
    expect(H.state.lineUpdates).toHaveLength(1);
    expect(H.state.lineUpdates[0]).toMatchObject({ claimId: 73, status: 'matched', matchType: 'manual' });
    expect(H.state.lineUpdates[0].postedAt).toBeInstanceOf(Date);

    expect(H.applyDenial).toHaveBeenCalledTimes(1);
    const [p2, line, opts] = H.applyDenial.mock.calls[0] as any[];
    expect(p2).toBe(1);
    expect(line).toMatchObject({ id: 31, claimId: 73 });
    expect(opts).toMatchObject({ remittanceId: 500, payerName: 'Aetna QA Synthetic', checkNumber: 'QA-SYN-1', postedBy: 'biller-1' });
    expect(H.post.mock.invocationCallOrder[0]).toBeLessThan(H.applyDenial.mock.invocationCallOrder[0]);

    expect(res.body).toMatchObject({
      claimId: 73, lineItemId: 31, posted: true, alreadyPosted: false, postingSkipped: null, partial: false, denied: true, claimStatus: 'denied', denialReason: CARC_197,
      denial: { applied: true, statusChanged: true, claimStatus: 'denied', pipelineRan: true, appealCreated: true, appealReused: false, appealId: 91, followUpCreated: true, error: null },
    });
    expect(res.body.message).toMatch(/Payment recorded\. The payer denied claim CLM-MWNVFA08-DIJSKH \(CO-197.*it is now Denied, an appeal was drafted \(#91\), and a denial follow-up was added/);
  });

  it('reports an existing appeal as kept, the real claim status, and a follow-up that was not created', async () => {
    H.applyDenial.mockResolvedValue(REUSED);
    const res = await match();
    expect(res.body.denial).toMatchObject({ appealCreated: false, appealReused: true, appealId: 91, followUpCreated: false, pipelineRan: true, claimStatus: 'denied' });
    expect(res.body.message).toMatch(/it was already Denied, the existing appeal #91 was kept, and no new follow-up was created \(one may already exist\)/);
    expect(res.body.message).not.toMatch(/appeal was drafted|follow-up already existed/);
  });

  it('a claim already under appeal: pipeline not run is said so', async () => {
    H.applyDenial.mockResolvedValue(UNDER_APPEAL);
    const res = await match();
    expect(res.body.message).toMatch(/it was already under appeal, the existing appeal was kept, and the follow-up step was not run/);
    expect(res.body.denial).toMatchObject({ pipelineRan: false, claimStatus: 'appeal' });
  });

  it('a failed pipeline is a partial success with a retry path, never a claim that an appeal was drafted', async () => {
    H.applyDenial.mockResolvedValue(PIPELINE_FAILED);

    const res = await match();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ posted: true, partial: true, denied: true, claimStatus: 'denied', denial: { applied: false, appealCreated: false, error: 'AI generator unavailable' } });
    expect(res.body.message).toMatch(/marked Denied .*but the appeal draft \/ follow-up step failed: AI generator unavailable/);
    expect(res.body.message).toMatch(/Retry denial button .*the payment will not be posted twice/);
    expect(res.body.message).not.toMatch(/appeal was drafted/);
  });

  it('a denial whose outcome could not be written on the line is reported as needing a retry', async () => {
    H.applyDenial.mockResolvedValue(MARKER_FAILED);
    const res = await match();
    expect(res.body).toMatchObject({ partial: true, denial: { applied: false, persistenceError: expect.stringMatching(/could not be recorded/) } });
    expect(res.body.message).toMatch(/could not be recorded on the remittance line/);
  });

  it('a processed line: posts the money with the CARC/RARC and does not touch the claim status', async () => {
    H.state.lineItem = PAID_LINE();

    const res = await match(32);

    expect(res.status).toBe(200);
    expect(H.post.mock.calls[0][1]).toMatchObject({
      remittanceLineItemId: 32, paymentAmount: '160.00', adjustmentAmount: '90.00', patientResponsibility: '40.00', allowedAmount: '200.00',
      adjustmentReason: 'CO-45: Contractual Obligations: Charge exceeds fee schedule/maximum allowable/contracted/legislated amount; PR-2: Patient Responsibility: Coinsurance amount',
      remarkCode: 'N130',
    });
    expect(H.applyDenial).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ denied: false, denialReason: null, denial: null, partial: false, message: 'Line item matched to claim successfully' });
  });

  it('a line with no status code is not a denial even at $0 paid', async () => {
    H.state.lineItem = { ...DENIED_LINE(), claimStatusCode: null };
    const res = await match();
    expect(res.status).toBe(200);
    expect(H.applyDenial).not.toHaveBeenCalled();
    expect(res.body.denied).toBe(false);
  });
});

describe('manual match — one posting identity (#497 second review)', () => {
  it('two simultaneous manual matches: exactly one posts; the other is told "already posted"', async () => {
    // Two requests for the same unmatched line at once. Whichever reaches
    // the posting first commits the receipt; the other either loses at the
    // unique identity (alreadyPosted from the poster) or, having read the
    // line after the first commit, finds the receipt and skips the posting.
    // Either way: one posting, two 200s, no partial state.
    const [a, b] = await Promise.all([match(), match()]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect([a.body.posted, b.body.posted].sort()).toEqual([false, true]);
    expect([a.body.alreadyPosted, b.body.alreadyPosted].sort()).toEqual([false, true]);
    const postedCount = (await Promise.all(H.post.mock.results.map((r) => r.value))).filter((o: any) => !o.alreadyPosted).length;
    expect(postedCount).toBe(1);
    expect(H.applyDenial).toHaveBeenCalledTimes(2); // the denial step is idempotent and may run from both
    expect([a.body.postingSkipped, b.body.postingSkipped]).toEqual([null, null]); // never the "historical" path
  });

  it('manual after auto (or a retry after a crash between the commit and the marker): the committed posting wins, nothing is posted, the denial step runs', async () => {
    // Auto-match committed a posting carrying this line's id but the process died before the marker.
    H.state.lineItem = { ...DENIED_LINE(), claimId: 73, status: 'matched', matchType: 'claim_number', postedAt: null, autoPostedAt: null };
    H.state.receipt = { id: 9, remittanceLineItemId: 31, postedAt: new Date('2026-11-18T16:00:00Z') };

    const res = await match();

    expect(res.status).toBe(200);
    expect(H.post).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ posted: false, alreadyPosted: true, partial: false });
    // The marker caught up with the committed posting.
    expect(H.state.lineUpdates[0].postedAt).toEqual(new Date('2026-11-18T16:00:00Z'));
    expect(H.applyDenial).toHaveBeenCalledTimes(1);
    expect(res.body.message).toMatch(/Payment was already recorded; not posted again/);
  });

  it.each([
    ['legacy auto-posted (autoPostedAt set, no receipt)', { status: 'matched', claimId: 73, matchType: 'claim_number', autoPostedAt: new Date('2026-10-01') }],
    ['legacy fused path (matchType null)', { status: 'matched', claimId: 73, matchType: null }],
    ['older manual match (no marker, no receipt)', { status: 'matched', claimId: 73, matchType: 'manual' }],
    ['marker without a posting (old code crashed after the marker)', { status: 'matched', claimId: 73, matchType: 'manual', postedAt: new Date('2026-10-01') }],
  ])('fails closed for a %s line: never posts it again from here', async (_label, over) => {
    H.state.lineItem = { ...PAID_LINE(), ...over };
    H.state.receipt = null;

    const res = await match(32);

    expect(res.status).toBe(200);
    expect(H.post).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ posted: false, alreadyPosted: false, postingSkipped: 'historical_no_receipt' });
    expect(res.body.message).toMatch(/matched before posting receipts were kept, so its payment was NOT posted again/);
  });

  it('a historical denied line still gets its denial step (no money involved)', async () => {
    H.state.lineItem = { ...DENIED_LINE(), status: 'matched', claimId: 73, matchType: 'manual' };
    const res = await match();
    expect(H.post).not.toHaveBeenCalled();
    expect(H.applyDenial).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({ postingSkipped: 'historical_no_receipt', denied: true });
  });

  it('a posting failure leaves the line untouched and answers 502 with "nothing has been posted"', async () => {
    H.post.mockRejectedValueOnce(new Error('db down'));

    const res = await match();

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: 'posting_failed', posted: false });
    expect(res.body.message).toMatch(/was NOT recorded \(db down\).*left unmatched.*Match it again to retry; nothing has been posted/);
    expect(H.state.lineUpdates).toHaveLength(0); // no match, no marker
    expect(H.state.lineItem.status).toBe('unmatched');
    expect(H.applyDenial).not.toHaveBeenCalled();
  });

  it('a retry after the posting succeeded but the denial step failed re-runs ONLY the denial step', async () => {
    H.applyDenial.mockResolvedValueOnce(PIPELINE_FAILED);
    const first = await match();
    expect(first.body.partial).toBe(true);
    expect(H.post).toHaveBeenCalledTimes(1);
    expect(H.state.receipt).toMatchObject({ remittanceLineItemId: 31 }); // the committed posting
    H.state.lineItem.denialError = 'AI generator unavailable';
    H.state.lineItem.denialAppliedAt = null;

    H.applyDenial.mockResolvedValueOnce(REUSED);
    const second = await match();

    expect(second.status).toBe(200);
    expect(H.post).toHaveBeenCalledTimes(1); // not posted twice
    expect(H.applyDenial).toHaveBeenCalledTimes(2);
    expect(second.body).toMatchObject({ posted: false, alreadyPosted: true, partial: false, claimStatus: 'denied' });
  });

  it('a retry of a fully completed match posts nothing and reports it as already matched', async () => {
    H.state.lineItem = { ...PAID_LINE(), claimId: 73, status: 'matched', matchType: 'manual', postedAt: new Date('2026-11-18') };
    H.state.receipt = { id: 1, remittanceLineItemId: 32, postedAt: new Date('2026-11-18') };
    const res = await match(32);
    expect(res.status).toBe(200);
    expect(H.post).not.toHaveBeenCalled();
    expect(H.state.lineUpdates).toHaveLength(0);
    expect(res.body).toMatchObject({ posted: false, alreadyPosted: true });
    expect(res.body.message).toMatch(/Line already matched to claim CLM-MWNVFA08-DIJSKH\. Payment was already recorded; not posted again/);
  });

  it('a remittance is not marked processed while a denial is pending', async () => {
    H.applyDenial.mockResolvedValue(PIPELINE_FAILED);
    H.state.allLines = [{ ...DENIED_LINE(), status: 'matched', claimId: 73, postedAt: new Date(), denialAppliedAt: null }];
    await match();
    expect(H.state.remitUpdates).toHaveLength(0);

    H.state.remitUpdates = [];
    H.applyDenial.mockResolvedValue(APPLIED);
    H.state.allLines = [{ ...DENIED_LINE(), status: 'matched', claimId: 73, postedAt: new Date(), denialAppliedAt: new Date() }];
    await match();
    expect(H.state.remitUpdates.at(-1)).toMatchObject({ status: 'processed' });
  });
});

describe('POST /api/remittance/:id/line-items/:lineItemId/retry-denial', () => {
  const pending = () => ({ ...DENIED_LINE(), status: 'matched', claimId: 73, matchType: 'manual', postedAt: new Date('2026-11-18'), denialAppliedAt: null, denialError: 'AI generator unavailable', denialAttempts: 5 });

  it('re-runs only the denial step for a posted pending line, past the automatic budget, and never posts', async () => {
    H.state.lineItem = pending();
    H.state.receipt = { id: 1, remittanceLineItemId: 31 };
    // The whole-remittance read after the step sees the line applied.
    H.state.allLines = [{ ...pending(), denialAppliedAt: new Date() }];

    const res = await retryDenial();

    expect(res.status).toBe(200);
    expect(H.post).not.toHaveBeenCalled();
    expect(H.applyDenial).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({ posted: false, alreadyPosted: true, partial: false, denied: true, claimStatus: 'denied', denial: { applied: true, appealCreated: true } });
    expect(res.body.message).toMatch(/Payment was already recorded; not posted again\. The payer denied claim CLM-MWNVFA08-DIJSKH/);
    expect(H.state.remitUpdates.at(-1)).toMatchObject({ status: 'processed' });
  });

  it('reports a still-failing step as partial, without marking the remittance processed', async () => {
    H.state.lineItem = pending();
    H.applyDenial.mockResolvedValue(PIPELINE_FAILED);
    const res = await retryDenial();
    expect(res.status).toBe(200);
    expect(res.body.partial).toBe(true);
    expect(H.state.remitUpdates).toHaveLength(0);
  });

  it('refuses a line whose payment is not recorded (money first, always)', async () => {
    H.state.lineItem = { ...DENIED_LINE(), status: 'matched', claimId: 73, matchType: 'claim_number', postedAt: null, autoPostedAt: null };
    H.state.receipt = null;
    const res = await retryDenial();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('line_not_posted');
    expect(H.applyDenial).not.toHaveBeenCalled();
  });

  it('refuses a non-denial and an unmatched line; a denial already applied is a no-op', async () => {
    H.state.lineItem = { ...PAID_LINE(), status: 'matched', claimId: 73, postedAt: new Date() };
    expect((await retryDenial(32)).body.code).toBe('not_a_denial');

    H.state.lineItem = DENIED_LINE();
    expect((await retryDenial()).body.code).toBe('line_not_matched');

    H.state.lineItem = { ...pending(), denialAppliedAt: new Date() };
    const res = await retryDenial();
    expect(res.status).toBe(200);
    expect(res.body.denial).toMatchObject({ applied: true, alreadyApplied: true });
    expect(H.applyDenial).not.toHaveBeenCalled();
  });
});

describe('POST /api/remittance/:id/auto-match reports denial retries even with nothing to match', () => {
  it('total 0 still returns denialsApplied / denialFailures / denialsExhausted', async () => {
    H.autoMatch.mockResolvedValue({
      matched: 0, posted: 0, total: 0, needsReview: 0, results: [], postingFailures: [],
      denialsApplied: 1, denialFailures: [{ claimId: 74, lineItemId: 33, error: 'AI generator unavailable' }], denialsExhausted: 1,
    });

    const res = await request(makeApp()).post('/api/remittance/500/auto-match').send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, denialsApplied: 1, denialFailures: [{ claimId: 74, lineItemId: 33, error: 'AI generator unavailable' }], denialsExhausted: 1 });
    expect(res.body.message).toMatch(/No unmatched line items to process\. 1 payer denial\(s\) could not be applied .*Retry denial button.* 1 payer denial\(s\) have used up automatic retries/);
  });
});
