import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';

/**
 * Blanche's conversation history is ENCRYPTED PHI that the server decrypts
 * on every GET /api/ai/conversation. Most page views never open the panel,
 * so the fetch must be lazy — only when the panel is actually opened —
 * never on mount (2026-10-14 audit: it fired on every page load of every
 * user).
 */

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/hooks/use-toast', () => ({ useToast: mocks.useToast }));

import AiBillingAssistant from '@/components/AiBillingAssistant';
// The app's real queryClient: carries the default queryFn that Blanche's
// onboarding-status query relies on (routed through the mocked global fetch).
import { queryClient } from '@/lib/queryClient';

const fetchedUrls = () =>
  (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));

function mockFetchByUrl() {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
    if (url.includes('/api/onboarding/status')) {
      // Completed setup → no greeting popup, no proactive auto-open, so the
      // panel only opens when the test clicks the bubble.
      return json({ step: 5, completed: true });
    }
    if (url.includes('/api/ai/conversation')) {
      return json({
        messages: [{ role: 'assistant', content: 'hello from the server history', timestamp: 1 }],
      });
    }
    if (url.includes('/api/ai/assistant/status')) {
      return json({ available: true, message: '' });
    }
    return json({});
  }) as unknown as typeof fetch;
}

function renderBlanche() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AiBillingAssistant />
    </QueryClientProvider>,
  );
}

describe('AiBillingAssistant conversation loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    localStorage.clear();
    sessionStorage.clear();
    // jsdom has no scrollIntoView; the panel scrolls to the latest message.
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockFetchByUrl();
    mocks.useAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'u1', email: 'u1@example.com' },
      isAdmin: false,
      hasFinancialAccess: false,
      currentRole: 'therapist',
      actualRole: 'therapist',
      needsMfaSetup: false,
      needsMfaChallenge: false,
    });
  });

  it('does NOT fetch /api/ai/conversation while the panel is closed', async () => {
    renderBlanche();

    // Wait for mount-time effects/queries to settle (onboarding status fires).
    await waitFor(() =>
      expect(fetchedUrls().some((u) => u.includes('/api/onboarding/status'))).toBe(true),
    );

    expect(fetchedUrls().some((u) => u.includes('/api/ai/conversation'))).toBe(false);
  });

  it('fetches the conversation history when the panel is opened', async () => {
    renderBlanche();

    fireEvent.click(
      screen.getByRole('button', { name: /Open Blanche, your AI billing assistant/i }),
    );

    await waitFor(() =>
      expect(fetchedUrls().some((u) => u.includes('/api/ai/conversation'))).toBe(true),
    );

    // The server-persisted history is rendered into the chat.
    expect(await screen.findByText('hello from the server history')).toBeTruthy();
  });

  it('fetches the history only once across close/re-open for the same user', async () => {
    renderBlanche();

    const openBubble = () =>
      fireEvent.click(
        screen.getByRole('button', { name: /Open Blanche, your AI billing assistant/i }),
      );

    openBubble();
    await waitFor(() =>
      expect(
        fetchedUrls().filter((u) => u.includes('/api/ai/conversation')),
      ).toHaveLength(1),
    );

    // Close, then re-open — history is already loaded for this user.
    fireEvent.click(screen.getByRole('button', { name: /Close chat/i }));
    openBubble();
    await waitFor(() => expect(screen.queryByText('hello from the server history')).toBeTruthy());

    expect(
      fetchedUrls().filter((u) => u.includes('/api/ai/conversation')),
    ).toHaveLength(1);
  });
});
