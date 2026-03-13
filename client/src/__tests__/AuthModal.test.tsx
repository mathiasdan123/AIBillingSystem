import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Hoisted mocks
const mocks = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockSetLocation: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.mockToast }),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/', mocks.mockSetLocation],
}));

// Mock Dialog for jsdom
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => open ? <div data-testid="auth-dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

import { AuthModal } from '@/components/AuthModal';

function renderAuthModal(open = true, onOpenChange = vi.fn()) {
  return render(<AuthModal open={open} onOpenChange={onOpenChange} />);
}

describe('AuthModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders nothing when open is false', () => {
    const { container } = renderAuthModal(false);
    expect(container.innerHTML).toBe('');
  });

  it('renders sign-in form by default', () => {
    renderAuthModal();
    // Title in h2 + submit button both say "Sign In"
    const signInElements = screen.getAllByText('Sign In');
    expect(signInElements.length).toBe(2); // h2 title + submit button
    expect(screen.getByText('Enter your credentials to access your account.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('renders sign-in submit button', () => {
    renderAuthModal();
    const submitButton = screen.getByRole('button', { name: 'Sign In' });
    expect(submitButton).toHaveAttribute('type', 'submit');
  });

  it('switches to sign-up mode when clicking Sign up link', async () => {
    renderAuthModal();
    const signUpLink = screen.getByRole('button', { name: /sign up/i });
    fireEvent.click(signUpLink);

    await waitFor(() => {
      // "Create Account" appears in both title and submit button
      const createAccountElements = screen.getAllByText('Create Account');
      expect(createAccountElements.length).toBe(2);
      expect(screen.getByText('Fill in your details to create a new account.')).toBeInTheDocument();
      expect(screen.getByLabelText('First Name')).toBeInTheDocument();
      expect(screen.getByLabelText('Last Name')).toBeInTheDocument();
    });
  });

  it('switches to SSO mode when clicking SSO button', async () => {
    renderAuthModal();
    const ssoButton = screen.getByRole('button', { name: /sign in with sso/i });
    fireEvent.click(ssoButton);

    await waitFor(() => {
      expect(screen.getByText('Sign in with SSO')).toBeInTheDocument();
      expect(screen.getByLabelText('Practice ID')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /continue with sso/i })).toBeInTheDocument();
    });
  });

  it('shows password requirements in sign-up mode when password is entered', async () => {
    renderAuthModal();
    // Switch to sign-up
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    const passwordInput = screen.getByLabelText('Password');
    fireEvent.change(passwordInput, { target: { value: 'weak' } });

    await waitFor(() => {
      expect(screen.getByText('Password requirements:')).toBeInTheDocument();
      expect(screen.getByText('At least 12 characters')).toBeInTheDocument();
      expect(screen.getByText('One uppercase letter')).toBeInTheDocument();
      expect(screen.getByText('One lowercase letter')).toBeInTheDocument();
      expect(screen.getByText('One number')).toBeInTheDocument();
      expect(screen.getByText('One special character')).toBeInTheDocument();
    });
  });

  it('disables Create Account button when password is invalid in sign-up mode', async () => {
    renderAuthModal();
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    const passwordInput = screen.getByLabelText('Password');
    fireEvent.change(passwordInput, { target: { value: 'short' } });

    const submitButton = screen.getByRole('button', { name: 'Create Account' });
    expect(submitButton).toBeDisabled();
  });
});
