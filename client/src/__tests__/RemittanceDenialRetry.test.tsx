/**
 * Remittance page (#497 review, item 3): a posted denied line whose claim
 * step has not gone through is shown as "Denial pending" with its last error
 * and a Retry denial button that calls the retry-denial route — which never
 * posts money. Such a remittance is still 'pending', so Auto-Match stays
 * visible too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', practiceId: 1, role: 'admin' }, isAuthenticated: true, isLoading: false, isAdmin: true, hasFinancialAccess: true }),
}));
const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));

import Remittance from '../pages/remittance';

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

const RECORD = {
  id: 500, practiceId: 1, receivedDate: '2026-11-19', payerName: 'Aetna QA Synthetic', payerId: '60054', checkNumber: 'QA-SYN-1',
  checkDate: '2026-11-18', totalPaymentAmount: '0.00', status: 'pending', processedAt: null, createdAt: '2026-11-19T15:00:00Z', lineItemCount: 1, matchedCount: 1,
};
const PENDING_LINE = {
  id: 31, remittanceId: 500, claimId: 73, patientName: 'Ethan Example', memberId: 'W2', serviceDate: '2026-11-17', cptCode: '97140',
  chargedAmount: '100.00', allowedAmount: null, paidAmount: '0.00', adjustmentAmount: '100.00', status: 'matched', matchType: 'manual',
  adjustmentReasonCodes: [{ code: 'CO-197', description: 'x' }], remarkCodes: [], claimStatusCode: '4', autoPostedAt: null, paymentEvidence: 'recorded',
  denialAppliedAt: null, denialError: 'AI generator unavailable',
};

const posts: string[] = [];

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, queryFn: async ({ queryKey }) => (await mockApiRequest('GET', (queryKey as string[]).join(''))).json() },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={qc}><Remittance /></QueryClientProvider>);
}

beforeEach(() => {
  posts.length = 0;
  mockApiRequest.mockImplementation(async (method: string, url: string) => {
    if (method === 'POST') {
      posts.push(url);
      if (/retry-denial$/.test(url)) {
        return jsonResponse({ message: 'Line is matched to claim CLM-1; its payment was already recorded and is not posted again. The payer denied claim CLM-1 (CO-197); it was already Denied, an appeal was drafted (#91), and a denial follow-up was added to the work queue.', partial: false, denial: { applied: true } });
      }
      return jsonResponse({});
    }
    if (url === '/api/remittance/500') return jsonResponse({ ...RECORD, lineItems: [PENDING_LINE], rawData: {} });
    if (url.startsWith('/api/remittance?')) return jsonResponse({ data: [RECORD], pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false } });
    return jsonResponse([]);
  });
});
afterEach(() => { vi.clearAllMocks(); });

describe('Remittance detail with a pending denial', () => {
  it('shows "Denial pending" with the last error, keeps Auto-Match, and Retry denial calls the retry route only', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /view/i }));

    const pending = await screen.findByTestId('denial-pending-31');
    expect(pending).toHaveTextContent('Denial pending');
    expect(pending).toHaveTextContent('Last error: AI generator unavailable');
    // Not processed, so the Auto-Match All button is still there.
    expect(screen.getByRole('button', { name: /auto-match all/i })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('retry-denial-31'));

    await waitFor(() => expect(posts).toContain('/api/remittance/500/line-items/31/retry-denial'));
    expect(posts.filter((p) => /\/match$/.test(p))).toHaveLength(0); // never the posting route
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Denial applied', description: expect.stringMatching(/not posted again/) })));
  });
});

describe('Remittance detail with a denied line whose payment is not recorded', () => {
  it('shows "Needs manual review", says the denial was not applied, and keeps Retry denial available', async () => {
    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === 'POST') { posts.push(url); return jsonResponse({ message: 'refused', partial: true }, 409); }
      if (url === '/api/remittance/500') return jsonResponse({ ...RECORD, lineItems: [{ ...PENDING_LINE, paymentEvidence: 'not_recorded' }], rawData: {} });
      if (url.startsWith('/api/remittance?')) return jsonResponse({ data: [RECORD], pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false } });
      return jsonResponse([]);
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /view/i }));
    const note = await screen.findByTestId('payment-unconfirmed-31');
    expect(note).toHaveTextContent('Needs manual review');
    expect(note).toHaveTextContent('Payment not recorded on the claim');
    expect(note).toHaveTextContent("The payer's denial was not applied");
    expect(screen.queryByTestId('denial-pending-31')).toBeNull();
    expect(screen.getByTestId('retry-denial-31')).toBeInTheDocument();
  });
});
