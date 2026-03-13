import { QueryClient, QueryFunction } from "@tanstack/react-query";
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

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
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

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: 1,
    },
    mutations: {
      retry: false,
    },
  },
});
