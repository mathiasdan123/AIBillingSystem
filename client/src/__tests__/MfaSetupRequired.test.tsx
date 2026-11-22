/**
 * The MFA setup page sits behind the auth rate limiter (5 requests / 15 min).
 *
 * Live failure this guards (2026-11-04, admin recovering from a lost
 * authenticator): both mutations threw text errors, which the global
 * shouldRetry does not recognise as 4xx, so one click fired four requests.
 * A 429 was then shown as "Invalid code", the natural response was to click
 * again, and every click restarted the 15-minute lockout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import MfaSetupRequired, { MFA_RATE_LIMITED_MESSAGE } from '@/pages/mfa-setup-required';

vi.mock('@/hooks/useAuth', () => ({ getAuthHeaders: async () => ({}) }));
vi.mock('@/lib/clearSensitiveStorage', () => ({ clearSensitiveStorage: vi.fn() }));
vi.mock('@/components/MfaEnrollmentSecret', () => ({
  default: ({ uri }: { uri: string }) => <div data-testid="qr">{uri}</div>,
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MfaSetupRequired />
    </QueryClientProvider>,
  );
}

describe('MfaSetupRequired rate-limit handling', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    queryClient.clear();
  });

  it('makes exactly one setup request on a 429 and tells the user to wait', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { message: 'Too many authentication attempts.' }));
    renderPage();

    fireEvent.click(screen.getByTestId('button-start-mfa-setup'));

    await waitFor(() => expect(screen.getByText(MFA_RATE_LIMITED_MESSAGE)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The button is still there (no QR step), but nothing re-fired behind the scenes.
    expect(screen.getByTestId('button-start-mfa-setup')).toBeInTheDocument();
  });

  it('makes exactly one verify request on a wrong code and shows the server message', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { uri: 'otpauth://totp/x?secret=ABC', backupCodes: ['a1b2c3d4'] }))
      .mockResolvedValueOnce(jsonResponse(400, { message: 'Invalid token' }));
    renderPage();

    fireEvent.click(screen.getByTestId('button-start-mfa-setup'));
    await screen.findByTestId('qr');

    fireEvent.change(screen.getByTestId('input-mfa-token'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('button-verify-mfa'));

    await waitFor(() => expect(screen.getByText('Invalid token')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 setup + 1 verify, no retries
  });

  it('distinguishes a rate-limited verify from a wrong code', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { uri: 'otpauth://totp/x?secret=ABC', backupCodes: ['a1b2c3d4'] }))
      .mockResolvedValueOnce(jsonResponse(429, { message: 'Too many authentication attempts.' }));
    renderPage();

    fireEvent.click(screen.getByTestId('button-start-mfa-setup'));
    await screen.findByTestId('qr');
    fireEvent.change(screen.getByTestId('input-mfa-token'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('button-verify-mfa'));

    await waitFor(() => expect(screen.getByText(MFA_RATE_LIMITED_MESSAGE)).toBeInTheDocument());
    expect(screen.queryByText(/invalid code/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
