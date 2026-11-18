/**
 * Revenue at Risk work queue actions (QA sweep 2026-11-18): the default view
 * asks the server for the OPEN slice only (completed and snoozed items never
 * appear there), due dates render as the stored calendar day, and Done /
 * Snooze / Reopen call the follow-up routes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'biller-a', practiceId: 1, role: 'billing' }, isAuthenticated: true, isLoading: false, isAdmin: false, hasFinancialAccess: true }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  apiRequest: (...args: any[]) => mocks.apiRequest(...args),
}));
vi.mock('wouter', () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
  useLocation: () => ['/revenue-at-risk', vi.fn()],
}));

import RevenueAtRisk from '../pages/revenue-at-risk';

const base = {
  atRisk: { deniedAwaitingAppeal: 300, aging61Plus: 0, total: 300 },
  recovered: { last90Days: 0, appealsWon: 0, successRate: 0 },
  appeals: { pendingSubmission: 1, pastDeadline: 0 },
  followUps: { total: 3, byPriority: { high: 1 } },
};

const item = (followUpId: number, extra: Record<string, unknown> = {}) => ({
  id: `followup-${followUpId}`,
  kind: 'follow_up',
  followUpId,
  followUpType: 'denial_appeal',
  claimId: 100 + followUpId,
  claimNumber: `DEMO-2-${1000 + followUpId}`,
  patientName: `Patient ${followUpId}`,
  amount: 300,
  priority: 'high',
  dueDate: '2027-01-17T00:00:00.000Z',
  notes: null,
  appealId: 5,
  status: 'pending',
  snoozedUntil: null,
  completedAt: null,
  ...extra,
});

// Every slice the server can return, keyed by the ?queue= the page sends.
const slices: Record<string, any[]> = {
  '?queue=open': [item(1)],
  '?queue=snoozed': [item(2, { snoozedUntil: '2026-11-21T05:00:00.000Z' })],
  '?queue=completed': [item(3, { status: 'completed', completedAt: '2026-11-18T15:00:00.000Z' })],
};
const requested: string[] = [];

function renderPage() {
  requested.length = 0;
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        queryFn: async ({ queryKey }) => {
          const [, q] = queryKey as string[];
          requested.push(q);
          return { ...base, actionQueue: slices[q] ?? [] };
        },
      },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RevenueAtRisk />
    </QueryClientProvider>,
  );
}

const jsonResponse = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

describe('Revenue at Risk work queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiRequest.mockResolvedValue(jsonResponse({ id: 1, snoozedUntil: '2026-11-21T05:00:00.000Z' }));
  });

  it('shows only the open slice by default: completed and snoozed items are not listed', async () => {
    renderPage();
    await screen.findByTestId('queue-item-1');
    expect(requested).toEqual(['?queue=open']);
    expect(screen.queryByTestId('queue-item-2')).toBeNull();
    expect(screen.queryByTestId('queue-item-3')).toBeNull();
    expect(screen.getByTestId('queue-view-open')).toHaveAttribute('aria-selected', 'true');
  });

  it('renders the due date as the stored calendar day (2027-01-17 is Jan 17, never Jan 16)', async () => {
    renderPage();
    const due = await screen.findByTestId('due-date-1');
    expect(due).toHaveTextContent('due Jan 17, 2027');
    expect(due).not.toHaveTextContent('Jan 16');
  });

  it('Done posts to /complete; the Completed view shows the item with Reopen', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('complete-1'));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('POST', '/api/follow-ups/1/complete'));

    fireEvent.click(screen.getByTestId('queue-view-completed'));
    const done = await screen.findByTestId('queue-item-3');
    expect(requested).toContain('?queue=completed');
    expect(done).toHaveTextContent('Completed Nov 18, 2026');
    fireEvent.click(screen.getByTestId('reopen-3'));
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith('PATCH', '/api/follow-ups/3', { status: 'pending' }),
    );
  });

  it('Snooze presets post days; the Snoozed view shows the until date and Unsnooze clears it', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('snooze-1'));
    fireEvent.click(await screen.findByTestId('snooze-1-3d'));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('POST', '/api/follow-ups/1/snooze', { days: 3 }));

    fireEvent.click(screen.getByTestId('queue-view-snoozed'));
    const snoozed = await screen.findByTestId('queue-item-2');
    expect(snoozed).toHaveTextContent('Snoozed until Nov 21, 2026');
    fireEvent.click(screen.getByTestId('unsnooze-2'));
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith('PATCH', '/api/follow-ups/2', { snoozedUntil: null }),
    );
  });

  it('editing the due date PATCHes a YYYY-MM-DD value', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('due-date-1'));
    const input = screen.getByTestId('due-date-input-1') as HTMLInputElement;
    expect(input.value).toBe('2027-01-17');
    fireEvent.change(input, { target: { value: '2027-01-24' } });
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith('PATCH', '/api/follow-ups/1', { dueDate: '2027-01-24' }),
    );
  });
});
