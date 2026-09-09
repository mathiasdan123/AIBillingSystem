import { afterEach, describe, expect, it, vi } from 'vitest';
import { is835, pollTransactions } from '../services/stediEraService';

function mockFetchOnce(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('pollTransactions envelope handling (core 2023-08-01, observed live)', () => {
  it('reads the transaction set identifier from x12 metadata', async () => {
    mockFetchOnce({
      items: [
        {
          transactionId: 'txn-1',
          processedAt: '2026-09-09T12:39:48Z',
          x12: { metadata: { transaction: { transactionSetIdentifier: '835' } } },
        },
      ],
      nextPageToken: 'tok-next',
    });
    const page = await pollTransactions({ apiKey: 'k', startDateTime: '2026-09-08T00:00:00Z' });
    expect(page.transactions).toEqual([
      { transactionId: 'txn-1', transactionType: '835', createdAt: '2026-09-09T12:39:48Z' },
    ]);
    expect(is835(page.transactions[0]!)).toBe(true);
    expect(page.nextPageToken).toBe('tok-next');
  });

  it('treats an empty page as end-of-stream even when a token is returned', async () => {
    // Verified live: a quiet account returns items:[] plus a nextPageToken
    // forever (tail-follow semantics). Following it made every sweep run to
    // the page cap.
    mockFetchOnce({ items: [], nextPageToken: 'tok-forever' });
    const page = await pollTransactions({ apiKey: 'k', pageToken: 'tok-prev' });
    expect(page.transactions).toEqual([]);
    expect(page.nextPageToken).toBeNull();
  });

  it('still honors flat transactionType fields from older shapes', async () => {
    mockFetchOnce({ transactions: [{ transactionId: 't2', transactionType: '277' }] });
    const page = await pollTransactions({ apiKey: 'k', startDateTime: '2026-09-08T00:00:00Z' });
    expect(page.transactions[0]?.transactionType).toBe('277');
    expect(is835(page.transactions[0]!)).toBe(false);
  });
});
