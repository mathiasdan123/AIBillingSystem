import { afterEach, describe, expect, it, vi } from 'vitest';
import { listLifecycleClaims } from '../services/claimLifecycleService';

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('listLifecycleClaims', () => {
  it('maps claim records from the items envelope', async () => {
    mockFetchOnce({
      items: [
        {
          id: 'clm_1',
          patientControlNumber: '4711',
          status: 'PROCESSED',
          statusReportedBy: 'PAYER',
          stediPayerId: 'HGJLR',
          type: 'PROFESSIONAL',
          submittedAt: '2026-09-01T12:00:00Z',
          totalClaimChargeAmount: '175.00',
          totalClaimPaidAmount: '120.00',
          datesOfService: { start: '2026-08-28' },
        },
      ],
      nextPageToken: 'tok-2',
    });
    const page = await listLifecycleClaims({ apiKey: 'k', submittedAfter: '2026-08-01T00:00:00Z' });
    expect(page.claims).toHaveLength(1);
    expect(page.claims[0]).toMatchObject({
      id: 'clm_1',
      patientControlNumber: '4711',
      status: 'PROCESSED',
      totalClaimPaidAmount: '120.00',
    });
    expect(page.nextPageToken).toBe('tok-2');
  });

  it('treats an empty page as end-of-stream even with a token (ERA-poller lesson)', async () => {
    mockFetchOnce({ items: [], nextPageToken: 'tok-forever' });
    const page = await listLifecycleClaims({ apiKey: 'k', pageToken: 'tok-1' });
    expect(page.claims).toEqual([]);
    expect(page.nextPageToken).toBeNull();
  });

  it('refuses to let a 404 impersonate an empty result', async () => {
    mockFetchOnce({ message: 'not found' }, 404);
    await expect(
      listLifecycleClaims({ apiKey: 'k', submittedAfter: '2026-08-01T00:00:00Z' }),
    ).rejects.toThrow(/path is wrong/);
  });

  it('sends filters as query parameters', async () => {
    mockFetchOnce({ items: [] });
    await listLifecycleClaims({
      apiKey: 'k',
      submittedAfter: '2026-08-01T00:00:00Z',
      statuses: ['DENIED', 'REJECTED'],
      patientControlNumbers: ['42'],
    });
    const url = (global.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('submittedAfter=2026-08-01');
    expect(url).toContain('status=DENIED');
    expect(url).toContain('status=REJECTED');
    expect(url).toContain('patientControlNumbers=42');
  });
});
