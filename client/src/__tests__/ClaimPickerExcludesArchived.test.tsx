/**
 * #474 made the Claims page load its patient list with archived patients
 * included (so existing claims keep their names) and filter them back out
 * of the New Claim picker (`pickablePatients`). This pins the second half:
 * an archived patient never appears as a choice for a new claim, while an
 * active one does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', practiceId: 1, role: 'admin' },
    isAuthenticated: true,
    isLoading: false,
    isAdmin: true,
    hasFinancialAccess: true,
  }),
}));
vi.mock('@/lib/authUtils', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  isUnauthorizedError: vi.fn(() => false),
}));
const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));

import Claims from '../pages/claims';

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const ARCHIVED_AVA = { id: 1, firstName: 'Ava', lastName: 'Sample', practiceId: 1, archivedAt: '2026-11-18T15:00:00.000Z' };
const ACTIVE_LIAM = { id: 2, firstName: 'Liam', lastName: 'Demo', practiceId: 1, archivedAt: null };

function renderClaims() {
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
      <Claims />
    </QueryClientProvider>,
  );
}

describe('New Claim patient picker', () => {
  beforeEach(() => {
    // cmdk scrolls the selected item into view on mount; jsdom has no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith('/api/patients?')) {
        return jsonResponse(url.includes('archived=include') ? [ARCHIVED_AVA, ACTIVE_LIAM] : [ACTIVE_LIAM]);
      }
      if (url.startsWith('/api/claims/summary')) {
        return jsonResponse({ total: 0, draft: 0, submitted: 0, paid: 0, denied: 0, held: 0, totalAmount: 0, paidAmount: 0, pendingAmount: 0 });
      }
      if (url.startsWith('/api/claims?')) {
        return jsonResponse({ data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0, hasMore: false } });
      }
      if (url.startsWith('/api/practices/')) return jsonResponse({ id: 1, name: 'Demo Practice' });
      if (url.startsWith('/api/insurances')) return jsonResponse([{ id: 1, name: 'Aetna' }]);
      return jsonResponse([]);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('lists active patients and never an archived one', async () => {
    renderClaims();
    // Open the New Claim dialog, then the patient combobox inside it.
    fireEvent.click(await screen.findByRole('button', { name: /new claim/i }));
    const dialog = await screen.findByRole('dialog');
    // The trigger is role=combobox, whose accessible name is not its text, so
    // find it by the visible placeholder.
    fireEvent.click(within(dialog).getByText('Search patient...'));

    const liam = await screen.findByText('Liam Demo');
    expect(liam).toBeInTheDocument();
    expect(screen.queryByText('Ava Sample')).toBeNull();
    // Sanity: the page did load the inclusive list (so the absence above is
    // the picker's filter, not a missing patient).
    expect(mockApiRequest.mock.calls.some(([, u]) => String(u).includes('archived=include'))).toBe(true);
  });
});
