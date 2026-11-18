/**
 * Submitting a claim for an archived patient shows a non-blocking notice
 * (QA 2026-11-18). Archive blocks NEW claims and hides the patient from
 * pickers; an existing draft is still legitimate billing for past services,
 * so Submit must keep working and only tell the biller what they are
 * looking at.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
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

const draftFor = (id: number, patientId: number) => ({
  id,
  claimNumber: `CLM-${id}`,
  practiceId: 1,
  patientId,
  insuranceId: 1,
  status: 'draft',
  totalAmount: '300.00',
  paidAmount: null,
  createdAt: '2026-11-18T14:00:00.000Z',
  serviceDate: '2026-11-18',
});

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

function routeApi(claims: any[]) {
  mockApiRequest.mockImplementation(async (method: string, url: string) => {
    if (method === 'POST' && /\/api\/claims\/\d+\/predict-denial$/.test(url)) {
      return jsonResponse({ riskScore: 12, riskLevel: 'low', issues: [], overallRecommendation: 'Ready to submit.', analyzedAt: '2026-11-18T14:05:00.000Z' });
    }
    if (url.startsWith('/api/patients?')) {
      return jsonResponse(url.includes('archived=include') ? [ARCHIVED_AVA, ACTIVE_LIAM] : [ACTIVE_LIAM]);
    }
    if (url.startsWith('/api/claims/summary')) {
      return jsonResponse({ total: claims.length, draft: claims.length, submitted: 0, paid: 0, denied: 0, held: 0, totalAmount: 300, paidAmount: 0, pendingAmount: 300 });
    }
    if (url.startsWith('/api/claims?')) {
      return jsonResponse({ data: claims, pagination: { page: 1, limit: 50, total: claims.length, totalPages: 1, hasMore: false } });
    }
    if (url.startsWith('/api/practices/')) return jsonResponse({ id: 1, name: 'Demo Practice' });
    if (url.startsWith('/api/insurances')) return jsonResponse([{ id: 1, name: 'Aetna' }]);
    return jsonResponse([]);
  });
}

describe('Submit on a claim for an archived patient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows "This patient is archived" and still starts the submission flow', async () => {
    routeApi([draftFor(1006, ARCHIVED_AVA.id)]);
    renderClaims();
    await screen.findByText(/CLM-1006/);

    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'This patient is archived' }));
    });
    const notice = mockToast.mock.calls.find(([t]) => t.title === 'This patient is archived')![0];
    expect(notice.variant).toBeUndefined(); // informational, not destructive
    expect(notice.description).toContain('Ava Sample');
    // Non-blocking: the pre-submit denial check (the first step of Submit) still ran.
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('POST', '/api/claims/1006/predict-denial');
    });
  });

  it('shows no archived notice for an active patient', async () => {
    routeApi([draftFor(1007, ACTIVE_LIAM.id)]);
    renderClaims();
    await screen.findByText(/CLM-1007/);

    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('POST', '/api/claims/1007/predict-denial');
    });
    expect(mockToast.mock.calls.some(([t]) => t.title === 'This patient is archived')).toBe(false);
  });
});
