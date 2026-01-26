import { useQuery, useQueryClient } from "@tanstack/react-query";

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string | null;
  role?: 'admin' | 'therapist';
}

export function useAuth() {
  // Check if we're using development bypass
  const isDevelopment = import.meta.env.DEV;
  const hasDevBypass = isDevelopment && localStorage.getItem('dev-bypass') === 'true';

  // Use dev endpoint if bypassing, otherwise use regular auth
  const endpoint = hasDevBypass ? '/api/dev-user' : '/api/auth/user';

  const { data: user, isLoading } = useQuery<User>({
    queryKey: [endpoint],
    retry: false,
  });

  // Check for demo role override (for switching between admin/therapist during demos)
  const demoRoleOverride = localStorage.getItem('demo-role-override') as 'admin' | 'therapist' | null;
  const effectiveRole = demoRoleOverride || user?.role;

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: effectiveRole === 'admin',
    currentRole: effectiveRole || 'therapist',
  };
}

// Helper function to switch demo role
export function setDemoRole(role: 'admin' | 'therapist') {
  localStorage.setItem('demo-role-override', role);
  window.location.reload();
}

// Helper function to clear demo role override
export function clearDemoRole() {
  localStorage.removeItem('demo-role-override');
  window.location.reload();
}
