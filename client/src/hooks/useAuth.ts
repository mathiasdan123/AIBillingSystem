import { useQuery, useQueryClient } from "@tanstack/react-query";

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string | null;
  role?: 'admin' | 'therapist';
  practiceId?: number;
}

export function useAuth() {
  // SECURITY: Always use the authenticated endpoint
  // Dev mode authentication is handled server-side in replitAuth.ts based on NODE_ENV
  // Never allow client-side bypass of authentication
  const endpoint = '/api/auth/user';

  const { data: user, isLoading, error, isFetched } = useQuery<User>({
    queryKey: [endpoint],
    retry: false,
    staleTime: 0, // Always fetch fresh auth state
    gcTime: 0, // Don't cache auth data
    refetchOnMount: true,
    refetchOnWindowFocus: true,
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
    currentRole: effectiveRole || 'therapist',
    // Expose actual role (ignoring demo override) for certain checks
    actualRole: user?.role || 'therapist',
  };
}

// Helper to get auth headers for fetch requests (cookie-based auth, returns empty)
export async function getAuthHeaders(): Promise<HeadersInit> {
  return {};
}
