/**
 * Manual ERA match route (demo billing test 2026-11-19, item 5; #497):
 *  - a line cannot be matched to a claim that has no recorded submission
 *    evidence (draft/held with no submission date, clearinghouse attempt or
 *    'submitted' event); a held claim the clearinghouse rejected, or
 *    sent-but-unconfirmed, or a reopened draft, CAN be — the ERA settles
 *    them — and the refusal never says "resubmit";
 *  - the posting carries the CARC / RARC; money posting is otherwise exactly
 *    as before (postPayment, same data);
 *  - a denied line (CLP02 4) applies the denial after posting; the response
 *    reports the real pipeline state and a partial-success retry path;
 *  - a remittance is not 'processed' while a line has no posting or a
 *    posted denial is still pending;
 *  - the retry-denial route re-runs ONLY the denial step, never posts, and
 *    refuses a line whose payment is not recorded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  state: {
    remittance: null as any, lineItem: null as any, claim: null as any, events: [] as any[], postings: [] as any[],
    allLines: [] as any[], lineUpdates: [] as any[], remitUpdates: [] as any[],
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
    if (table === schema.paymentPostings) return s.postings;
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

/** What the real applyRemittanceDenialToLine leaves on the line: the marker when applied, the error otherwise. */
const denialStep = (result: any) => async () => {
  if (result.applied) {
    H.state.lineItem.denialAppliedAt = new Date();
    H.state.lineItem.denialError = null;
  } else {
    H.state.lineItem.denialError = result.pipeline.error ?? result.skippedReason ?? 'denial not applied';
  }
  return result;
};

/** A posting row as postPayment leaves it, for the evidence check. */
const postingFor = (over: any = {}) => ({
  id: 1, claimId: 73, source: 'era', reversed: false, checkNumber: 'QA-SYN-1', paymentDate: '2026-11-18',
  paymentAmount: '0.00', patientResponsibility: '0.00', postedAt: new Date(), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // postPayment writes the posting the evidence check reads.
  H.postPayment.mockImplementation(async (_practiceId: number, data: any) => {
    const row = postingFor({ id: H.state.postings.length + 1, claimId: data.claimId, paymentAmount: data.paymentAmount, patientResponsibility: data.patientResponsibility, checkNumber: data.checkNumber, paymentDate: data.paymentDate });
    H.state.postings.push(row);
    return row;
  });
  H.applyDenial.mockImplementation(denialStep(APPLIED));
  H.state.remittance = { id: 500, practiceId: 1, payerName: 'Aetna QA Synthetic', checkNumber: 'QA-SYN-1', checkDate: '2026-11-18', receivedDate: '2026-11-19' };
  H.state.claim = CLAIM();
  H.state.lineItem = DENIED_LINE();
  H.state.events = [];
  H.state.postings = [];
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
    H.state.lineItem = { ...DENIED_LINE(), claimId: 74, status: 'matched', matchType: 'manual', matchedAt: new Date('2026-11-18') };
    let res = await match();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'line_already_matched', matchedClaimId: 74, paymentEvidence: 'not_recorded' });
    expect(res.body.message).toMatch(/already matched to claim 74 and payment not recorded — needs manual review/);
    expect(res.body.message).toMatch(/Reassigning a matched line to a different claim is not supported here/);
    expect(res.body.message).not.toMatch(/[Rr]everse/);

    H.state.postings = [postingFor({ claimId: 74 })];
    res = await match();
    expect(res.body).toMatchObject({ paymentEvidence: 'recorded' });
    expect(res.body.message).toMatch(/its payment is recorded on that claim/);
    expect(H.postPayment).not.toHaveBeenCalled();
  });
});

describe('manual match — posting and the denial step', () => {
  it('a denied line: posts $0 with the CARC exactly as before, then applies the denial, and says what the pipeline did', async () => {
    const res = await match();

    expect(res.status).toBe(200);
    // Match written first, then the posting — unchanged from main.
    expect(H.state.lineUpdates).toHaveLength(1);
    expect(H.state.lineUpdates[0]).toMatchObject({ claimId: 73, status: 'matched', matchType: 'manual' });
    expect(H.postPayment).toHaveBeenCalledTimes(1);
    const [practiceId, posting] = H.postPayment.mock.calls[0] as any[];
    expect(practiceId).toBe(1);
    expect(posting).toEqual({
      source: 'era', claimId: 73, payerName: 'Aetna QA Synthetic', checkNumber: 'QA-SYN-1', paymentDate: '2026-11-18',
      paymentAmount: '0.00', adjustmentAmount: '100.00', patientResponsibility: '0.00', allowedAmount: null,
      adjustmentReason: CARC_197, remarkCode: null, postedBy: 'biller-1',
    });

    expect(H.applyDenial).toHaveBeenCalledTimes(1);
    const [p2, line, opts] = H.applyDenial.mock.calls[0] as any[];
    expect(p2).toBe(1);
    expect(line).toMatchObject({ id: 31, claimId: 73, matchType: 'manual' });
    expect(opts).toMatchObject({ remittanceId: 500, payerName: 'Aetna QA Synthetic', checkNumber: 'QA-SYN-1', postedBy: 'biller-1' });
    expect(H.postPayment.mock.invocationCallOrder[0]).toBeLessThan(H.applyDenial.mock.invocationCallOrder[0]);

    expect(res.body).toMatchObject({
      claimId: 73, lineItemId: 31, partial: false, paymentEvidence: 'recorded', denied: true, claimStatus: 'denied', denialReason: CARC_197,
      denial: { applied: true, statusChanged: true, claimStatus: 'denied', pipelineRan: true, appealCreated: true, appealReused: false, appealId: 91, followUpCreated: true, error: null },
    });
    expect(res.body.message).toMatch(/Line matched to claim CLM-MWNVFA08-DIJSKH\. Payment recorded\. The payer denied claim CLM-MWNVFA08-DIJSKH \(CO-197.*it is now Denied, an appeal was drafted \(#91\), and a denial follow-up was added/);
    expect(H.state.remitUpdates.at(-1)).toMatchObject({ status: 'processed' });
  });

  it('reports an existing appeal as kept, the real claim status, and a follow-up that was not created', async () => {
    H.applyDenial.mockImplementation(denialStep(REUSED));
    const res = await match();
    expect(res.body.denial).toMatchObject({ appealCreated: false, appealReused: true, appealId: 91, followUpCreated: false, pipelineRan: true, claimStatus: 'denied' });
    expect(res.body.message).toMatch(/it was already Denied, the existing appeal #91 was kept, and no new follow-up was created \(one may already exist\)/);
    expect(res.body.message).not.toMatch(/appeal was drafted|follow-up already existed/);
  });

  it('a claim already under appeal: says so and that the pipeline did not run — never that an appeal was kept', async () => {
    H.applyDenial.mockImplementation(denialStep(UNDER_APPEAL));
    const res = await match();
    expect(res.body.message).toMatch(/the claim is already under appeal, so the appeal draft and follow-up steps did not run/);
    expect(res.body.message).not.toMatch(/appeal was kept|appeal was drafted/);
    expect(res.body.denial).toMatchObject({ pipelineRan: false, claimStatus: 'appeal', appealReused: false, appealCreated: false });
  });

  it('a failed pipeline is a partial success pointing at Retry denial, never a claim that an appeal was drafted', async () => {
    H.applyDenial.mockImplementation(denialStep(PIPELINE_FAILED));

    const res = await match();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ partial: true, denied: true, claimStatus: 'denied', denial: { applied: false, appealCreated: false, error: 'AI generator unavailable' } });
    expect(res.body.message).toMatch(/marked Denied .*but the appeal draft \/ follow-up step failed: AI generator unavailable/);
    expect(res.body.message).toMatch(/Retry denial button .*never posts the payment again/);
    expect(res.body.message).not.toMatch(/appeal was drafted/);
    // The remittance stays pending while the denial is.
    expect(H.state.remitUpdates).toHaveLength(0);
  });

  it('a denial whose outcome could not be written on the line is reported as needing a retry', async () => {
    H.applyDenial.mockImplementation(denialStep(MARKER_FAILED));
    const res = await match();
    expect(res.body).toMatchObject({ partial: true, denial: { applied: false, persistenceError: expect.stringMatching(/could not be recorded/) } });
    expect(res.body.message).toMatch(/could not be recorded on the remittance line/);
  });

  it('a processed line: posts the money with the CARC/RARC and does not touch the claim status', async () => {
    H.state.lineItem = PAID_LINE();

    const res = await match(32);

    expect(res.status).toBe(200);
    expect(H.postPayment.mock.calls[0][1]).toMatchObject({
      paymentAmount: '160.00', adjustmentAmount: '90.00', patientResponsibility: '40.00', allowedAmount: '200.00',
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

  it('a remittance is not marked processed while another line has no posting (auto-matched, not yet posted)', async () => {
    H.state.allLines = [
      H.state.lineItem,
      { ...PAID_LINE(), id: 33, status: 'matched', claimId: 74, matchType: 'claim_number', autoPostedAt: null, matchedAt: new Date() },
    ];
    const res = await match();
    expect(res.body.paymentEvidence).toBe('recorded');
    expect(H.state.remitUpdates).toHaveLength(0);
  });

  it('postPayment returned but no posting is on the claim: the denial is NOT applied, the response says needs manual review, Retry stays possible', async () => {
    H.postPayment.mockResolvedValueOnce({ id: 99 }); // nothing written (the mock models a posting that cannot be found)
    const res = await match();
    expect(res.status).toBe(200);
    expect(H.applyDenial).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ partial: true, paymentEvidence: 'not_recorded', denied: false, denial: { applied: false, awaitingPayment: true, paymentEvidence: 'not_recorded' } });
    expect(res.body.message).toMatch(/payment not recorded — needs manual review.*denial was NOT applied/);
    expect(H.state.remitUpdates).toHaveLength(0);
  });
});

describe('POST /api/remittance/:id/line-items/:lineItemId/retry-denial', () => {
  const pending = () => ({ ...DENIED_LINE(), status: 'matched', claimId: 73, matchType: 'manual', matchedAt: new Date('2026-11-19T15:00:00Z'), denialAppliedAt: null, denialError: 'AI generator unavailable' });
  const receipt = () => postingFor({ postedAt: new Date('2026-11-19T15:00:05Z') });

  it('re-runs only the denial step for a line whose own payment is on record, and never posts', async () => {
    H.state.lineItem = pending();
    H.state.postings = [receipt()];
    // The whole-remittance read after the step sees the line applied.
    H.state.allLines = [{ ...pending(), denialAppliedAt: new Date() }];

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
    H.state.postings = [receipt()];
    H.applyDenial.mockImplementation(denialStep(PIPELINE_FAILED));
    const res = await retryDenial();
    expect(res.status).toBe(200);
    expect(res.body.partial).toBe(true);
    expect(H.state.remitUpdates).toHaveLength(0);
  });

  it('FAILED manual posting + another receipt on the same claim: the unrelated receipt is not this line\'s; refused, denial not applied', async () => {
    H.state.lineItem = pending(); // matched manually, its own postPayment threw
    // An earlier ERA posting on the same claim: different amounts, posted before this match.
    H.state.postings = [postingFor({ id: 7, paymentAmount: '160.00', patientResponsibility: '40.00', postedAt: new Date('2026-11-01') })];

    const res = await retryDenial();

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'line_not_posted', paymentEvidence: 'not_recorded' });
    expect(res.body.message).toMatch(/payment not recorded — needs manual review/);
    expect(H.applyDenial).not.toHaveBeenCalled();
    expect(H.postPayment).not.toHaveBeenCalled();
  });

  it('FAILED manual posting + an older $0 ERA on the claim (same amounts, before the match): still refused', async () => {
    H.state.lineItem = pending();
    H.state.postings = [postingFor({ id: 7, postedAt: new Date('2026-11-01') })]; // same fingerprint, but from before this line was matched
    const res = await retryDenial();
    expect(res.status).toBe(409);
    expect(res.body.paymentEvidence).toBe('not_recorded');
    expect(H.applyDenial).not.toHaveBeenCalled();
  });

  it('reversal: a reversed posting is not evidence (the query excludes it); refused', async () => {
    H.state.lineItem = pending();
    H.state.postings = []; // what the non-reversed query returns once the posting is reversed
    const res = await retryDenial();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('line_not_posted');
    expect(H.applyDenial).not.toHaveBeenCalled();
  });

  it('ambiguous legacy evidence: two identical lines on the claim, one posting — refused with the reason', async () => {
    H.state.lineItem = { ...pending(), matchType: null, matchedAt: null };
    H.state.allLines = [H.state.lineItem, { ...pending(), id: 32, matchType: null, matchedAt: null }];
    H.state.postings = [receipt()];
    const res = await retryDenial();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'line_not_posted', paymentEvidence: 'ambiguous' });
    expect(res.body.message).toMatch(/ambiguous .*Payments tab/);
    expect(H.applyDenial).not.toHaveBeenCalled();
  });

  it('refuses a non-denial and an unmatched line; a denial already applied is a no-op', async () => {
    H.state.lineItem = { ...PAID_LINE(), status: 'matched', claimId: 73, matchType: 'manual' };
    expect((await retryDenial(32)).body.code).toBe('not_a_denial');

    H.state.lineItem = DENIED_LINE();
    expect((await retryDenial()).body.code).toBe('line_not_matched');

    H.state.lineItem = { ...pending(), denialAppliedAt: new Date() };
    H.state.postings = [receipt()];
    const res = await retryDenial();
    expect(res.status).toBe(200);
    expect(res.body.denial).toMatchObject({ applied: true, alreadyApplied: true });
    expect(H.applyDenial).not.toHaveBeenCalled();
  });
});

describe('POST /api/remittance/:id/auto-match reports denial retries even with nothing to match', () => {
  it('total 0 still returns denialsApplied / denialFailures', async () => {
    H.autoMatch.mockResolvedValue({
      matched: 0, posted: 0, total: 0, needsReview: 0, results: [], postingFailures: [],
      denialsApplied: 1, denialFailures: [{ claimId: 74, lineItemId: 33, error: 'AI generator unavailable' }],
      denialsAwaitingPayment: [{ claimId: 75, lineItemId: 34, evidence: 'not_recorded' }],
    });

    const res = await request(makeApp()).post('/api/remittance/500/auto-match').send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, denialsApplied: 1, denialFailures: [{ claimId: 74, lineItemId: 33, error: 'AI generator unavailable' }], denialsAwaitingPayment: [{ lineItemId: 34 }] });
    expect(res.body.message).toMatch(/No unmatched line items to process\. 1 payer denial\(s\) could not be applied .*Retry denial button.* 1 denied line\(s\) have no recorded payment and need manual review/);
  });
});
