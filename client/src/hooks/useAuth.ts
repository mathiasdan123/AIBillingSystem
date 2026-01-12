import { useQuery } from "@tanstack/react-query";

export function useAuth() {
  const { data: user, isLoading, error, isFetched } = useQuery({
    queryKey: ['/api/auth/user'],
    retry: false,
    staleTime: 0, // Always fetch fresh auth state
    gcTime: 0, // Don't cache auth data
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // Only authenticated if we have user data (not null) and no error
  // User is null when server returns 401
  const isAuthenticated = isFetched && user != null && !error;

  return {
    user,
    isLoading,
    isAuthenticated,
  };
}
