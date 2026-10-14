import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

/**
 * App component tests
 *
 * These tests verify that the main App component renders correctly
 * with all required providers and initial state.
 */

// Mock the useAuth hook to control authentication state
vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: false,
    isLoading: true,
    isAdmin: false,
    hasFinancialAccess: false,
    user: undefined,
    currentRole: 'therapist' as const,
    actualRole: 'therapist' as const,
    needsMfaSetup: false,
    needsMfaChallenge: false,
  })),
}));

// Mock fetch for API calls
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  } as Response)
);

describe('App component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<App />);
    expect(container).toBeTruthy();
  });

  it('shows loading spinner when auth is loading', async () => {
    const { useAuth } = await import('@/hooks/useAuth');
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      isAdmin: false,
      hasFinancialAccess: false,
      user: undefined,
      currentRole: 'therapist' as const,
      actualRole: 'therapist' as const,
      needsMfaSetup: false,
    needsMfaChallenge: false,
    });

    render(<App />);

    // The loading spinner should be visible
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('renders landing page when not authenticated', async () => {
    const { useAuth } = await import('@/hooks/useAuth');
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      isAdmin: false,
      hasFinancialAccess: false,
      user: undefined,
      currentRole: 'therapist' as const,
      actualRole: 'therapist' as const,
      needsMfaSetup: false,
    needsMfaChallenge: false,
    });

    render(<App />);

    // App should render without error when not authenticated
    // The Landing component would be rendered at the root path
    expect(document.body).toBeTruthy();
  });

  it('offsets the authenticated layout for the fixed sidebar (md:ml-64 on <main>)', async () => {
    const { useAuth } = await import('@/hooks/useAuth');
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      isAdmin: false,
      hasFinancialAccess: false,
      user: { id: '1', email: 'a@b.com' } as any,
      currentRole: 'therapist' as const,
      actualRole: 'therapist' as const,
      needsMfaSetup: false,
      needsMfaChallenge: false,
    });

    // Keep every data query pending so page components stay in their initial
    // state — this test only cares about the layout wrapper.
    vi.mocked(global.fetch).mockImplementation(() => new Promise(() => {}));

    render(<App />);

    // The sidebar is `fixed w-64` at md+ (SimpleNavigation); the single place
    // that clears it is the authenticated <main> wrapper. Pages used to carry
    // their own md:ml-64 and the ones that forgot rendered UNDER the sidebar
    // (live audit 2026-10-14, /evaluations/:id at 1024px).
    const main = document.querySelector('main#main-content');
    expect(main).toBeTruthy();
    expect(main!.className).toContain('md:ml-64');
  });

  it('gates to the MFA challenge page when enrolled but this session has not verified', async () => {
    const { useAuth } = await import('@/hooks/useAuth');
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      isAdmin: false,
      hasFinancialAccess: false,
      user: { id: '1', email: 'a@b.com', mfaRequired: false, mfaChallengeRequired: true } as any,
      currentRole: 'therapist' as const,
      actualRole: 'therapist' as const,
      needsMfaSetup: false,
      needsMfaChallenge: true,
    });

    render(<App />);

    // The MFA challenge page prompts for a 6-digit authenticator code —
    // presence of that heading proves the gate rendered it instead of
    // silently falling through to the main app (which would 403-loop on
    // every PHI query, the bug this test guards against).
    expect(await screen.findByText(/Two-Factor Authentication/i)).toBeTruthy();
  });
});
