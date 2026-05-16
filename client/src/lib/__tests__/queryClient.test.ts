import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../supabase', () => ({ supabase: null }));

import { getQueryFn } from '../queryClient';

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function invoke(queryKey: readonly unknown[]) {
  const fn = getQueryFn<unknown>({ on401: 'throw' });
  // Cast: react-query's QueryFunctionContext has more fields, but the impl
  // only reads queryKey.
  return fn({ queryKey } as any);
}

describe('getQueryFn missing-segment guard', () => {
  it('fetches normally when every segment is defined', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: 1 }),
    });
    await expect(invoke(['/api/appointments', 42])).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/appointments/42',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('refuses to fetch when a segment is undefined', async () => {
    await expect(invoke(['/api/appointments', undefined])).rejects.toThrow(
      /segment 1 is undefined/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to fetch when a segment is null', async () => {
    await expect(invoke(['/api/appointments', null, 'copay-info'])).rejects.toThrow(
      /segment 1 is null/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to fetch when a segment is NaN', async () => {
    await expect(invoke(['/api/appointments', NaN])).rejects.toThrow(
      /segment 1 is NaN/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('error includes the full queryKey for debuggability', async () => {
    await expect(
      invoke(['/api/appointments', undefined, 'copay-info']),
    ).rejects.toThrow(
      /\["\/api\/appointments",null,"copay-info"\]/,
    );
  });

  it('allows zero (a valid id) and empty string (might be intentional)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    await expect(invoke(['/api/foo', 0])).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/foo/0',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
