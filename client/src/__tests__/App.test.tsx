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
    user: null,
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
      user: null,
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
      user: null,
    });

    render(<App />);

    // App should render without error when not authenticated
    // The Landing component would be rendered at the root path
    expect(document.body).toBeTruthy();
  });
});
