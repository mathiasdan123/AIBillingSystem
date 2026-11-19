/**
 * Demo pass 2026-11-19, two silent failures on the Claims page:
 *
 * 1. Submit → pre-submit risk dialog → "Submit Anyway": the server answered
 *    400 (the demo practice is refused before the scrubber runs), the dialog
 *    had already closed, and nothing visible said why the claim stayed Draft.
 *    The dialog now stays open until the server answers and shows the
 *    server's own message inline (and in a toast); success closes it.
 *
 * 2. Delete draft: DELETE answered 500 and the app-wide mutation default
 *    retried it three times with backoff, so the only error toast arrived
 *    ~7s later. The delete no longer auto-retries, and the server message is
 *    shown inside the confirm dialog as well as in a toast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', practiceId: 1, role: 'admin' },
    isAuthenticated: true, isLoading: false, isAdmin: true, hasFinancialAccess: true,
  }),
}));
const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));

import Claims from '../pages/claims';

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

const PATIENT = { id: 1, firstName: 'Riley', lastName: 'Nodob', practiceId: 1, archivedAt: null };
const DRAFT = {
  id: 71, claimNumber: 'CLM-MWM0SNOZ-BA5HHJ', practiceId: 1, patientId: 1, insuranceId: 1,
  status: 'draft', totalAmount: '300.00', paidAmount: null,
  createdAt: '2026-11-18T14:00:00.000Z', serviceDate: '2026-11-18',
};
const HIGH_RISK = {
  riskScore: 78, riskLevel: 'high', analyzedAt: '2026-11-19T00:00:00.000Z',
  overallRecommendation: 'Fix the issues below before submitting.',
  issues: [{ severity: 'high', category: 'documentation', message: 'Patient date of birth is missing' }],
};
const DEMO_REFUSED = {
  message: 'This is the demo practice — claims are not transmitted to a real payer.',
  code: 'demo_practice_refused',
};

const submitCalls: string[] = [];

function renderClaims() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, gcTime: 0, staleTime: 0,
        queryFn: async ({ queryKey }) => (await mockApiRequest('GET', (queryKey as string[]).join(''))).json(),
      },
      // The app's real default retries 5xx mutations three times with backoff.
      mutations: { retry: (n: number, e: any) => n < 3 && !(parseInt(e?.message, 10) >= 400 && parseInt(e?.message, 10) < 500) },
    },
  });
  return render(<QueryClientProvider client={qc}><Claims /></QueryClientProvider>);
}

beforeEach(() => {
  submitCalls.length = 0;
  mockApiRequest.mockImplementation(async (method: string, url: string) => {
    if (method === 'POST' && /\/predict-denial$/.test(url)) return jsonResponse(HIGH_RISK);
    if (method === 'DELETE') {
      const err = new Error('500: {"message":"Failed to delete claim"}');
      throw err;
    }
    if (url.startsWith('/api/patients?')) return jsonResponse([PATIENT]);
    if (url.startsWith('/api/claims/summary')) return jsonResponse({ total: 1, draft: 1, submitted: 0, paid: 0, denied: 0, held: 0, totalAmount: 300, paidAmount: 0, pendingAmount: 300 });
    if (url.startsWith('/api/claims?')) return jsonResponse({ data: [DRAFT], pagination: { page: 1, limit: 50, total: 1, totalPages: 1, hasMore: false } });
    if (url.startsWith('/api/practices/')) return jsonResponse({ id: 1, name: 'Demo Practice', isDemo: true });
    if (url.startsWith('/api/insurances')) return jsonResponse([{ id: 1, name: 'Aetna' }]);
    return jsonResponse([]);
  });
  // The submit mutation uses bare fetch(), not apiRequest.
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (/\/api\/claims\/\d+\/submit$/.test(String(url))) {
      submitCalls.push(String(url));
      return jsonResponse(DEMO_REFUSED, 400);
    }
    return jsonResponse([]);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Submit → risk dialog → Submit Anyway, server answers 400', () => {
  it('keeps the dialog open, shows the server message inline and in a toast; the claim is not marked submitted', async () => {
    renderClaims();
    await screen.findByText(/CLM-MWM0SNOZ-BA5HHJ/);
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    const dialog = await screen.findByRole('dialog');
    const go = await within(dialog).findByRole('button', { name: /submit anyway|submit claim/i });
    fireEvent.click(go);
    await waitFor(() => expect(submitCalls).toHaveLength(1));

    const alert = await screen.findByTestId('alert-submit-error');
    expect(alert).toHaveTextContent('Claim was not submitted');
    expect(alert).toHaveTextContent('This is the demo practice');
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // still open
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Claim was not submitted',
      variant: 'destructive',
      description: expect.stringContaining('demo practice'),
    }));
    // Exactly one attempt: a refused submission must never auto-retry.
    expect(submitCalls).toHaveLength(1);
  });

  it('closes the dialog on success', async () => {
    (globalThis.fetch as any).mockImplementation(async (url: string) => {
      if (/\/api\/claims\/\d+\/submit$/.test(String(url))) {
        submitCalls.push(String(url));
        return jsonResponse({ success: true, submissionMethod: 'stedi', message: 'ok' });
      }
      return jsonResponse([]);
    });
    renderClaims();
    await screen.findByText(/CLM-MWM0SNOZ-BA5HHJ/);
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: /submit anyway|submit claim/i }));
    await waitFor(() => expect(submitCalls).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByTestId('alert-submit-error')).toBeNull();
  });
});

describe('Delete draft, server answers 500', () => {
  it('shows the server message inside the confirm dialog and in a toast, with no auto-retry', async () => {
    renderClaims();
    await screen.findByText(/CLM-MWM0SNOZ-BA5HHJ/);
    const trigger = await screen.findByTestId('menu-trigger-claim-71');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByText(/delete draft/i));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /delete draft/i }));

    // Within well under the old ~7s retry window.
    const alert = await screen.findByTestId('alert-delete-error', {}, { timeout: 1500 });
    expect(alert).toHaveTextContent('Failed to delete claim'); // the server's message, not raw JSON
    expect(alert).not.toHaveTextContent('{');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument(); // still open so the message is read
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't delete this claim",
      description: 'Failed to delete claim',
      variant: 'destructive',
    }));
    const deletes = mockApiRequest.mock.calls.filter(([m]) => m === 'DELETE');
    expect(deletes).toHaveLength(1);
  });

  it('a 409 "linked records" answer names the blocking record', async () => {
    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === 'DELETE') {
        throw new Error('409: {"message":"This claim still has linked payment postings, so it can\'t be deleted.","code":"has_linked_records","table":"payment_postings"}');
      }
      if (method === 'POST' && /\/predict-denial$/.test(url)) return jsonResponse(HIGH_RISK);
      if (url.startsWith('/api/patients?')) return jsonResponse([PATIENT]);
      if (url.startsWith('/api/claims/summary')) return jsonResponse({ total: 1, draft: 1, submitted: 0, paid: 0, denied: 0, held: 0, totalAmount: 300, paidAmount: 0, pendingAmount: 300 });
      if (url.startsWith('/api/claims?')) return jsonResponse({ data: [DRAFT], pagination: { page: 1, limit: 50, total: 1, totalPages: 1, hasMore: false } });
      return jsonResponse([]);
    });
    renderClaims();
    await screen.findByText(/CLM-MWM0SNOZ-BA5HHJ/);
    fireEvent.keyDown(await screen.findByTestId('menu-trigger-claim-71'), { key: 'Enter' });
    fireEvent.click(await screen.findByText(/delete draft/i));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /delete draft/i }));
    const alert = await screen.findByTestId('alert-delete-error', {}, { timeout: 1500 });
    expect(alert).toHaveTextContent('linked payment postings');
  });
});
