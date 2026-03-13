import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Hoisted mocks
const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useToast: vi.fn(() => ({ toast: vi.fn() })),
  useTranslation: vi.fn(() => ({
    t: (key: string, opts?: any) => {
      const map: Record<string, string> = {
        'dashboard.welcomeBack': `Welcome back, ${opts?.name || 'User'}`,
        'dashboard.practiceOverview': 'Practice overview',
        'dashboard.recentClaims': 'Recent Claims',
        'dashboard.latestBilling': 'Latest billing activity',
        'dashboard.recentPatients': 'Recent Patients',
        'dashboard.newlyAdded': 'Newly added patients',
        'dashboard.noClaimsYet': 'No Claims Yet',
        'dashboard.noClaimsDescription': 'Submit your first claim to get started.',
        'dashboard.createFirstClaim': 'Create First Claim',
        'dashboard.welcomeGetStarted': 'Welcome! Get Started',
        'dashboard.noPatientDescription': 'Add your first patient to begin.',
        'dashboard.addFirstPatient': 'Add First Patient',
        'dashboard.quickActions': 'Quick Actions',
        'dashboard.commonTasks': 'Common tasks',
        'dashboard.addPatient': 'Add Patient',
        'dashboard.createClaim': 'Create Claim',
        'dashboard.addExpense': 'Add Expense',
        'dashboard.viewReports': 'View Reports',
        'onboarding.bannerTitle': 'Complete your setup',
        'onboarding.bannerComplete': 'complete',
        'onboarding.continueSetup': 'Continue Setup',
        'common.viewAll': 'View All',
      };
      return map[key] || key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  })),
  useQueryResults: {} as Record<string, any>,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: mocks.useToast,
}));

vi.mock('react-i18next', () => ({
  useTranslation: mocks.useTranslation,
}));

vi.mock('@/lib/authUtils', () => ({
  isUnauthorizedError: () => false,
}));

vi.mock('wouter', () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
  useLocation: () => ['/', vi.fn()],
}));

// Mock PatientArAgingSummary to isolate dashboard tests
vi.mock('@/components/PatientArAgingSummary', () => ({
  default: () => <div data-testid="ar-aging-summary">AR Aging Summary</div>,
}));

// Mock DashboardStats
vi.mock('@/components/DashboardStats', () => ({
  default: ({ stats }: any) => (
    <div data-testid="dashboard-stats">
      <span>Claims: {stats.monthlyClaimsCount}</span>
      <span>Revenue: {stats.monthlyRevenue}</span>
    </div>
  ),
}));

// Mock skeleton
vi.mock('@/components/ui/skeleton', () => ({
  DashboardSkeleton: () => <div data-testid="dashboard-skeleton">Loading...</div>,
  Skeleton: ({ className }: any) => <div className={className} />,
}));

import Dashboard from '../pages/dashboard';

// Override useQuery to return controlled data
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (opts: any) => {
      const key = Array.isArray(opts.queryKey) ? opts.queryKey[0] : opts.queryKey;
      const result = mocks.useQueryResults[key];
      return result || { data: undefined, isLoading: false };
    },
  };
});

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAuth.mockReturnValue({
      user: { id: '1', email: 'test@test.com', firstName: 'Dan' },
      isAuthenticated: true,
      isLoading: false,
      isAdmin: false,
      currentRole: 'therapist',
      actualRole: 'therapist',
    });
    mocks.useQueryResults = {};
  });

  it('shows skeleton when auth is loading', () => {
    mocks.useAuth.mockReturnValue({
      user: undefined,
      isAuthenticated: false,
      isLoading: true,
      isAdmin: false,
      currentRole: 'therapist',
      actualRole: 'therapist',
    });
    renderDashboard();
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
  });

  it('returns null when not authenticated', () => {
    mocks.useAuth.mockReturnValue({
      user: undefined,
      isAuthenticated: false,
      isLoading: false,
      isAdmin: false,
      currentRole: 'therapist',
      actualRole: 'therapist',
    });
    const { container } = renderDashboard();
    // The component should render nothing (the redirect fires via useEffect)
    expect(container.querySelector('.p-4')).toBeNull();
  });

  it('renders welcome message with user first name', () => {
    renderDashboard();
    expect(screen.getByText('Welcome back, Dan')).toBeInTheDocument();
  });

  it('renders practice overview subtitle', () => {
    renderDashboard();
    expect(screen.getByText('Practice overview')).toBeInTheDocument();
  });

  it('renders DashboardStats when stats data is available', () => {
    mocks.useQueryResults['/api/analytics/dashboard'] = {
      data: { monthlyClaimsCount: 42, monthlyRevenue: 5000, successRate: 95, avgDaysToPayment: 14 },
      isLoading: false,
    };
    renderDashboard();
    expect(screen.getByTestId('dashboard-stats')).toBeInTheDocument();
    expect(screen.getByText('Claims: 42')).toBeInTheDocument();
  });

  it('shows onboarding banner when onboarding is not completed', () => {
    mocks.useQueryResults['/api/onboarding/status'] = {
      data: { step: 2, completed: false },
      isLoading: false,
    };
    mocks.useQueryResults['/api/onboarding/checklist'] = {
      data: { progress: 40, completedRequired: 2, totalRequired: 5 },
      isLoading: false,
    };
    renderDashboard();
    expect(screen.getByText('Complete your setup')).toBeInTheDocument();
    expect(screen.getByText('Continue Setup')).toBeInTheDocument();
    expect(screen.getByText('2/5 complete')).toBeInTheDocument();
  });

  it('does not show onboarding banner when onboarding is completed', () => {
    mocks.useQueryResults['/api/onboarding/status'] = {
      data: { step: 5, completed: true },
      isLoading: false,
    };
    renderDashboard();
    expect(screen.queryByText('Complete your setup')).not.toBeInTheDocument();
  });

  it('shows empty state cards when no claims or patients data', () => {
    mocks.useQueryResults['/api/claims'] = { data: [], isLoading: false };
    mocks.useQueryResults['/api/patients'] = { data: [], isLoading: false };
    renderDashboard();
    expect(screen.getByText('No Claims Yet')).toBeInTheDocument();
    expect(screen.getByText('Welcome! Get Started')).toBeInTheDocument();
    expect(screen.getByText('Create First Claim')).toBeInTheDocument();
    expect(screen.getByText('Add First Patient')).toBeInTheDocument();
  });

  it('renders quick actions section', () => {
    renderDashboard();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText('Add Patient')).toBeInTheDocument();
    expect(screen.getByText('Create Claim')).toBeInTheDocument();
    expect(screen.getByText('Add Expense')).toBeInTheDocument();
    expect(screen.getByText('View Reports')).toBeInTheDocument();
  });
});
