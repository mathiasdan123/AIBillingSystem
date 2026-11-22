/**
 * A failed load must never be presented as "you have no data".
 *
 * Live failure this guards (2026-08-24, during a customer demo): the global
 * queryFn used on401:"returnNull", so an expired session resolved the query
 * with null. The page saw "no rows" and rendered "Welcome! Add your first
 * patient" — telling the user their patient roster was empty while their real
 * patients were untouched on the server. No error, no toast, nothing to act
 * on. Auth failure and emptiness must look different.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import QueryErrorState from '@/components/QueryErrorState';

vi.mock('@/lib/authUtils', () => ({
  isUnauthorizedError: (e: Error) => /^(401|403)/.test(e.message),
}));

describe('QueryErrorState', () => {
  it('tells the user their data is safe when the session expired', () => {
    render(<QueryErrorState error={new Error('401: Unauthorized')} what="patients" />);

    expect(screen.getByText(/session expired/i)).toBeInTheDocument();
    // The reassurance matters: the whole failure mode was implying data loss.
    expect(screen.getByText(/are safe/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument();
  });

  it('never says the roster is empty on a non-auth failure', () => {
    render(<QueryErrorState error={new Error('500: Internal Server Error')} what="patients" />);

    expect(screen.getByText(/couldn't load patients/i)).toBeInTheDocument();
    expect(screen.getByText(/not missing data/i)).toBeInTheDocument();
    expect(screen.queryByText(/add your first patient/i)).not.toBeInTheDocument();
  });

  it('offers retry for a transient failure and surfaces the underlying message', () => {
    const onRetry = vi.fn();
    render(<QueryErrorState error={new Error('503: upstream')} what="claims" onRetry={onRetry} />);

    const retry = screen.getByRole('button', { name: /try again/i });
    retry.click();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByText(/503: upstream/)).toBeInTheDocument();
  });

  it('announces itself as an alert so it is not mistaken for ordinary content', () => {
    render(<QueryErrorState error={new Error('401: Unauthorized')} what="claims" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // Regression tests for the 2026-11-02 fix: MFA_SETUP_REQUIRED (no secret
  // exists -- never enrolled, or enrollment was reset) was previously routed
  // identically to MFA_VERIFICATION_REQUIRED (enrolled, just needs a fresh
  // code), sending a setup-required user to /mfa-challenge -- a dead end,
  // since there's no secret there to check a code against.

  it('offers a fresh-code challenge when MFA is enrolled but this session is unverified', () => {
    render(<QueryErrorState error={new Error('403: {"error":"MFA verification required","code":"MFA_VERIFICATION_REQUIRED"}')} what="patients" />);

    expect(screen.getByText(/verify your identity/i)).toBeInTheDocument();
    expect(screen.getByText(/are safe/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enter verification code/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set up two-factor/i })).not.toBeInTheDocument();
  });

  it('offers setup, not a dead-end code challenge, when no MFA secret exists yet', () => {
    render(<QueryErrorState error={new Error('403: {"error":"MFA setup required","code":"MFA_SETUP_REQUIRED"}')} what="patients" />);

    expect(screen.getByRole('heading', { name: /set up two-factor authentication/i })).toBeInTheDocument();
    expect(screen.getByText(/are safe/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set up two-factor authentication/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enter verification code/i })).not.toBeInTheDocument();
  });

  it('treats MFA_NOT_ENABLED the same as MFA_SETUP_REQUIRED (setup, not challenge)', () => {
    render(<QueryErrorState error={new Error('403: {"error":"MFA not enabled","code":"MFA_NOT_ENABLED"}')} what="claims" />);

    expect(screen.getByRole('heading', { name: /set up two-factor authentication/i })).toBeInTheDocument();
  });
});
