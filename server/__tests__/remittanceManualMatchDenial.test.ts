/**
 * Manual ERA match route (demo billing test 2026-11-19, item 5):
 *  - a remittance line cannot be matched to a Draft or Held claim (a payer
 *    cannot have adjudicated a claim that was never sent — the auto-matcher
 *    already excluded them; the manual route did not);
 *  - the posting carries the CARC / RARC (adjustmentReason / remarkCode);
 *  - a denied line (CLP02 4) applies the denial to the claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  state: { remittance: null as any, lineItem: null as any, claim: null as any, allLines: [] as any[], lineUpdates: [] as any[], remitUpdates: [] as any[] },
  postPayment: vi.fn(async () => ({ id: 1 })),
  applyDenial: vi.fn(async () => ({ claimId: 73, denied: true, denialReason: 'CO-197: Contractual Obligation: Precertification/authorization/notification absent', pipeline: { appealCreated: true, appealId: 91, followUpCreated: true } })),
}));

vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/paymentPostingService', () => ({ postPayment: H.postPayment }));
vi.mock('../services/eraDenialService', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  applyRemittanceDenial: H.applyDenial,
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
      // The first select is the single line, the second the whole remittance.
      return H.state.allLines.length ? H.state.allLines : s.lineItem ? [s.lineItem] : [];
    }
    if (table === schema.claims) return s.claim ? [s.claim] : [];
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
          if (table === schema.remittanceLineItems) H.state.lineUpdates.push(values);
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

const DENIED_LINE = {
  id: 31, remittanceId: 500, claimId: null, status: 'unmatched', patientName: 'Ethan Example', cptCode: '97140',
  chargedAmount: '100.00', allowedAmount: null, paidAmount: '0.00', adjustmentAmount: '100.00', patientResponsibility: '0.00',
  claimStatusCode: '4',
  adjustmentReasonCodes: [{ code: 'CO-197', description: 'Contractual Obligation: Precertification/authorization/notification absent' }],
  remarkCodes: [],
};
const PAID_LINE = {
  ...DENIED_LINE, id: 32, cptCode: '97530', chargedAmount: '250.00', allowedAmount: '200.00', paidAmount: '160.00', adjustmentAmount: '90.00',
  patientResponsibility: '40.00', claimStatusCode: '1',
  adjustmentReasonCodes: [{ code: 'CO-45', description: 'Contractual Obligation: Charge exceeds fee schedule/maximum allowable/contracted/legislated amount' }, { code: 'PR-2', description: 'Patient Responsibility: Coinsurance amount' }],
  remarkCodes: [{ code: 'N130', description: 'N130' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  H.state.remittance = { id: 500, practiceId: 1, payerName: 'Aetna QA Synthetic', checkNumber: 'QA-SYN-1', checkDate: '2026-11-18', receivedDate: '2026-11-19' };
  H.state.claim = { id: 73, practiceId: 1, claimNumber: 'CLM-MWNVFA08-DIJSKH', status: 'submitted', totalAmount: '100.00' };
  H.state.lineItem = DENIED_LINE;
  H.state.allLines = [];
  H.state.lineUpdates = [];
  H.state.remitUpdates = [];
});

describe('POST /api/remittance/:id/line-items/:lineItemId/match', () => {
  it.each(['draft', 'held'])('refuses a %s claim and records nothing', async (status) => {
    H.state.claim = { ...H.state.claim, status };

    const res = await request(makeApp()).post('/api/remittance/500/line-items/31/match').send({ claimId: 73 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('claim_not_submitted');
    expect(res.body.message).toMatch(/CLM-MWNVFA08-DIJSKH is (draft|held)/);
    expect(res.body.message).toMatch(/Submit the claim first/);
    expect(H.state.lineUpdates).toHaveLength(0);
    expect(H.postPayment).not.toHaveBeenCalled();
    expect(H.applyDenial).not.toHaveBeenCalled();
  });

  it('a denied line: posts $0 with the CARC as the reason, then applies the denial to the claim', async () => {
    const res = await request(makeApp()).post('/api/remittance/500/line-items/31/match').send({ claimId: 73 });

    expect(res.status).toBe(200);
    expect(H.state.lineUpdates[0]).toMatchObject({ claimId: 73, status: 'matched', matchType: 'manual' });

    expect(H.postPayment).toHaveBeenCalledTimes(1);
    const [practiceId, posting] = H.postPayment.mock.calls[0] as any[];
    expect(practiceId).toBe(1);
    expect(posting).toMatchObject({
      source: 'era',
      claimId: 73,
      paymentAmount: '0.00',
      adjustmentAmount: '100.00',
      adjustmentReason: 'CO-197: Contractual Obligation: Precertification/authorization/notification absent',
      remarkCode: null,
      postedBy: 'biller-1',
    });

    expect(H.applyDenial).toHaveBeenCalledTimes(1);
    const [p2, claimId, line, opts] = H.applyDenial.mock.calls[0] as any[];
    expect([p2, claimId]).toEqual([1, 73]);
    expect(line.id).toBe(31);
    expect(opts).toMatchObject({ remittanceId: 500, payerName: 'Aetna QA Synthetic', checkNumber: 'QA-SYN-1', postedBy: 'biller-1' });
    // Posting first, denial second: postPayment owns paidAmount/status.
    expect(H.postPayment.mock.invocationCallOrder[0]).toBeLessThan(H.applyDenial.mock.invocationCallOrder[0]);

    expect(res.body).toMatchObject({ claimId: 73, lineItemId: 31, denied: true });
    expect(res.body.message).toMatch(/payer denied this claim .*CO-197.*now Denied with an appeal drafted/);
  });

  it('a processed line: posts the money with the CARC/RARC and does not touch the claim status', async () => {
    H.state.lineItem = PAID_LINE;

    const res = await request(makeApp()).post('/api/remittance/500/line-items/32/match').send({ claimId: 73 });

    expect(res.status).toBe(200);
    expect(H.postPayment.mock.calls[0][1]).toMatchObject({
      paymentAmount: '160.00',
      adjustmentAmount: '90.00',
      patientResponsibility: '40.00',
      allowedAmount: '200.00',
      adjustmentReason:
        'CO-45: Contractual Obligation: Charge exceeds fee schedule/maximum allowable/contracted/legislated amount; PR-2: Patient Responsibility: Coinsurance amount',
      remarkCode: 'N130',
    });
    expect(H.applyDenial).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ denied: false, denialReason: null, message: 'Line item matched to claim successfully' });
  });

  it('a line with no status code is not a denial even at $0 paid', async () => {
    H.state.lineItem = { ...DENIED_LINE, claimStatusCode: null };
    const res = await request(makeApp()).post('/api/remittance/500/line-items/31/match').send({ claimId: 73 });
    expect(res.status).toBe(200);
    expect(H.applyDenial).not.toHaveBeenCalled();
    expect(res.body.denied).toBe(false);
  });
});
