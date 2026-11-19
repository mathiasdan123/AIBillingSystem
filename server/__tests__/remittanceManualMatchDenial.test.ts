/**
 * Manual ERA match route (demo billing test 2026-11-19, item 5; #497 reviews):
 *  - a line cannot be matched to a claim with no recorded submission
 *    evidence; held / reopened claims with evidence can receive the ERA;
 *    the refusal never says "resubmit";
 *  - money posting is exactly as before (match written, then postPayment
 *    with the same data plus CARC/RARC text);
 *  - proof of payment is the successful postPayment result IN THIS REQUEST:
 *    right after it the route writes the posting-confirmed marker
 *    (autoPostedAt) and, for a denied line, the "denial pending" marker
 *    (denialError), then runs the denial step on that marker. Nothing is
 *    inferred from matchType, amounts, dates, check numbers or other ERAs;
 *  - the retry-denial route acts ONLY on lines carrying the marker;
 *  - a remittance is 'processed' only when every line is matched with a
 *    confirmed posting and no denial is pending or needs review.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  state: {
    remittance: null as any, lineItem: null as any, claim: null as any, events: [] as any[],
    allLines: [] as any[], lineUpdates: [] as any[], remitUpdates: [] as any[], failLineUpdateMatching: null as null | ((values: any) => boolean),
  },
  postPayment: vi.fn(),
  applyDenial: vi.fn(),
  autoMatch: vi.fn(),
}));

vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/paymentPostingService', () => ({ postPayment: H.postPayment }));
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
      // The by-id line select carries two numeric params; the whole-remittance read carries one.
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
      limit: () => b,
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
            if (H.state.failLineUpdateMatching && H.state.failLineUpdateMatching(values)) {
              return Promise.reject(new Error('db down'));
            }
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
import { DENIAL_PENDING_MARKER, NEEDS_REVIEW_TEXT } from '../services/eraDenialService';

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
  claimStatusCode: '4', autoPostedAt: null, denialAppliedAt: null, denialError: null,
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
const UNDER_APPEAL = { ...APPLIED, denied: false, claimStatus: 'appeal', pipeline: { ran: false, appealCreated: false, appealReused: false, followUpCreated: false } };
const PIPELINE_FAILED = { ...APPLIED, applied: false, pipeline: { ran: true, appealCreated: false, appealReused: false, followUpCreated: false, error: 'AI generator unavailable' } };
const MARKER_FAILED = { ...APPLIED, applied: false, persistenceError: 'Denial outcome could not be recorded on the remittance line (retry needed): db down', pipeline: { ...APPLIED.pipeline, error: 'Denial outcome could not be recorded on the remittance line (retry needed): db down' } };

const match = (lineId = 31) => request(makeApp()).post(`/api/remittance/500/line-items/${lineId}/match`).send({ claimId: 73 });
const retryDenial = (lineId = 31) => request(makeApp()).post(`/api/remittance/500/line-items/${lineId}/retry-denial`).send({});

/** What the real applyRemittanceDenialToLine leaves on the line: the marker cleared when applied, the error otherwise. */
const denialStep = (result: any) => async () => {
  if (result.applied) {
    H.state.lineItem.denialAppliedAt = new Date();
    H.state.lineItem.denialError = null;
  } else {
    H.state.lineItem.denialError = result.pipeline.error ?? result.skippedReason ?? 'denial not applied';
  }
  return result;
};

beforeEach(() => {
  vi.clearAllMocks();
  H.postPayment.mockResolvedValue({ id: 1 });
  H.applyDenial.mockImplementation(denialStep(APPLIED));
  H.state.remittance = { id: 500, practiceId: 1, payerName: 'Aetna QA Synthetic', checkNumber: 'QA-SYN-1', checkDate: '2026-11-18', receivedDate: '2026-11-19' };
  H.state.claim = CLAIM();
  H.state.lineItem = DENIED_LINE();
  H.state.events = [];
  H.state.allLines = [];
  H.state.lineUpdates = [];
  H.state.remitUpdates = [];
  H.state.failLineUpdateMatching = null;
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
    expect(H.postPayment).not.toHaveBeenCalled();
    expect(H.applyDenial).not.toHaveBeenCalled();
  });

  it('accepts a held claim that was SENT but unconfirmed (clearinghouse attempt on record)', async () => {
    H.state.claim = { ...CLAIM(), ...NEVER_SENT, status: 'held', clearinghouseSubmittedAt: new Date('2026-11-18T15:00:00Z'), clearinghouseStatus: 'pending', holdReason: 'Clearinghouse submission failed: ...' };
    const res = await match();
    expect(res.status).toBe(200);
    expect(H.postPayment).toHaveBeenCalledTimes(1);
  });

  it('accepts a held claim the clearinghouse rejected (it carries the attempt id)', async () => {
    H.state.claim = { ...CLAIM(), ...NEVER_SENT, status: 'held', clearinghouseClaimId: 'STEDI-REJ-1' };
    expect((await match()).status).toBe(200);
  });

  it('accepts a reopened draft whose history shows a submission', async () => {
    H.state.claim = { ...CLAIM(), ...NEVER_SENT, status: 'draft', resubmissionCount: 1 };
    H.state.events = [{ eventType: 'submitted' }];
    expect((await match()).status).toBe(200);
    expect(H.postPayment).toHaveBeenCalledTimes(1);
  });

  it('a line matched to a different claim cannot be reassigned here — says so plainly', async () => {
    H.state.lineItem = { ...DENIED_LINE(), claimId: 74, status: 'matched', matchType: 'manual', autoPostedAt: null };
    let res = await match();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'line_already_matched', matchedClaimId: 74, postingConfirmed: false });
    expect(res.body.message).toMatch(/already matched to claim 74 and its posting could not be confirmed \(reconcile existing payments/);
    expect(res.body.message).toMatch(/Reassigning a matched line to a different claim is not supported here/);
    expect(res.body.message).not.toMatch(/[Rr]everse/);

    H.state.lineItem = { ...DENIED_LINE(), claimId: 74, status: 'matched', matchType: 'manual', autoPostedAt: new Date() };
    res = await match();
    expect(res.body).toMatchObject({ postingConfirmed: true });
    expect(res.body.message).toMatch(/its posting is confirmed on that claim/);
    expect(H.postPayment).not.toHaveBeenCalled();
  });
});

describe('manual match — posting, the in-flow markers and the denial step', () => {
  it('posting succeeds: match → postPayment → markers → denial, and the response says what the pipeline did', async () => {
    const res = await match();

    expect(res.status).toBe(200);
    // Match written first, then the posting — unchanged from main.
    expect(H.state.lineUpdates[0]).toMatchObject({ claimId: 73, status: 'matched', matchType: 'manual' });
    expect(H.postPayment).toHaveBeenCalledTimes(1);
    const [practiceId, posting] = H.postPayment.mock.calls[0] as any[];
    expect(practiceId).toBe(1);
    expect(posting).toEqual({
      source: 'era', claimId: 73, payerName: 'Aetna QA Synthetic', checkNumber: 'QA-SYN-1', paymentDate: '2026-11-18',
      paymentAmount: '0.00', adjustmentAmount: '100.00', patientResponsibility: '0.00', allowedAmount: null,
      adjustmentReason: CARC_197, remarkCode: null, postedBy: 'biller-1',
    });
    // Right after postPayment returned: posting confirmed + denial pending, in one write.
    expect(H.state.lineUpdates[1]).toMatchObject({ denialError: DENIAL_PENDING_MARKER, denialAppliedAt: null });
    expect(H.state.lineUpdates[1].autoPostedAt).toBeInstanceOf(Date);

    expect(H.applyDenial).toHaveBeenCalledTimes(1);
    const [p2, line, opts] = H.applyDenial.mock.calls[0] as any[];
    expect(p2).toBe(1);
    expect(line).toMatchObject({ id: 31, claimId: 73, denialError: DENIAL_PENDING_MARKER });
    expect(opts).toMatchObject({ remittanceId: 500, payerName: 'Aetna QA Synthetic', checkNumber: 'QA-SYN-1', postedBy: 'biller-1' });
    expect(H.postPayment.mock.invocationCallOrder[0]).toBeLessThan(H.applyDenial.mock.invocationCallOrder[0]);

    expect(res.body).toMatchObject({
      claimId: 73, lineItemId: 31, postingConfirmed: true, needsReview: false, partial: false, denied: true, claimStatus: 'denied', denialReason: CARC_197,
      denial: { applied: true, statusChanged: true, claimStatus: 'denied', pipelineRan: true, appealCreated: true, appealReused: false, appealId: 91, followUpCreated: true, error: null },
    });
    expect(res.body.message).toMatch(/Line matched to claim CLM-MWNVFA08-DIJSKH\. Payment recorded\. The payer denied claim CLM-MWNVFA08-DIJSKH \(CO-197.*it is now Denied, an appeal was drafted \(#91\), and a denial follow-up was added/);
    expect(H.state.remitUpdates.at(-1)).toMatchObject({ status: 'processed' });
  });

  it('posting fails: the request fails, no marker is written, no denial, nothing processed', async () => {
    H.postPayment.mockRejectedValueOnce(new Error('db down'));

    const res = await match();

    expect(res.status).toBe(500);
    expect(H.state.lineUpdates).toHaveLength(1); // the match only (unchanged from main)
    expect(H.state.lineItem.autoPostedAt).toBeNull();
    expect(H.state.lineItem.denialError).toBeNull();
    expect(H.applyDenial).not.toHaveBeenCalled();
    expect(H.state.remitUpdates).toHaveLength(0);
  });

  it('crash between posting and marker: payment recorded, marker not written → needs manual review, denial NOT applied, not processed', async () => {
    H.state.failLineUpdateMatching = (values) => values.autoPostedAt != null;

    const res = await match();

    expect(res.status).toBe(200);
    expect(H.postPayment).toHaveBeenCalledTimes(1);
    expect(H.applyDenial).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ postingConfirmed: false, needsReview: true, partial: true, denied: false, denial: { applied: false, needsReview: true } });
    expect(res.body.message).toMatch(/payment was recorded, but the line's posting-confirmed marker could not be written/);
    expect(res.body.message).toContain(NEEDS_REVIEW_TEXT);
    expect(res.body.message).toMatch(/denial was NOT applied/);
    expect(H.state.remitUpdates).toHaveLength(0);
    // And afterwards the line carries no marker: retry refuses, Auto-Match reports it.
    expect(H.state.lineItem.autoPostedAt).toBeNull();
    const retry = await retryDenial();
    expect(retry.status).toBe(409);
    expect(retry.body.code).toBe('line_not_confirmed');
  });

  it('posting succeeds then the denial step fails: marker keeps the error, response is partial, Retry works later', async () => {
    H.applyDenial.mockImplementation(denialStep(PIPELINE_FAILED));

    const res = await match();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ postingConfirmed: true, partial: true, denied: true, claimStatus: 'denied', denial: { applied: false, appealCreated: false, error: 'AI generator unavailable' } });
    expect(res.body.message).toMatch(/marked Denied .*but the appeal draft \/ follow-up step failed: AI generator unavailable/);
    expect(res.body.message).toMatch(/Retry denial button .*never posts the payment again/);
    expect(H.state.lineItem.denialError).toBe('AI generator unavailable');
    expect(H.state.remitUpdates).toHaveLength(0);

    // The line carries the marker (error text in its place): Retry re-runs ONLY the denial step.
    H.applyDenial.mockImplementation(denialStep(REUSED));
    const retry = await retryDenial();
    expect(retry.status).toBe(200);
    expect(H.postPayment).toHaveBeenCalledTimes(1); // not posted again
    expect(H.applyDenial).toHaveBeenCalledTimes(2);
    expect(retry.body.partial).toBe(false);
  });

  it('reports an existing appeal as kept, the real claim status, and a follow-up that was not created', async () => {
    H.applyDenial.mockImplementation(denialStep(REUSED));
    const res = await match();
    expect(res.body.denial).toMatchObject({ appealCreated: false, appealReused: true, appealId: 91, followUpCreated: false, pipelineRan: true, claimStatus: 'denied' });
    expect(res.body.message).toMatch(/it was already Denied, the existing appeal #91 was kept, and no new follow-up was created \(one may already exist\)/);
  });

  it('a claim already under appeal: says so and that the pipeline did not run — never that an appeal was kept', async () => {
    H.applyDenial.mockImplementation(denialStep(UNDER_APPEAL));
    const res = await match();
    expect(res.body.message).toMatch(/the claim is already under appeal, so the appeal draft and follow-up steps did not run/);
    expect(res.body.message).not.toMatch(/appeal was kept|appeal was drafted/);
    expect(res.body.denial).toMatchObject({ pipelineRan: false, claimStatus: 'appeal', appealReused: false, appealCreated: false });
  });

  it('a denial whose outcome could not be written on the line is reported as needing a retry', async () => {
    H.applyDenial.mockImplementation(denialStep(MARKER_FAILED));
    const res = await match();
    expect(res.body).toMatchObject({ partial: true, denial: { applied: false, persistenceError: expect.stringMatching(/could not be recorded/) } });
  });

  it('a processed line: posts the money with the CARC/RARC, confirms the posting, no denial marker, no claim status change', async () => {
    H.state.lineItem = PAID_LINE();

    const res = await match(32);

    expect(res.status).toBe(200);
    expect(H.postPayment.mock.calls[0][1]).toMatchObject({
      paymentAmount: '160.00', adjustmentAmount: '90.00', patientResponsibility: '40.00', allowedAmount: '200.00',
      adjustmentReason: 'CO-45: Contractual Obligations: Charge exceeds fee schedule/maximum allowable/contracted/legislated amount; PR-2: Patient Responsibility: Coinsurance amount',
      remarkCode: 'N130',
    });
    expect(H.state.lineUpdates[1]).toEqual({ autoPostedAt: expect.any(Date) });
    expect(H.applyDenial).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ postingConfirmed: true, denied: false, denialReason: null, denial: null, partial: false, message: 'Line item matched to claim successfully' });
    expect(H.state.remitUpdates.at(-1)).toMatchObject({ status: 'processed' });
  });

  it('a remittance is not marked processed while another matched line has no confirmed posting', async () => {
    H.state.allLines = [
      H.state.lineItem,
      { ...PAID_LINE(), id: 33, status: 'matched', claimId: 74, matchType: 'claim_number', autoPostedAt: null },
    ];
    const res = await match();
    expect(res.body.postingConfirmed).toBe(true);
    expect(H.state.remitUpdates).toHaveLength(0);
  });
});

describe('POST /api/remittance/:id/line-items/:lineItemId/retry-denial — acts only on the in-flow marker', () => {
  const pending = (over: any = {}) => ({ ...DENIED_LINE(), status: 'matched', claimId: 73, matchType: 'manual', autoPostedAt: new Date('2026-11-19T15:00:00Z'), denialAppliedAt: null, denialError: 'AI generator unavailable', ...over });

  it('re-runs only the denial step for a marked line and never posts', async () => {
    H.state.lineItem = pending();
    H.state.allLines = [{ ...pending(), denialAppliedAt: new Date(), denialError: null }];

    const res = await retryDenial();

    expect(res.status).toBe(200);
    expect(H.postPayment).not.toHaveBeenCalled();
    expect(H.applyDenial).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({ partial: false, denied: true, claimStatus: 'denied', denial: { applied: true, appealCreated: true } });
    expect(res.body.message).toMatch(/its payment was already recorded and is not posted again\. The payer denied claim CLM-MWNVFA08-DIJSKH/);
    expect(H.state.remitUpdates.at(-1)).toMatchObject({ status: 'processed' });
  });

  it('reports a still-failing step as partial, without marking the remittance processed', async () => {
    H.state.lineItem = pending();
    H.applyDenial.mockImplementation(denialStep(PIPELINE_FAILED));
    const res = await retryDenial();
    expect(res.status).toBe(200);
    expect(res.body.partial).toBe(true);
    expect(H.state.remitUpdates).toHaveLength(0);
  });

  it('FAILED manual posting: matched manual, no marker — refused, even though another remittance posted the same claim and amounts', async () => {
    // Remittance A posted $0 / CO-197 on claim 73 earlier; remittance B's line
    // 31 is the same fingerprint but ITS postPayment threw. No marker, no
    // cross-proof: nothing is inferred from amounts, dates or check numbers.
    H.state.lineItem = pending({ autoPostedAt: null, denialError: null });

    const res = await retryDenial();

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'line_not_confirmed', needsReview: true });
    expect(res.body.message).toContain(NEEDS_REVIEW_TEXT);
    expect(H.applyDenial).not.toHaveBeenCalled();
    expect(H.postPayment).not.toHaveBeenCalled();
  });

  it('a denied line posted before the denial step existed (confirmed posting, no marker) is refused: review, not retry', async () => {
    H.state.lineItem = pending({ denialError: null });
    const res = await retryDenial();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('line_not_confirmed');
    expect(H.applyDenial).not.toHaveBeenCalled();
  });

  it('refuses a non-denial and an unmatched line; a denial already applied is a no-op', async () => {
    H.state.lineItem = { ...PAID_LINE(), status: 'matched', claimId: 73, matchType: 'manual', autoPostedAt: new Date() };
    expect((await retryDenial(32)).body.code).toBe('not_a_denial');

    H.state.lineItem = DENIED_LINE();
    expect((await retryDenial()).body.code).toBe('line_not_matched');

    H.state.lineItem = pending({ denialAppliedAt: new Date(), denialError: null });
    const res = await retryDenial();
    expect(res.status).toBe(200);
    expect(res.body.denial).toMatchObject({ applied: true, alreadyApplied: true });
    expect(H.applyDenial).not.toHaveBeenCalled();
  });
});

describe('GET /api/remittance/:id flags each matched line from the markers only', () => {
  it('confirmed + pending, needs review (no confirmed posting), and legacy denied (confirmed, no marker)', async () => {
    H.state.remittance = {
      ...H.state.remittance,
      lineItems: [
        { ...DENIED_LINE(), id: 1, status: 'matched', claimId: 73, matchType: 'manual', autoPostedAt: new Date(), denialError: DENIAL_PENDING_MARKER },
        { ...DENIED_LINE(), id: 2, status: 'matched', claimId: 73, matchType: 'manual', autoPostedAt: null },
        { ...DENIED_LINE(), id: 3, status: 'matched', claimId: 73, matchType: 'claim_number', autoPostedAt: new Date('2026-10-01'), denialError: null },
        { ...PAID_LINE(), id: 4, status: 'matched', claimId: 74, matchType: null, autoPostedAt: null },
        { ...PAID_LINE(), id: 5 },
      ],
    };
    const res = await request(makeApp()).get('/api/remittance/500');
    expect(res.status).toBe(200);
    const flags = res.body.lineItems.map((l: any) => [l.id, l.postingConfirmed, l.needsReview, l.denialPending]);
    expect(flags).toEqual([
      [1, true, false, true],
      [2, false, true, false],
      [3, true, true, false],
      [4, false, true, false], // legacy fused-path row: cannot be vouched for
      [5, null, false, false], // unmatched
    ]);
  });
});

describe('POST /api/remittance/:id/auto-match reports denial retries even with nothing to match', () => {
  it('total 0 still returns denialsApplied / denialFailures / linesNeedingReview', async () => {
    H.autoMatch.mockResolvedValue({
      matched: 0, posted: 0, total: 0, needsReview: 0, results: [], postingFailures: [],
      denialsApplied: 1, denialFailures: [{ claimId: 74, lineItemId: 33, error: 'AI generator unavailable' }],
      linesNeedingReview: [{ claimId: 75, lineItemId: 34 }],
    });

    const res = await request(makeApp()).post('/api/remittance/500/auto-match').send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, denialsApplied: 1, denialFailures: [{ claimId: 74, lineItemId: 33, error: 'AI generator unavailable' }], linesNeedingReview: [{ lineItemId: 34 }] });
    expect(res.body.message).toMatch(/No unmatched line items to process\. 1 payer denial\(s\) could not be applied .*Retry denial button.* 1 matched line\(s\) need manual review: their posting could not be confirmed by this flow/);
  });
});
