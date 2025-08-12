import { useQuery } from "@tanstack/react-query";

export function useAuth() {
  // Check if we're using development bypass
  const isDevelopment = import.meta.env.DEV;
  const hasDevBypass = isDevelopment && localStorage.getItem('dev-bypass') === 'true';
  
  // Use dev endpoint if bypassing, otherwise use regular auth
  const endpoint = hasDevBypass ? '/api/dev-user' : '/api/auth/user';
  
  const { data: user, isLoading } = useQuery({
    queryKey: [endpoint],
    retry: false,
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
  };
}
