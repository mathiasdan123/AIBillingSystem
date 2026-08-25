/**
 * A claim confirmed paid by the 276/277 status jobs must record the money.
 *
 * Both status paths — the 4-hourly poller and the daily reaper — wrote
 * `claims.paidAmount` and stopped there. But A/R, patient statements, the
 * collections rate and the 6%-of-collections basis all read
 * `payment_postings`, so a claim the system believed was paid contributed $0
 * to every one of them.
 *
 * Normally the ERA repairs that. But ERA delivery is enrollment-gated per
 * payer (Horizon BCBS NJ reports `eraPayment: ENROLLMENT_REQUIRED` while
 * claims are already SUPPORTED), so a practice that can bill but is not yet
 * ERA-enrolled never receives one. For them the 277 is the only signal that
 * will ever exist and the gap is permanent.
 *
 * The dangerous half of the fix is the other direction: if the ERA later
 * lands and simply adds a second posting, the money is counted TWICE — which
 * over-reports collections and over-bills the platform fee. So an ERA posting
 * must supersede the inferred one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state, postPayment } = vi.hoisted(() => {
  const state = { existingPostings: [] as any[], postPaymentCalls: [] as any[] };
  const postPayment = vi.fn(async (practiceId: number, data: any) => {
    state.postPaymentCalls.push({ practiceId, data });
    return { id: 1, ...data };
  });
  return { state, postPayment };
});

vi.mock('../db', () => {
  const db: any = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(state.existingPostings),
      }),
    }),
  };
  return { db, getDb: () => db };
});
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/paymentPostingService', () => ({ postPayment }));

import { recordStatusDerivedPayment } from '../services/statusDerivedPayment';

beforeEach(() => {
  state.existingPostings = [];
  state.postPaymentCalls = [];
  postPayment.mockClear();
  postPayment.mockImplementation(async (practiceId: number, data: any) => {
    state.postPaymentCalls.push({ practiceId, data });
    return { id: 1, ...data };
  });
});

describe('recordStatusDerivedPayment', () => {
  it('records the payment so collections stop reading $0', async () => {
    const spy = postPayment;

    await recordStatusDerivedPayment({
      claimId: 42,
      practiceId: 1,
      payerName: 'Horizon BCBS NJ',
      paidAmount: 120.5,
      paidDate: '2026-08-20',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const { practiceId, data } = state.postPaymentCalls[0];
    expect(practiceId).toBe(1);
    expect(data.claimId).toBe(42);
    expect(data.paymentAmount).toBe('120.50');
    expect(data.payerName).toBe('Horizon BCBS NJ');
  });

  it("tags the posting 'claim_status' so an ERA can later supersede it", async () => {

    await recordStatusDerivedPayment({
      claimId: 42,
      practiceId: 1,
      paidAmount: 100,
    });

    // Without this tag the supersede in postPayment cannot find the row, and
    // the ERA would stack on top of it.
    expect(state.postPaymentCalls[0].data.source).toBe('claim_status');
  });

  it('leaves patient responsibility at zero rather than inferring it', async () => {

    await recordStatusDerivedPayment({
      claimId: 42,
      practiceId: 1,
      paidAmount: 100,
    });

    // A 277 carries no CAS breakdown. Deriving a patient balance from the
    // billed charge is the balance-billing error; zero here means "unknown".
    expect(state.postPaymentCalls[0].data.patientResponsibility).toBe('0');
    expect(state.postPaymentCalls[0].data.adjustmentAmount).toBe('0');
  });

  it('does not stack a second posting on a claim that already has money', async () => {
    const spy = postPayment;
    state.existingPostings = [{ id: 7 }];

    await recordStatusDerivedPayment({
      claimId: 42,
      practiceId: 1,
      paidAmount: 100,
    });

    // These jobs run every 4 hours and a claim can move paid -> denied -> paid.
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores a zero or missing paid amount', async () => {
    const spy = postPayment;

    await recordStatusDerivedPayment({
      claimId: 42,
      practiceId: 1,
      paidAmount: 0,
    });
    await recordStatusDerivedPayment({
      claimId: 42,
      practiceId: 1,
      paidAmount: null,
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('never throws — a posting failure must not abort the status sweep', async () => {
    postPayment.mockRejectedValue(new Error('db exploded'));

    await expect(
      recordStatusDerivedPayment({
        claimId: 42,
        practiceId: 1,
        paidAmount: 100,
      }),
    ).resolves.toBeUndefined();
  });
});
