/**
 * Claims > row menu > Delete draft (QA sweep 2026-11-18): clicking it froze
 * the tab with no confirmation visible, reproduced twice. The menu item
 * called window.confirm() from its click handler while Radix's DropdownMenu
 * was mid-close, and the native modal blocked the event loop with the
 * page's pointer events still locked. The confirmation is now an in-page
 * AlertDialog rendered outside the menu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const DRAFT: any = {
  id: 42,
  claimNumber: 'CLM-MWM0SNOZ-BA5HHJ',
  practiceId: 1,
  patientId: 1,
  insuranceId: 1,
  status: 'draft',
  totalAmount: '300.00',
  paidAmount: null,
  createdAt: '2026-11-18T14:00:00.000Z',
  serviceDate: '2026-11-18',
};

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

describe('Delete draft claim confirmation', () => {
  const confirmSpy = vi.fn(() => true);
  beforeEach(() => {
    vi.stubGlobal('confirm', confirmSpy);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));
    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === 'DELETE') return jsonResponse({ ok: true });
      if (url.startsWith('/api/claims/summary')) {
        return jsonResponse({ total: 1, draft: 1, submitted: 0, paid: 0, denied: 0, held: 0, totalAmount: 300, paidAmount: 0, pendingAmount: 300 });
      }
      if (url.startsWith('/api/claims?')) {
        return jsonResponse({ data: [DRAFT], pagination: { page: 1, limit: 50, total: 1, totalPages: 1, hasMore: false } });
      }
      if (url.startsWith('/api/practices/')) return jsonResponse({ id: 1, name: 'Demo Practice' });
      return jsonResponse([]);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const openDeleteDialog = async () => {
    const trigger = await screen.findByTestId('menu-trigger-claim-42');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('menu-delete-claim-42'));
    return screen.findByTestId('dialog-delete-claim');
  };

  it('opens an in-page dialog naming the claim and never calls the native confirm()', async () => {
    renderClaims();
    const dialog = await openDeleteDialog();
    expect(dialog).toHaveTextContent('Delete draft claim CLM-MWM0SNOZ-BA5HHJ?');
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('Cancel closes the dialog and sends no request', async () => {
    renderClaims();
    await openDeleteDialog();
    fireEvent.click(screen.getByTestId('button-cancel-delete-claim'));
    await waitFor(() => expect(screen.queryByTestId('dialog-delete-claim')).toBeNull());
    expect(mockApiRequest.mock.calls.some(([m]) => m === 'DELETE')).toBe(false);
  });

  it('Delete draft issues DELETE /api/claims/:id for that claim and closes the dialog', async () => {
    renderClaims();
    await openDeleteDialog();
    fireEvent.click(screen.getByTestId('button-confirm-delete-claim'));
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('DELETE', '/api/claims/42');
    });
    await waitFor(() => expect(screen.queryByTestId('dialog-delete-claim')).toBeNull());
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
