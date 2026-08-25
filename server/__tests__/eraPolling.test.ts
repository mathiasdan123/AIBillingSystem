/**
 * Automated ERA polling.
 *
 * Two properties matter more than anything else here, and they pull against
 * each other:
 *
 *   NEVER SKIP    — a remittance missed is money that never gets posted; the
 *                   claim sits in A/R and the patient is never billed.
 *   NEVER DOUBLE  — a remittance ingested twice inflates collections and the
 *                   6% platform fee, and posts a payment that did not happen.
 *
 * The design resolves that by deliberately overlapping the poll window (so
 * skipping is impossible) and deduping on Stedi's transaction id (so the
 * resulting re-reads are harmless). These tests pin both halves; either alone
 * is a bug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  practices: [] as any[],
  practiceUpdates: [] as any[],
  poll: vi.fn(),
  fetch835: vi.fn(),
  ingest: vi.fn(),
  autoMatch: vi.fn(),
  stediKey: vi.fn(),
}));

vi.mock('../db', () => {
  const db: any = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(H.practices) }) }),
    update: () => ({
      set: (values: any) => ({
        where: () => {
          H.practiceUpdates.push(values);
          return Promise.resolve([]);
        },
      }),
    }),
  };
  return { db, getDb: () => db };
});
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/stediService', () => ({
  isStediConfigured: () => true,
  getStediApiKeyForPractice: H.stediKey,
}));
vi.mock('../services/stediEraService', () => ({
  pollTransactions: H.poll,
  fetch835Report: H.fetch835,
  is835: (t: any) => String(t.transactionType ?? '').includes('835'),
}));
vi.mock('../services/stedi835Normalizer', () => ({
  normalizeStedi835: (r: any) => r,
}));
vi.mock('../services/remittanceIngestionService', () => ({ ingestRemittance: H.ingest }));
vi.mock('../services/eraAutoMatchService', () => ({ autoMatchRemittance: H.autoMatch }));
vi.mock('../services/phiEncryptionService', () => ({
  encryptRemittanceLineItem: (i: any) => i,
}));

import { pollAndIngestEras } from '../services/eraPollingService';

beforeEach(() => {
  vi.clearAllMocks();
  H.practices = [{ id: 1, name: 'Wonderkids', lastEraPolledAt: null }];
  H.practiceUpdates = [];
  H.stediKey.mockResolvedValue({ apiKey: 'LIVE_KEY', isSandbox: false });
  H.poll.mockResolvedValue({
    transactions: [{ transactionId: 'txn-1', transactionType: '835' }],
    nextPageToken: null,
  });
  H.fetch835.mockResolvedValue({ payerName: 'Horizon', lineItems: [] });
  H.ingest.mockResolvedValue({ status: 'created', remittanceId: 500 });
  H.autoMatch.mockResolvedValue({ matched: 1, total: 1, results: [], postingFailures: [] });
});

describe('pollAndIngestEras', () => {
  it('ingests an 835 and runs it through auto-match', async () => {
    const summary = await pollAndIngestEras();

    expect(H.fetch835).toHaveBeenCalledWith({ apiKey: 'LIVE_KEY', transactionId: 'txn-1' });
    expect(summary.remittancesIngested).toBe(1);
    expect(summary.lineItemsMatched).toBe(1);
  });

  it('passes the Stedi transaction id so re-reads are deduped', async () => {
    await pollAndIngestEras();

    // The poll window overlaps on purpose, so seeing txn-1 again is expected.
    // Without this id the only defence is the content hash, which Stedi can
    // break simply by re-serialising the JSON.
    expect(H.ingest.mock.calls[0][2].stediTransactionId).toBe('txn-1');
  });

  it('counts a duplicate as skipped and does NOT re-post it', async () => {
    H.ingest.mockResolvedValue({ status: 'duplicate', reason: 'transaction_id', remittanceId: 500 });

    const summary = await pollAndIngestEras();

    expect(summary.duplicatesSkipped).toBe(1);
    expect(summary.remittancesIngested).toBe(0);
    // The critical assertion: a re-seen remittance must not post money again.
    expect(H.autoMatch).not.toHaveBeenCalled();
  });

  it('rewinds the cursor so the next run re-covers this run', async () => {
    const before = Date.now();
    await pollAndIngestEras();

    const written = H.practiceUpdates.at(-1).lastEraPolledAt as Date;
    // A cursor set tightly to "now" drops transactions Stedi finished
    // processing while the sweep was running.
    expect(written.getTime()).toBeLessThan(before);
  });

  it('ignores 277 acknowledgments', async () => {
    H.poll.mockResolvedValue({
      transactions: [{ transactionId: 'txn-277', transactionType: '277' }],
      nextPageToken: null,
    });

    const summary = await pollAndIngestEras();

    expect(H.fetch835).not.toHaveBeenCalled();
    expect(summary.remittancesIngested).toBe(0);
  });

  it('skips a sandbox practice rather than polling under the shared test key', async () => {
    H.stediKey.mockResolvedValue({ apiKey: 'GLOBAL_TEST', isSandbox: true });

    await pollAndIngestEras();

    // Polling under the global test key would pull another account's
    // transactions into this practice's remittance list.
    expect(H.poll).not.toHaveBeenCalled();
  });

  it('keeps going when one remittance fails, and reports it', async () => {
    H.poll.mockResolvedValue({
      transactions: [
        { transactionId: 'bad', transactionType: '835' },
        { transactionId: 'good', transactionType: '835' },
      ],
      nextPageToken: null,
    });
    H.fetch835.mockRejectedValueOnce(new Error('502 from Stedi'));

    const summary = await pollAndIngestEras();

    expect(summary.remittancesIngested).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].transactionId).toBe('bad');
  });

  it('surfaces posting failures instead of reporting a clean match', async () => {
    H.autoMatch.mockResolvedValue({
      matched: 1,
      total: 1,
      results: [],
      postingFailures: [{ claimId: 7, lineItemId: 9 }],
    });

    const summary = await pollAndIngestEras();

    // Matched but not recorded: the claim looks reconciled while the money is
    // missing from collections.
    expect(summary.postingFailures).toBe(1);
  });

  it('uses a bounded lookback on a practice that has never been polled', async () => {
    await pollAndIngestEras();

    const startDateTime = new Date(H.poll.mock.calls[0][0].startDateTime).getTime();
    const daysAgo = (Date.now() - startDateTime) / 86_400_000;
    // Not the beginning of time — enabling this on an established practice
    // must not try to re-ingest years of remittances in one run.
    expect(daysAgo).toBeGreaterThan(29);
    expect(daysAgo).toBeLessThan(31);
  });
});
