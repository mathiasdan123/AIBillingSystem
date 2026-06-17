import { QueryClient, QueryCache, QueryFunction } from "@tanstack/react-query";
import { supabase } from "./supabase";

// API version header — signals to the server which API version the client expects
const API_VERSION_ACCEPT = "application/vnd.therapybill.v1+json";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Get auth headers from Supabase session
async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    Accept: API_VERSION_ACCEPT,
  };

  // If Supabase isn't configured, skip auth headers (demo/dev mode)
  if (!supabase) {
    return headers;
  }

  const { data: { session } } = await supabase.auth.getSession();

  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  return headers;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const authHeaders = await getAuthHeaders();

  const res = await fetch(url, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...authHeaders,
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

export interface SSEHandlers {
  /** Called for each streamed text chunk (Server-Sent `event: delta`). */
  onDelta?: (text: string) => void;
  /** Called once with the final payload (`event: done`, or a plain-JSON 2xx body if the server didn't stream). */
  onDone?: (data: any) => void;
  /** Called on `event: error`, or a non-2xx JSON body if the server didn't stream. */
  onError?: (data: any) => void;
}

/**
 * POST a request that opts into a Server-Sent-Events response (adds
 * `stream: true` to the body). Text chunks arrive via onDelta as the model
 * generates; the terminal payload via onDone.
 *
 * Graceful fallback: the server may legitimately answer the same endpoint with
 * plain JSON instead of a stream (cache hit, rate limit, validation/auth error,
 * or no API key). When the response isn't `text/event-stream`, the JSON body is
 * routed to onDone (2xx) or onError (non-2xx) so callers need only one path.
 */
export async function streamRequest(
  url: string,
  data: Record<string, unknown>,
  handlers: SSEHandlers,
): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ ...data, stream: true }),
    credentials: "include",
  });

  const ctype = res.headers.get("content-type") || "";
  if (!res.body || !ctype.includes("text/event-stream")) {
    // Server didn't stream — parse the JSON body and route by status.
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = { message: res.statusText || `${res.status}` };
    }
    if (res.ok) handlers.onDone?.(body);
    else handlers.onError?.(body ?? { message: `${res.status}` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    // SSE frames are separated by a blank line ("\n\n").
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = "message";
      let dataStr = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataStr += line.slice(5).trimStart();
      }
      if (!dataStr) continue;
      let payload: any;
      try {
        payload = JSON.parse(dataStr);
      } catch {
        payload = dataStr;
      }
      if (event === "delta") handlers.onDelta?.(payload?.text ?? "");
      else if (event === "done") handlers.onDone?.(payload);
      else if (event === "error") handlers.onError?.(payload);
    }
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";

// A queryKey segment is "missing" if it would produce a meaningless URL when
// joined — `null`, `undefined`, or `NaN`. Returning these to the server hits
// routes like `/api/appointments/NaN` and used to surface as Postgres 500s
// (now 400s after PR #96). Callers should gate the query with `enabled:` —
// this guard catches the cases where they forgot.
function findMissingSegment(queryKey: readonly unknown[]): number {
  for (let i = 1; i < queryKey.length; i++) {
    const v = queryKey[i];
    if (v === null || v === undefined) return i;
    if (typeof v === "number" && Number.isNaN(v)) return i;
  }
  return -1;
}

export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const badIdx = findMissingSegment(queryKey);
    if (badIdx !== -1) {
      throw new Error(
        `queryKey segment ${badIdx} is ${String(queryKey[badIdx])} — ` +
          `the calling component should gate this query with \`enabled:\`. ` +
          `Full queryKey: ${JSON.stringify(queryKey)}`,
      );
    }

    const authHeaders = await getAuthHeaders();

    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers: authHeaders,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// Retry server errors (500+) with backoff, but not client errors (4xx)
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 3) return false;
  if (error instanceof Error) {
    const status = parseInt(error.message, 10);
    if (status >= 400 && status < 500) return false;
  }
  return true;
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const msg = error instanceof Error ? error.message : String(error);
      // MFA_SETUP_REQUIRED is a 403, but it's NOT "session expired" — the
      // session is fine, the user just hasn't enabled MFA yet. The App-level
      // gate (App.tsx → needsMfaSetup) handles routing them to the setup
      // page, so we don't need to surface anything here.
      if (msg.includes('MFA_SETUP_REQUIRED')) return;
      if (msg.includes('401') || msg.includes('403')) {
        // Dispatch a custom event that the Toaster/App can listen for
        window.dispatchEvent(new CustomEvent('auth-error', {
          detail: { message: 'Session expired, please log in again', status: msg },
        }));
      }
    },
  }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: shouldRetry,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
    },
    mutations: {
      retry: shouldRetry,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
    },
  },
});
