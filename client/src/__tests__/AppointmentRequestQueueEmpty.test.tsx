import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppointmentRequestQueue from '@/components/AppointmentRequestQueue';

// The calendar page used to show a large "Pending Appointment Requests" card
// even when nothing was pending. The card should only take space when there is
// something to review.

function renderQueue() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <div data-testid="host">
        <AppointmentRequestQueue practiceId={1} />
      </div>
    </QueryClientProvider>,
  );
}

function mockFetch(requests: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes('appointment-requests') ? requests : []),
    })),
  );
}

describe('AppointmentRequestQueue empty state', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing when there are no pending requests', async () => {
    mockFetch([]);
    renderQueue();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    // Give the query a chance to resolve, then confirm the host stayed empty.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('host').textContent).toBe('');
    expect(screen.queryByText('Pending Appointment Requests')).toBeNull();
  });

  it('shows the card with a count when a request is pending', async () => {
    mockFetch([
      {
        id: 1,
        practiceId: 1,
        patientName: 'Pat Example',
        status: 'pending_approval',
        requestedDate: '2026-11-25',
        requestedStartTime: '10:00',
        requestedEndTime: '11:00',
        createdAt: new Date().toISOString(),
      },
    ]);
    renderQueue();
    expect(await screen.findByText('Pending Appointment Requests')).toBeTruthy();
  });
});
