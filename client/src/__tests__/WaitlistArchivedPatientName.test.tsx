/**
 * QA 2026-11-18 (follow-up to #474): while a patient is archived, their
 * existing waitlist entry read "Patient #1" because the page resolved names
 * from the default patient list, which excludes archived patients since
 * #472. The list used for name lookups must include archived patients; the
 * Add to Waitlist picker must still leave them out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));

import WaitlistPage from '../pages/waitlist';

const ARCHIVED_AVA = { id: 1, firstName: 'Ava', lastName: 'Sample', practiceId: 1, archivedAt: '2026-11-18T15:00:00.000Z' };
const ACTIVE_LIAM = { id: 2, firstName: 'Liam', lastName: 'Demo', practiceId: 1, archivedAt: null };

const AVA_ENTRY = {
  id: 1,
  practiceId: 1,
  patientId: 1,
  preferredDays: ['monday'],
  priority: 0,
  status: 'waiting',
  createdAt: '2026-11-10T14:00:00.000Z',
  updatedAt: '2026-11-10T14:00:00.000Z',
};

const STATS = {
  totalWaiting: 1, notified: 0, scheduled: 0, expired: 0, highPriority: 0,
  averageWaitDays: 8, offered: 0, fillRate: 0, filledThisMonth: 0,
};

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

function renderWaitlist() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        queryFn: async ({ queryKey }) => {
          const res = await mockApiRequest('GET', (queryKey as string[]).join(''));
          return res.json();
        },
      },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <WaitlistPage />
    </QueryClientProvider>,
  );
}

describe('Waitlist: patient name for an archived patient', () => {
  const patientListRequests: string[] = [];

  beforeEach(() => {
    patientListRequests.length = 0;
    // cmdk scrolls the highlighted item into view; jsdom has no layout.
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith('/api/patients')) {
        patientListRequests.push(url);
        // Mirrors the server: archived patients come back only when asked for.
        return jsonResponse(url.includes('archived=include') ? [ARCHIVED_AVA, ACTIVE_LIAM] : [ACTIVE_LIAM]);
      }
      if (url.startsWith('/api/waitlist/stats')) return jsonResponse(STATS);
      if (url.startsWith('/api/waitlist')) return jsonResponse([AVA_ENTRY]);
      return jsonResponse([]);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('asks for the patient list including archived patients', async () => {
    renderWaitlist();
    await screen.findByText('Ava Sample');
    expect(patientListRequests.some((u) => u.includes('archived=include'))).toBe(true);
  });

  it("shows the archived patient's real name on the entry, not \"Patient #1\"", async () => {
    renderWaitlist();
    expect(await screen.findByText('Ava Sample')).toBeInTheDocument();
    expect(screen.queryByText(/Patient #1/)).toBeNull();
  });

  it('the Add to Waitlist patient picker still leaves the archived patient out', async () => {
    renderWaitlist();
    await screen.findByText('Ava Sample');

    fireEvent.click(screen.getByRole('button', { name: /add to waitlist/i }));
    // A combobox takes no accessible name from its content, so find the
    // trigger by its placeholder text.
    fireEvent.click((await screen.findByText('Search or type patient name...')).closest('button')!);

    const list = await screen.findByRole('listbox');
    expect(within(list).getByText('Liam Demo')).toBeInTheDocument();
    expect(within(list).queryByText('Ava Sample')).toBeNull();
  });
});
