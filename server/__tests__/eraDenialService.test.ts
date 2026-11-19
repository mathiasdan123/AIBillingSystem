/**
 * ERA denials applied to the claim (demo billing test 2026-11-19, item 5).
 * A synthetic 835 with CLP02 4, paid $0 and CAS CO-197 $100 matched to a
 * claim left it in its old status with no denial reason, no appeal and
 * nothing in the work queue; the Payments tab showed the $100 as a 100%
 * write-off with no reason code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { storageStub, eventMock, pipelineMock, lineUpdates } = vi.hoisted(() => ({
  storageStub: {
    getClaim: vi.fn(),
    updateClaim: vi.fn(async (id: number, data: any) => ({ id, ...data })),
  },
  eventMock: vi.fn(async () => undefined),
  pipelineMock: vi.fn(async (claimId: number) => ({ claimId, appealCreated: true, appealId: 91, followUpCreated: true, autoFixesApplied: 0 })),
  lineUpdates: [] as any[],
}));

vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../db', () => ({
  db: {
    update: () => ({
      set: (values: any) => ({
        where: () => {
          if (values && values.__throw) return Promise.reject(new Error('db down'));
          lineUpdates.push(values);
          return Promise.resolve([]);
        },
      }),
    }),
  },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/claimEventService', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  recordClaimEvent: eventMock,
}));
vi.mock('../services/denialPipelineService', () => ({ processDeniedClaim: pipelineMock }));

import {
  applyRemittanceDenial,
  applyRemittanceDenialToLine,
  denialReasonForLine,
  isDenialPending,
  isDeniedRemittanceLine,
  postingReasonFields,
} from '../services/eraDenialService';

// The synthetic denial from the demo test, as the 835 parser stores it.
const DENIED_LINE = {
  id: 31,
  cptCode: '97140',
  chargedAmount: '100.00',
  paidAmount: '0.00',
  adjustmentAmount: '100.00',
  claimStatusCode: '4',
  adjustmentReasonCodes: [{ code: 'CO-197', description: 'Contractual Obligation: Precertification/authorization/notification absent' }],
  remarkCodes: [{ code: 'N54', description: 'N54' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  lineUpdates.length = 0;
  storageStub.updateClaim.mockImplementation(async (id: number, data: any) => ({ id, ...data }));
  pipelineMock.mockResolvedValue({ claimId: 73, appealCreated: true, appealId: 91, followUpCreated: true, autoFixesApplied: 0 });
});

describe('isDeniedRemittanceLine', () => {
  it('is CLP02 = 4, and nothing else', () => {
    expect(isDeniedRemittanceLine(DENIED_LINE)).toBe(true);
    // Processed as primary with $0 paid is a zero allowed amount, not a denial.
    expect(isDeniedRemittanceLine({ ...DENIED_LINE, claimStatusCode: '1' })).toBe(false);
    // Reversal of a prior payment is its own thing.
    expect(isDeniedRemittanceLine({ ...DENIED_LINE, claimStatusCode: '22' })).toBe(false);
    // Legacy rows and uploads without a status are never denials.
    expect(isDeniedRemittanceLine({ ...DENIED_LINE, claimStatusCode: null })).toBe(false);
    expect(isDeniedRemittanceLine({ paidAmount: '0.00' })).toBe(false);
    expect(isDeniedRemittanceLine({ ...DENIED_LINE, claimStatusCode: ' 4 ' })).toBe(true);
  });
});

describe('postingReasonFields', () => {
  it('carries the parser\'s group-prefixed codes with their descriptions', () => {
    expect(postingReasonFields(DENIED_LINE)).toEqual({
      adjustmentReason: 'CO-197: Contractual Obligation: Precertification/authorization/notification absent',
      remarkCode: 'N54',
    });
  });

  it('describes the Stedi normalizer\'s bare codes', () => {
    expect(postingReasonFields({ adjustmentReasonCodes: ['45', '2'], remarkCodes: ['N130', 'M15'] })).toEqual({
      adjustmentReason: '45: Charge exceeds fee schedule/maximum allowable/contracted/legislated amount; 2: Coinsurance amount',
      remarkCode: 'N130, M15',
    });
  });

  it('is null when the line carries no codes', () => {
    expect(postingReasonFields({})).toEqual({ adjustmentReason: null, remarkCode: null });
    expect(postingReasonFields({ adjustmentReasonCodes: 'CO-45' as any, remarkCodes: null })).toEqual({ adjustmentReason: null, remarkCode: null });
  });
});

describe('applyRemittanceDenial', () => {
  it('marks a submitted claim denied with the CARC as the reason, records the event and runs the denial pipeline', async () => {
    storageStub.getClaim.mockResolvedValue({ id: 73, practiceId: 1, status: 'submitted', claimNumber: 'CLM-MWNVFA08-DIJSKH' });

    const result = await applyRemittanceDenial(1, 73, DENIED_LINE, { remittanceId: 500, payerName: 'Aetna', checkNumber: 'QA-1', postedBy: 'biller-1' });

    expect(result.denied).toBe(true);
    expect(result.denialReason).toBe('CO-197: Contractual Obligation: Precertification/authorization/notification absent');
    expect(storageStub.updateClaim).toHaveBeenCalledWith(73, {
      status: 'denied',
      denialReason: 'CO-197: Contractual Obligation: Precertification/authorization/notification absent',
    });
    expect(eventMock).toHaveBeenCalledTimes(1);
    expect(eventMock.mock.calls[0][0]).toMatchObject({
      claimId: 73,
      practiceId: 1,
      eventType: 'denied',
      summary: 'Denied by Aetna (ERA): CO-197: Contractual Obligation: Precertification/authorization/notification absent',
      metadata: {
        source: 'era',
        remittanceId: 500,
        remittanceLineItemId: 31,
        claimStatusCode: '4',
        adjustmentReasonCodes: ['CO-197'],
        remarkCodes: ['N54'],
        previousStatus: 'submitted',
        statusChanged: true,
        checkNumber: 'QA-1',
      },
      createdBy: 'biller-1',
    });
    // Appeal draft + denial_appeal follow-up (Revenue at Risk / Appeals).
    expect(pipelineMock).toHaveBeenCalledWith(73);
    expect(result.pipeline).toMatchObject({ ran: true, appealCreated: true, appealReused: false, appealId: 91, followUpCreated: true });
    expect(result.applied).toBe(true);
    expect(result.claimStatus).toBe('denied');
  });

  it('does nothing for a line that is not a denial', async () => {
    const result = await applyRemittanceDenial(1, 73, { ...DENIED_LINE, claimStatusCode: '1' }, { remittanceId: 500 });
    expect(result).toMatchObject({ denied: false, skippedReason: 'not_denied' });
    expect(storageStub.getClaim).not.toHaveBeenCalled();
    expect(storageStub.updateClaim).not.toHaveBeenCalled();
    expect(pipelineMock).not.toHaveBeenCalled();
  });

  it("refuses another practice's claim", async () => {
    storageStub.getClaim.mockResolvedValue({ id: 73, practiceId: 2, status: 'submitted' });
    const result = await applyRemittanceDenial(1, 73, DENIED_LINE, { remittanceId: 500 });
    expect(result).toMatchObject({ denied: false, skippedReason: 'claim_not_found' });
    expect(storageStub.updateClaim).not.toHaveBeenCalled();
    expect(eventMock).not.toHaveBeenCalled();
  });

  it('keeps a paid/partial claim\'s status (another line paid) and leaves only a timeline note', async () => {
    storageStub.getClaim.mockResolvedValue({ id: 73, practiceId: 1, status: 'partial' });
    const result = await applyRemittanceDenial(1, 73, DENIED_LINE, { remittanceId: 500, payerName: 'Aetna' });
    expect(result).toMatchObject({ denied: false, skippedReason: 'claim_has_payments' });
    expect(storageStub.updateClaim).not.toHaveBeenCalled();
    expect(pipelineMock).not.toHaveBeenCalled();
    expect(eventMock.mock.calls[0][0]).toMatchObject({
      eventType: 'note_added',
      summary: expect.stringMatching(/^ERA denied line 97140: CO-197.*claim stays partial/),
      metadata: { statusChanged: false, previousStatus: 'partial' },
    });
  });

  it('an already-denied claim is not re-flagged, but the appeal / follow-up step still runs (resumable)', async () => {
    storageStub.getClaim.mockResolvedValue({ id: 73, practiceId: 1, status: 'denied', denialReason: 'CO-197: ...' });
    pipelineMock.mockResolvedValueOnce({ claimId: 73, appealCreated: false, appealId: 91, followUpCreated: true, autoFixesApplied: 0, skippedReason: 'appeal_exists' });

    const result = await applyRemittanceDenial(1, 73, DENIED_LINE, { remittanceId: 500 });

    expect(result).toMatchObject({ denied: false, claimStatus: 'denied', applied: true });
    expect(result.skippedReason).toBeUndefined();
    expect(storageStub.updateClaim).not.toHaveBeenCalled();
    expect(eventMock).not.toHaveBeenCalled(); // no second "denied" event
    expect(pipelineMock).toHaveBeenCalledWith(73);
    expect(result.pipeline).toMatchObject({ ran: true, appealCreated: false, appealReused: true, appealId: 91, followUpCreated: true });
  });

  it('a claim already under appeal needs nothing: applied, appeal reused', async () => {
    storageStub.getClaim.mockResolvedValue({ id: 73, practiceId: 1, status: 'appeal' });
    pipelineMock.mockResolvedValueOnce({ claimId: 73, appealCreated: false, followUpCreated: false, autoFixesApplied: 0, skippedReason: 'claim_status_appeal' });
    const result = await applyRemittanceDenial(1, 73, DENIED_LINE, { remittanceId: 500 });
    expect(result).toMatchObject({ denied: false, claimStatus: 'appeal', applied: true, pipeline: { ran: false, appealReused: true } });
    expect(storageStub.updateClaim).not.toHaveBeenCalled();
  });

  it('a thrown pipeline leaves the denial on the claim and marks the result NOT applied (retry later)', async () => {
    storageStub.getClaim.mockResolvedValue({ id: 73, practiceId: 1, status: 'submitted' });
    pipelineMock.mockRejectedValueOnce(new Error('AI generator unavailable'));
    const result = await applyRemittanceDenial(1, 73, DENIED_LINE, { remittanceId: 500 });
    expect(result.denied).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.pipeline).toMatchObject({ appealCreated: false, followUpCreated: false, error: 'AI generator unavailable' });
  });

  it('a pipeline that silently drafted no appeal is reported as an error, so it is retried', async () => {
    storageStub.getClaim.mockResolvedValue({ id: 73, practiceId: 1, status: 'submitted' });
    pipelineMock.mockResolvedValueOnce({ claimId: 73, appealCreated: false, followUpCreated: true, autoFixesApplied: 0 });
    const result = await applyRemittanceDenial(1, 73, DENIED_LINE, { remittanceId: 500 });
    expect(result.applied).toBe(false);
    expect(result.pipeline).toMatchObject({ ran: true, followUpCreated: true, error: expect.stringMatching(/Appeal draft was not created/) });
  });

  it('a reopened draft (transmitted, then reopened) keeps its draft status and gets a timeline note', async () => {
    storageStub.getClaim.mockResolvedValue({ id: 73, practiceId: 1, status: 'draft', resubmissionCount: 1 });
    const result = await applyRemittanceDenial(1, 73, DENIED_LINE, { remittanceId: 500 });
    expect(result).toMatchObject({ denied: false, applied: true, skippedReason: 'claim_reopened', claimStatus: 'draft' });
    expect(storageStub.updateClaim).not.toHaveBeenCalled();
    expect(pipelineMock).not.toHaveBeenCalled();
    expect(eventMock.mock.calls[0][0]).toMatchObject({ eventType: 'note_added', summary: expect.stringMatching(/earlier submission denied line 97140.*draft being corrected/) });
  });

  it('gives a denied line with no CARC a readable reason', () => {
    expect(denialReasonForLine({ claimStatusCode: '4', adjustmentReasonCodes: [] })).toMatch(/835 claim status 4, no adjustment reason code/);
  });
});

describe('applyRemittanceDenialToLine — the denial-pending marker', () => {
  const LINE = { ...DENIED_LINE, claimId: 73, status: 'matched', postedAt: new Date('2026-11-18'), denialAppliedAt: null };

  it('stamps denialAppliedAt and clears denialError when nothing is left to retry', async () => {
    storageStub.getClaim.mockResolvedValue({ id: 73, practiceId: 1, status: 'submitted' });
    const result = await applyRemittanceDenialToLine(1, LINE, { remittanceId: 500 });
    expect(result.applied).toBe(true);
    expect(lineUpdates).toHaveLength(1);
    expect(lineUpdates[0].denialAppliedAt).toBeInstanceOf(Date);
    expect(lineUpdates[0].denialError).toBeNull();
  });

  it('records the error and leaves denialAppliedAt null when the pipeline failed (money untouched)', async () => {
    storageStub.getClaim.mockResolvedValue({ id: 73, practiceId: 1, status: 'submitted' });
    pipelineMock.mockRejectedValueOnce(new Error('AI generator unavailable'));
    const result = await applyRemittanceDenialToLine(1, LINE, { remittanceId: 500 });
    expect(result.applied).toBe(false);
    expect(lineUpdates[0]).toEqual({ denialAppliedAt: null, denialError: 'AI generator unavailable' });
    // The claim did get its denial; only the downstream step is pending.
    expect(storageStub.updateClaim).toHaveBeenCalledWith(73, expect.objectContaining({ status: 'denied' }));
  });

  it('turns a thrown error into a recorded denialError instead of propagating it', async () => {
    storageStub.getClaim.mockRejectedValueOnce(new Error('storage down'));
    const result = await applyRemittanceDenialToLine(1, LINE, { remittanceId: 500 });
    expect(result.applied).toBe(false);
    expect(result.pipeline.error).toBe('storage down');
    expect(lineUpdates[0]).toEqual({ denialAppliedAt: null, denialError: 'storage down' });
  });

  it('a claim that cannot be found stays pending with the reason recorded', async () => {
    storageStub.getClaim.mockResolvedValue(null);
    const result = await applyRemittanceDenialToLine(1, LINE, { remittanceId: 500 });
    expect(result).toMatchObject({ applied: false, skippedReason: 'claim_not_found' });
    expect(lineUpdates[0]).toEqual({ denialAppliedAt: null, denialError: 'claim_not_found' });
  });
});

describe('isDenialPending', () => {
  const base = { status: 'matched', claimId: 73, claimStatusCode: '4', postedAt: new Date(), autoPostedAt: null, denialAppliedAt: null };
  it('is a posted, matched, denied line whose denial is not applied', () => {
    expect(isDenialPending(base)).toBe(true);
    expect(isDenialPending({ ...base, postedAt: null, autoPostedAt: new Date() })).toBe(true);
  });
  it('is not: unposted, already applied, not a denial, or unmatched', () => {
    expect(isDenialPending({ ...base, postedAt: null })).toBe(false);
    expect(isDenialPending({ ...base, denialAppliedAt: new Date() })).toBe(false);
    expect(isDenialPending({ ...base, claimStatusCode: '1' })).toBe(false);
    expect(isDenialPending({ ...base, status: 'unmatched', claimId: null })).toBe(false);
  });
});
