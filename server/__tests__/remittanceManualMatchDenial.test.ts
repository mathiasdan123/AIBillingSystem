/**
 * Manual ERA match route (demo billing test 2026-11-19, item 5; #497 review):
 *  - a line cannot be matched to a claim that was NEVER sent (draft/held
 *    with no transmission evidence); a held claim the clearinghouse
 *    rejected, or sent-but-unconfirmed, or a reopened draft, CAN be — the
 *    ERA is the evidence that settles it, and the refusal never says
 *    "resubmit";
 *  - the posting carries the CARC / RARC (adjustmentReason / remarkCode);
 *  - a denied line (CLP02 4) applies the denial to the claim after posting;
 *  - the route is idempotent: a retry after a failure never posts twice,
 *    and only the denial step is repeated;
 *  - the response reports the real pipeline state (appeal drafted / reused /
 *    failed) and a partial-success state with a retry path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  state: {
    remittance: null as any, lineItem: null as any, claim: null as any, events: [] as any[],
    allLines: [] as any[], lineUpdates: [] as any[], remitUpdates: [] as any[],
  },
  postPayment: vi.fn(async () => ({ id: 1 })),
  applyDenial: vi.fn(),
}));

vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/paymentPostingService', () => ({ postPayment: H.postPayment }));
vi.mock('../services/eraDenialService', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  applyRemittanceDenialToLine: H.applyDenial,
}));
vi.mock('../services/eraAutoMatchService', () => ({ autoMatchRemittance: vi.fn() }));
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
  const rowsFor = (table: any): any[] => {
    const s = H.state;
    if (table === schema.remittanceLineItems) {
      // The first select is the single line, the later one the whole remittance.
      return H.state.allLines.length ? H.state.allLines : s.lineItem ? [s.lineItem] : [];
    }
    if (table === schema.claims) return s.claim ? [s.claim] : [];
    if (table === schema.claimEvents) return s.events;
    return [];
  };
  const builder = () => {
    let table: any = null;
    const b: any = {
      from: (t: any) => ((table = t), b),
      where: () => b,
      then: (resolve: any, reject: any) => Promise.resolve(rowsFor(table)).then(resolve, reject),
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
  id: 31, remittanceId: 500, claimId: null, status: 'unmatched', patientName: 'Ethan Example', cptCode: '97140',
  chargedAmount: '100.00', allowedAmount: null, paidAmount: '0.00', adjustmentAmount: '100.00', patientResponsibility: '0.00',
  claimStatusCode: '4', postedAt: null, denialAppliedAt: null, denialError: null,
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
const PIPELINE_FAILED = { ...APPLIED, applied: false, pipeline: { ran: true, appealCreated: false, appealReused: false, followUpCreated: false, error: 'AI generator unavailable' } };

const match = (lineId = 31) => request(makeApp()).post(`/api/remittance/500/line-items/${lineId}/match`).send({ claimId: 73 });

beforeEach(() => {
  vi.clearAllMocks();
  H.postPayment.mockResolvedValue({ id: 1 });
  H.applyDenial.mockResolvedValue(APPLIED);
  H.state.remittance = { id: 500, practiceId: 1, payerName: 'Aetna QA Synthetic', checkNumber: 'QA-SYN-1', checkDate: '2026-11-18', receivedDate: '2026-11-19' };
  H.state.claim = CLAIM();
  H.state.lineItem = DENIED_LINE();
  H.state.events = [];
  H.state.allLines = [];
  H.state.lineUpdates = [];
  H.state.remitUpdates = [];
});

describe('manual match — which claims may receive a remittance', () => {
  it.each(['draft', 'held'])('refuses a %s claim that was never sent, without saying "resubmit"', async (status) => {
    H.state.claim = { ...CLAIM(), ...NEVER_SENT, status };

    const res = await match();

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('claim_not_submitted');
    expect(res.body.message).toMatch(/has never been sent to a payer/);
    expect(res.body.message).toMatch(/Submit the claim first/);
    expect(res.body.message).not.toMatch(/resubmit/i);
    expect(H.state.lineUpdates).toHaveLength(0);
    expect(H.postPayment).not.toHaveBeenCalled();
    expect(H.applyDenial).not.toHaveBeenCalled();
  });

  it('accepts a held claim that was SENT but unconfirmed (clearinghouse attempt on record)', async () => {
    // The submit route's "sent but could not be confirmed, DO NOT RESUBMIT" hold.
    H.state.claim = { ...CLAIM(), ...NEVER_SENT, status: 'held', clearinghouseSubmittedAt: new Date('2026-11-18T15:00:00Z'), clearinghouseStatus: 'pending', holdReason: 'Clearinghouse submission failed: ...' };

    const res = await match();

    expect(res.status).toBe(200);
    expect(H.postPayment).toHaveBeenCalledTimes(1);
  });

  it('accepts a held claim the clearinghouse rejected (it carries the attempt id)', async () => {
    H.state.claim = { ...CLAIM(), ...NEVER_SENT, status: 'held', clearinghouseClaimId: 'STEDI-REJ-1' };
    const res = await match();
    expect(res.status).toBe(200);
  });

  it('accepts a reopened draft whose history shows a submission', async () => {
    H.state.claim = { ...CLAIM(), ...NEVER_SENT, status: 'draft', resubmissionCount: 1 };
    H.state.events = [{ eventType: 'submitted' }];
    const res = await match();
    expect(res.status).toBe(200);
    expect(H.postPayment).toHaveBeenCalledTimes(1);
  });

  it('refuses to re-point a line already matched to a different claim', async () => {
    H.state.lineItem = { ...DENIED_LINE(), claimId: 74, status: 'matched', matchType: 'manual', postedAt: new Date() };
    const res = await match();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('line_already_matched');
    expect(H.postPayment).not.toHaveBeenCalled();
  });
});

describe('manual match — posting and the denial step', () => {
  it('a denied line: posts $0 with the CARC as the reason, then applies the denial, and says what the pipeline did', async () => {
    const res = await match();

    expect(res.status).toBe(200);
    expect(H.state.lineUpdates[0]).toMatchObject({ claimId: 73, status: 'matched', matchType: 'manual' });
    expect(H.state.lineUpdates[0].postedAt).toBeInstanceOf(Date);

    expect(H.postPayment).toHaveBeenCalledTimes(1);
    const [practiceId, posting] = H.postPayment.mock.calls[0] as any[];
    expect(practiceId).toBe(1);
    expect(posting).toMatchObject({ source: 'era', claimId: 73, paymentAmount: '0.00', adjustmentAmount: '100.00', adjustmentReason: CARC_197, remarkCode: null, postedBy: 'biller-1' });

    expect(H.applyDenial).toHaveBeenCalledTimes(1);
    const [p2, line, opts] = H.applyDenial.mock.calls[0] as any[];
    expect(p2).toBe(1);
    expect(line).toMatchObject({ id: 31, claimId: 73 });
    expect(opts).toMatchObject({ remittanceId: 500, payerName: 'Aetna QA Synthetic', checkNumber: 'QA-SYN-1', postedBy: 'biller-1' });
    expect(H.postPayment.mock.invocationCallOrder[0]).toBeLessThan(H.applyDenial.mock.invocationCallOrder[0]);

    expect(res.body).toMatchObject({
      claimId: 73, lineItemId: 31, posted: true, alreadyPosted: false, partial: false, denied: true, claimStatus: 'denied', denialReason: CARC_197,
      denial: { applied: true, statusChanged: true, appealCreated: true, appealReused: false, appealId: 91, followUpCreated: true, error: null },
    });
    expect(res.body.message).toMatch(/Payment recorded\. The payer denied claim CLM-MWNVFA08-DIJSKH \(CO-197.*now Denied, an appeal was drafted \(#91\), and a denial follow-up was added/);
  });

  it('reports an existing appeal as reused, not as newly drafted', async () => {
    H.applyDenial.mockResolvedValue(REUSED);
    const res = await match();
    expect(res.body.denial).toMatchObject({ appealCreated: false, appealReused: true, appealId: 91 });
    expect(res.body.message).toMatch(/already Denied, the existing appeal #91 was kept, and the denial follow-up already existed/);
    expect(res.body.message).not.toMatch(/appeal was drafted/);
  });

  it('a failed pipeline is a partial success with a retry path, never a claim that an appeal was drafted', async () => {
    H.applyDenial.mockResolvedValue(PIPELINE_FAILED);

    const res = await match();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ posted: true, partial: true, denied: true, claimStatus: 'denied', denial: { applied: false, appealCreated: false, error: 'AI generator unavailable' } });
    expect(res.body.message).toMatch(/marked Denied .*but the appeal draft \/ follow-up failed: AI generator unavailable/);
    expect(res.body.message).toMatch(/Match this line again .*retry the denial step; the payment will not be posted twice/);
    expect(res.body.message).not.toMatch(/appeal was drafted/);
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
});

describe('manual match — idempotency (#497 review)', () => {
  it('a posting failure clears the posted marker and answers 502 with "nothing has been posted"', async () => {
    H.postPayment.mockRejectedValueOnce(new Error('db down'));

    const res = await match();

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: 'posting_failed', posted: false });
    expect(res.body.message).toMatch(/payment was NOT recorded \(db down\).*Match it again to retry; nothing has been posted/);
    // Marker set before the attempt, cleared after the failure.
    expect(H.state.lineUpdates[0].postedAt).toBeInstanceOf(Date);
    expect(H.state.lineUpdates.at(-1)).toEqual({ postedAt: null });
    expect(H.state.lineItem.postedAt).toBeNull();
    expect(H.applyDenial).not.toHaveBeenCalled();
  });

  it('a retry after the posting succeeded but the denial step failed re-runs ONLY the denial step', async () => {
    // First attempt: posted, denial pipeline failed.
    H.applyDenial.mockResolvedValueOnce(PIPELINE_FAILED);
    const first = await match();
    expect(first.body.partial).toBe(true);
    expect(H.postPayment).toHaveBeenCalledTimes(1);
    expect(H.state.lineItem.postedAt).toBeInstanceOf(Date);
    // (The line marker the real applyRemittanceDenialToLine would write.)
    H.state.lineItem.denialError = 'AI generator unavailable';
    H.state.lineItem.denialAppliedAt = null;

    // Retry: same request.
    H.applyDenial.mockResolvedValueOnce(REUSED);
    const second = await match();

    expect(second.status).toBe(200);
    expect(H.postPayment).toHaveBeenCalledTimes(1); // not posted twice
    expect(H.applyDenial).toHaveBeenCalledTimes(2);
    expect(second.body).toMatchObject({ posted: false, alreadyPosted: true, partial: false, claimStatus: 'denied' });
    expect(second.body.message).toMatch(/Payment was already recorded; not posted again/);
  });

  it('a retry of a fully completed match posts nothing and reports it as already matched', async () => {
    H.state.lineItem = { ...PAID_LINE(), claimId: 73, status: 'matched', matchType: 'manual', postedAt: new Date('2026-11-18') };
    const res = await match(32);
    expect(res.status).toBe(200);
    expect(H.postPayment).not.toHaveBeenCalled();
    expect(H.state.lineUpdates).toHaveLength(0);
    expect(res.body).toMatchObject({ posted: false, alreadyPosted: true });
    expect(res.body.message).toMatch(/already matched to claim CLM-MWNVFA08-DIJSKH\. Payment was already recorded/);
  });
});
