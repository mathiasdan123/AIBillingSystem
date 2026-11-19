/**
 * Demo billing test 2026-11-19, item 4: the Claims page showed the Sandbox
 * banner ("submitting records the claim here, sends nothing") while the
 * server refused the demo practice's submit. The demo practice now gets its
 * own banner explaining that Submit simulates an acceptance, the sandbox
 * banner (which tells the user to switch to Live Mode) is not shown for it,
 * and a simulated submission is toasted as such rather than as "Success".
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

const PATIENT = { id: 1, firstName: 'Ethan', lastName: 'Example', practiceId: 1, archivedAt: null };
const DRAFT = {
  id: 73, claimNumber: 'CLM-MWNVFA08-DIJSKH', practiceId: 1, patientId: 1, insuranceId: 1,
  status: 'draft', totalAmount: '100.00', paidAmount: null,
  createdAt: '2026-11-18T14:00:00.000Z', serviceDate: '2026-11-17',
};
const LOW_RISK = { riskScore: 12, riskLevel: 'low', analyzedAt: '2026-11-19T00:00:00.000Z', overallRecommendation: 'Ready.', issues: [] };
const SIMULATED = {
  success: true, simulated: true, submissionMethod: 'demo_simulation',
  message: 'Demo practice: submission simulated. The claim is marked submitted here; nothing was sent to a clearinghouse or payer.',
  claim: { ...DRAFT, status: 'submitted' },
};

function renderClaims(practice: Record<string, unknown>) {
  mockApiRequest.mockImplementation(async (method: string, url: string) => {
    if (method === 'POST' && /\/predict-denial$/.test(url)) return jsonResponse(LOW_RISK);
    if (url.startsWith('/api/patients?')) return jsonResponse([PATIENT]);
    if (url.startsWith('/api/claims/summary')) return jsonResponse({ total: 1, draft: 1, submitted: 0, paid: 0, denied: 0, held: 0, totalAmount: 100, paidAmount: 0, pendingAmount: 100 });
    if (url.startsWith('/api/claims?')) return jsonResponse({ data: [DRAFT], pagination: { page: 1, limit: 50, total: 1, totalPages: 1, hasMore: false } });
    if (url.startsWith('/api/practices/')) return jsonResponse({ id: 1, name: 'Demo Practice', ...practice });
    if (url.startsWith('/api/insurances')) return jsonResponse([{ id: 1, name: 'Aetna' }]);
    return jsonResponse([]);
  });
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, gcTime: 0, staleTime: 0,
        queryFn: async ({ queryKey }) => (await mockApiRequest('GET', (queryKey as string[]).join(''))).json(),
      },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={qc}><Claims /></QueryClientProvider>);
}

const submitCalls: string[] = [];
beforeEach(() => {
  submitCalls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (/\/api\/claims\/\d+\/submit$/.test(String(url))) {
      submitCalls.push(String(url));
      return jsonResponse(SIMULATED);
    }
    return jsonResponse([]);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Claims page on the demo practice', () => {
  it('shows the demo banner, not the sandbox banner', async () => {
    renderClaims({ isDemo: true, sandboxMode: true });
    const banner = await screen.findByTestId('alert-demo-practice');
    expect(banner).toHaveTextContent(/submissions are simulated/i);
    expect(banner).toHaveTextContent(/nothing is sent to a clearinghouse or payer/i);
    expect(screen.queryByTestId('alert-sandbox-mode')).toBeNull();
  });

  it('toasts a simulated submission as simulated, not as a plain success', async () => {
    renderClaims({ isDemo: true, sandboxMode: true });
    await screen.findByText(/CLM-MWNVFA08-DIJSKH/);
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: /submit anyway|submit claim/i }));
    await waitFor(() => expect(submitCalls).toHaveLength(1));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Submission simulated (demo)',
      description: expect.stringMatching(/nothing was sent/i),
    })));
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
  });
});

describe('Claims page on a sandbox (non-demo) practice', () => {
  it('keeps the sandbox banner and shows no demo banner', async () => {
    renderClaims({ isDemo: false, sandboxMode: true });
    await screen.findByTestId('alert-sandbox-mode');
    expect(screen.queryByTestId('alert-demo-practice')).toBeNull();
  });
});
