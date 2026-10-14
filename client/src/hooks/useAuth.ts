import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string | null;
  role?: 'admin' | 'billing' | 'therapist';
  practiceId?: number;
  // True when the user is authenticated but has not yet enabled MFA.
  // Set by GET /api/auth/user (server/routes/auth.ts). Used to gate access
  // to PHI routes — the server-side mfaSetupRequired middleware also
  // enforces this, but the client gate prevents a 13-rejection storm
  // every time a no-MFA user lands on the dashboard.
  mfaRequired?: boolean;
  // True when MFA IS enabled on the account, but this particular session
  // hasn't passed a challenge yet (fresh login, or the 15-min re-verify
  // window lapsed). Distinct from mfaRequired above. Without this, every
  // PHI query 403s with MFA_VERIFICATION_REQUIRED and nothing routes the
  // user to /mfa-challenge to clear it.
  mfaChallengeRequired?: boolean;
}

export function useAuth() {
  // SECURITY: Always use the authenticated endpoint
  // Dev mode authentication is handled server-side in replitAuth.ts based on NODE_ENV
  // Never allow client-side bypass of authentication
  const endpoint = '/api/auth/user';

  const { data: user, isLoading, error, isFetched } = useQuery<User>({
    queryKey: [endpoint],
    // Unlike every other query, a 401 here is not an error — it is the normal
    // answer for an anonymous visitor. Throwing would fire the global
    // "session expired" toast on public pages.
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    // One cache entry shared by every useAuth() caller (Router, the sidebar,
    // and most pages). This used to be staleTime: 0 / gcTime: 0 ("always
    // fetch fresh auth state"), which made every page-component mount refetch
    // /api/auth/user — two requests on first load (Router mounts → fetch;
    // page mounts once loading clears → refetch) and one more on EVERY route
    // change (2026-10-14 audit). Auth state doesn't need per-navigation
    // freshness: every flow that changes it already forces a refetch
    // regardless of staleTime — login/logout and the MFA challenge do a full
    // page reload, MFA setup invalidates ['/api/auth/user'], and the global
    // 401/403 handlers in queryClient.ts invalidate + hard-redirect when the
    // server says the session/MFA window lapsed mid-use.
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: true, // refetches only when older than staleTime
    refetchOnWindowFocus: true, // stale tabs re-validate auth on refocus
  });

  // Only authenticated if we have user data (not null) and no error
  const isAuthenticated = isFetched && user != null && !error;

  // Use actual user role - no client-side overrides allowed
  const effectiveRole = user?.role;

  return {
    user,
    isLoading,
    isAuthenticated,
    isAdmin: effectiveRole === 'admin',
    // Practice financials (fee schedules, claim charges, ERAs, revenue) are
    // admin/billing only. Mirrors the server-side requireFinancialRole gate —
    // this just keeps therapist users from seeing nav/tabs that would 403.
    hasFinancialAccess: effectiveRole === 'admin' || effectiveRole === 'billing',
    currentRole: effectiveRole || 'therapist',
    // Expose actual role (ignoring demo override) for certain checks
    actualRole: user?.role || 'therapist',
    // True when authenticated but no MFA yet — gate PHI routes on this
    needsMfaSetup: isAuthenticated && user?.mfaRequired === true,
    // True when MFA is enabled but this session hasn't cleared a challenge —
    // gate PHI routes on this too, routing to /mfa-challenge instead of
    // silently 403ing on every query.
    needsMfaChallenge: isAuthenticated && user?.mfaChallengeRequired === true,
  };
}

// Helper to get auth headers for fetch requests (cookie-based auth, returns empty)
export async function getAuthHeaders(): Promise<HeadersInit> {
  return {};
}
