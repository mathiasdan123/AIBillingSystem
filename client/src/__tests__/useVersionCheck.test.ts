import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useVersionCheck } from '@/hooks/useVersionCheck';

/**
 * The version probe must hit /api/release — the ultra-light endpoint that
 * exists exactly for per-tab polling — and never /api/health, which pings
 * the database and Redis server-side on every call (2026-10-14 audit:
 * /api/health was being fired on every page load of every user).
 */
describe('useVersionCheck', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VITE_RELEASE_SHA', 'deadbeef');
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ release: 'newsha123' }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('probes the cheap /api/release endpoint, never /api/health', async () => {
    const { result } = renderHook(() => useVersionCheck());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.includes('/api/release'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/health'))).toBe(false);

    // And it still detects the SHA mismatch (server newsha123 vs build deadbeef).
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays quiet when the server matches the build SHA', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ release: 'deadbeef' }),
    } as Response);

    const { result } = renderHook(() => useVersionCheck());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
