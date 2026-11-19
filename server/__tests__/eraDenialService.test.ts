/**
 * ERA denials applied to the claim (demo billing test 2026-11-19, item 5).
 * A synthetic 835 with CLP02 4, paid $0 and CAS CO-197 $100 matched to a
 * claim left it in its old status with no denial reason, no appeal and
 * nothing in the work queue; the Payments tab showed the $100 as a 100%
 * write-off with no reason code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { storageStub, eventMock, pipelineMock } = vi.hoisted(() => ({
  storageStub: {
    getClaim: vi.fn(),
    updateClaim: vi.fn(async (id: number, data: any) => ({ id, ...data })),
  },
  eventMock: vi.fn(async () => undefined),
  pipelineMock: vi.fn(async (claimId: number) => ({ claimId, appealCreated: true, appealId: 91, followUpCreated: true, autoFixesApplied: 0 })),
}));

vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/claimEventService', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  recordClaimEvent: eventMock,
}));
vi.mock('../services/denialPipelineService', () => ({ processDeniedClaim: pipelineMock }));

import {
  applyRemittanceDenial,
  denialReasonForLine,
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
    expect(result.pipeline).toMatchObject({ appealCreated: true, appealId: 91, followUpCreated: true });
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

  it('is idempotent on an already-denied claim', async () => {
    storageStub.getClaim.mockResolvedValue({ id: 73, practiceId: 1, status: 'denied', denialReason: 'CO-197: ...' });
    const result = await applyRemittanceDenial(1, 73, DENIED_LINE, { remittanceId: 500 });
    expect(result).toMatchObject({ denied: false, skippedReason: 'already_denied' });
    expect(storageStub.updateClaim).not.toHaveBeenCalled();
    expect(eventMock).not.toHaveBeenCalled();
    expect(pipelineMock).not.toHaveBeenCalled();
  });

  it('reports a failed pipeline on the result; the denial itself is already on the claim', async () => {
    storageStub.getClaim.mockResolvedValue({ id: 73, practiceId: 1, status: 'submitted' });
    pipelineMock.mockRejectedValueOnce(new Error('AI generator unavailable'));
    const result = await applyRemittanceDenial(1, 73, DENIED_LINE, { remittanceId: 500 });
    expect(result.denied).toBe(true);
    expect(result.pipeline).toMatchObject({ appealCreated: false, followUpCreated: false, error: 'AI generator unavailable' });
  });

  it('gives a denied line with no CARC a readable reason', () => {
    expect(denialReasonForLine({ claimStatusCode: '4', adjustmentReasonCodes: [] })).toMatch(/835 claim status 4, no adjustment reason code/);
  });
});
