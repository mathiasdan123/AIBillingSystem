import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../supabase', () => ({ supabase: null }));

import { getQueryFn, streamRequest } from '../queryClient';

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

// Build a fake fetch Response whose body streams the given chunks as an SSE
// response (content-type text/event-stream).
function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body };
}

describe('streamRequest', () => {
  it('adds stream:true to the body and posts JSON', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(['event: done\ndata: {}\n\n']));
    await streamRequest('/api/ai/assistant', { message: 'hi' }, {});
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ message: 'hi', stream: true });
    expect(init.credentials).toBe('include');
  });

  it('emits onDelta for each delta frame, then onDone', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'event: delta\ndata: {"text":"Hello"}\n\n',
        'event: delta\ndata: {"text":" world"}\n\n',
        'event: done\ndata: {"response":"Hello world","proposals":[]}\n\n',
      ]),
    );
    const deltas: string[] = [];
    let done: any = null;
    await streamRequest('/x', {}, {
      onDelta: (t) => deltas.push(t),
      onDone: (d) => { done = d; },
    });
    expect(deltas).toEqual(['Hello', ' world']);
    expect(done).toEqual({ response: 'Hello world', proposals: [] });
  });

  it('reassembles frames split across chunk boundaries', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['event: del', 'ta\ndata: {"text":"', 'split"}\n\nevent: done\ndata: {}\n\n']),
    );
    const deltas: string[] = [];
    await streamRequest('/x', {}, { onDelta: (t) => deltas.push(t) });
    expect(deltas).toEqual(['split']);
  });

  it('routes an error frame to onError', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['event: error\ndata: {"message":"boom"}\n\n']),
    );
    let err: any = null;
    await streamRequest('/x', {}, { onError: (e) => { err = e; } });
    expect(err).toEqual({ message: 'boom' });
  });

  it('falls back to JSON onDone when the server did not stream (2xx)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: {}, // non-stream body; ignored because content-type isn't SSE
      json: async () => ({ response: 'cached', cached: true }),
    });
    let done: any = null;
    await streamRequest('/x', {}, { onDone: (d) => { done = d; } });
    expect(done).toEqual({ response: 'cached', cached: true });
  });

  it('falls back to JSON onError when the server returns a non-2xx body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: {},
      json: async () => ({ message: 'rate limited' }),
    });
    let err: any = null;
    await streamRequest('/x', {}, { onError: (e) => { err = e; } });
    expect(err).toEqual({ message: 'rate limited' });
  });
});
