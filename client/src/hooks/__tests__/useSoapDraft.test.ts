import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const apiRequest = vi.fn();
vi.mock('@/lib/queryClient', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

import { useSoapDraft } from '../useSoapDraft';

// Build a fetch-like Response stub for apiRequest's return shape.
function ok(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

// Mirror apiRequest's "404: ..."-message contract for not-found.
function notFound(): Promise<never> {
  return Promise.reject(new Error('404: not found'));
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useSoapDraft', () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fetch when patientId is null on mount', async () => {
    renderHook(() => useSoapDraft({ patientId: null }));
    // Flush effects / any potential microtask schedule.
    await act(async () => { await Promise.resolve(); });
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('fetches draft on patientId change and calls onRestore on success', async () => {
    const draft = { id: 7, lastSavedAt: '2026-01-01T00:00:00Z', subjective: 'hi' };
    apiRequest.mockResolvedValueOnce(ok(draft));
    const onRestore = vi.fn();

    const { result } = renderHook(() => useSoapDraft({ patientId: 42, onRestore }));

    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect(apiRequest).toHaveBeenCalledWith('GET', '/api/soap-drafts?patientId=42');
    expect(onRestore).toHaveBeenCalledWith(draft);
    expect(result.current.draftId).toBe(7);
    expect(result.current.lastSavedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(result.current.error).toBeNull();
  });

  it('treats 404 as "no draft yet" without surfacing an error', async () => {
    apiRequest.mockImplementationOnce(() => notFound());
    const onRestore = vi.fn();

    const { result } = renderHook(() => useSoapDraft({ patientId: 1, onRestore }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    // Allow the rejection chain to settle.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onRestore).not.toHaveBeenCalled();
    expect(result.current.draftId).toBeNull();
    expect(result.current.lastSavedAt).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('debounces save: many rapid calls collapse into one PUT', async () => {
    apiRequest.mockImplementationOnce(() => notFound()); // initial GET
    apiRequest.mockResolvedValueOnce(ok({ id: 11, lastSavedAt: null })); // PUT

    const { result } = renderHook(() => useSoapDraft({ patientId: 5 }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    act(() => {
      result.current.save({ subjective: 'a' });
      result.current.save({ subjective: 'ab' });
      result.current.save({ subjective: 'abc' });
    });
    expect(apiRequest).toHaveBeenCalledTimes(1); // no PUT yet

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    vi.useRealTimers();

    const putCalls = apiRequest.mock.calls.filter((c) => c[0] === 'PUT');
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]).toEqual(['PUT', '/api/soap-drafts', { patientId: 5, subjective: 'abc' }]);
  });

  it('captures patientId at arming time — patient switch mid-debounce does not reroute save', async () => {
    apiRequest.mockImplementationOnce(() => notFound()); // GET p5
    apiRequest.mockImplementationOnce(() => notFound()); // GET p9
    apiRequest.mockResolvedValueOnce(ok({ id: 1, lastSavedAt: null })); // PUT

    const { result, rerender } = renderHook(
      ({ patientId }) => useSoapDraft({ patientId }),
      { initialProps: { patientId: 5 as number | null } },
    );
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    act(() => {
      result.current.save({ subjective: 'patient 5 text' });
    });

    // Switch patient while debounce is pending. Keep fake timers in place so
    // the pending setTimeout is preserved until we explicitly advance it.
    await act(async () => {
      rerender({ patientId: 9 });
      // Flush microtasks so the GET-for-9 effect dispatches.
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    vi.useRealTimers();

    expect(apiRequest.mock.calls.some((c) => c[0] === 'GET' && String(c[1]).includes('patientId=9'))).toBe(true);

    const putCalls = apiRequest.mock.calls.filter((c) => c[0] === 'PUT');
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0][2]).toMatchObject({ patientId: 5, subjective: 'patient 5 text' });
  });

  it('clear() calls DELETE and resets lastSavedAt', async () => {
    apiRequest.mockResolvedValueOnce(ok({ id: 33, lastSavedAt: '2026-01-01T00:00:00Z' }));
    apiRequest.mockResolvedValueOnce(ok({})); // DELETE

    const { result } = renderHook(() => useSoapDraft({ patientId: 8 }));
    await waitFor(() => expect(result.current.draftId).toBe(33));

    await act(async () => {
      await result.current.clear();
    });

    expect(apiRequest).toHaveBeenCalledWith('DELETE', '/api/soap-drafts/33');
    expect(result.current.draftId).toBeNull();
    expect(result.current.lastSavedAt).toBeNull();
  });

  it('unmount flushes pending save', async () => {
    apiRequest.mockImplementationOnce(() => notFound()); // GET
    apiRequest.mockResolvedValueOnce(ok({ id: 5, lastSavedAt: null })); // flushed PUT

    const { result, unmount } = renderHook(() => useSoapDraft({ patientId: 3 }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.save({ plan: 'work in progress' });
    });

    // Unmount BEFORE the debounce fires — cleanup should flush.
    await act(async () => {
      unmount();
      await Promise.resolve();
      await Promise.resolve();
    });

    const putCalls = apiRequest.mock.calls.filter((c) => c[0] === 'PUT');
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0][2]).toMatchObject({ patientId: 3, plan: 'work in progress' });
  });

  it('toggles isSaving and updates lastSavedAt through a save cycle', async () => {
    apiRequest.mockImplementationOnce(() => notFound()); // GET
    const d = deferred<Response>();
    apiRequest.mockImplementationOnce(() => d.promise); // PUT held open

    const { result } = renderHook(() => useSoapDraft({ patientId: 2 }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    act(() => {
      result.current.save({ subjective: 's' });
    });
    expect(result.current.isSaving).toBe(false);
    expect(result.current.lastSavedAt).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    vi.useRealTimers();
    expect(result.current.isSaving).toBe(true);

    await act(async () => {
      d.resolve(ok({ id: 99, lastSavedAt: null }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(result.current.draftId).toBe(99);
    expect(result.current.lastSavedAt).toBeInstanceOf(Date);
  });

  it('uses the latest onRestore even when it changes between renders (ref pattern)', async () => {
    apiRequest.mockImplementationOnce(() => notFound()); // GET (patient 1)
    const firstOnRestore = vi.fn();
    const secondOnRestore = vi.fn();

    const { rerender } = renderHook(
      ({ onRestore, patientId }: { onRestore: any; patientId: number | null }) =>
        useSoapDraft({ patientId, onRestore }),
      { initialProps: { onRestore: firstOnRestore, patientId: 1 as number | null } },
    );
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));

    apiRequest.mockResolvedValueOnce(ok({ id: 2, lastSavedAt: null }));
    rerender({ onRestore: secondOnRestore, patientId: 2 });

    await waitFor(() => expect(secondOnRestore).toHaveBeenCalledTimes(1));
    expect(firstOnRestore).not.toHaveBeenCalled();
  });
});
