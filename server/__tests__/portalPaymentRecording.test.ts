/**
 * A patient's card payment must be recorded.
 *
 * Payment links set metadata on the LINK, which does not reach the resulting
 * PaymentIntent, and the webhook handled only mode === 'subscription'. So a
 * patient paying through the portal had their card charged by Stripe and the
 * payment recorded NOWHERE: their balance never cleared and the practice kept
 * dunning someone who had already paid. That is the worst kind of billing
 * error, because the patient knows they paid and our records say otherwise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPaymentByTransactionId } from '../storage/claims';

const { state } = vi.hoisted(() => ({ state: { rows: [] as any[] } }));

vi.mock('../db', () => {
  const db: any = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(state.rows) }),
      }),
    }),
  };
  return { db, getDb: () => db };
});
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

beforeEach(() => { state.rows = []; });

describe('getPaymentByTransactionId — webhook idempotency', () => {
  it('finds an already-recorded payment so a Stripe retry cannot double-credit', async () => {
    state.rows = [{ id: 1, transactionId: 'pi_123', amount: '50.00' }];
    const found = await getPaymentByTransactionId('pi_123');
    expect(found?.id).toBe(1);
  });

  it('returns undefined for a genuinely new payment', async () => {
    const found = await getPaymentByTransactionId('pi_new');
    expect(found).toBeUndefined();
  });
});
