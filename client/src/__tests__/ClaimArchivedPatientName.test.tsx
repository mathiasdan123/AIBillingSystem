/**
 * QA 2026-11-18 (right after #472): while a patient is archived, their
 * existing claims showed the patient as "Unknown" on the Claims list card and
 * in the claim detail dialog. The page resolved names from the default
 * patient list, which now excludes archived patients. The list the page
 * uses for name lookups must include archived patients; the new-claim
 * picker must still leave them out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

const AVA_CLAIM = {
  id: 1006,
  claimNumber: 'DEMO-2-1006',
  practiceId: 1,
  patientId: 1,
  insuranceId: 1,
  status: 'submitted',
  totalAmount: '289.00',
  paidAmount: null,
  createdAt: '2026-11-10T14:00:00.000Z',
  serviceDate: '2026-11-10',
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

describe('Claims: patient name for an archived patient', () => {
  const patientListRequests: string[] = [];

  beforeEach(() => {
    patientListRequests.length = 0;
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith('/api/patients?')) {
        patientListRequests.push(url);
        // Mirrors the server: archived patients come back only when asked for.
        return jsonResponse(url.includes('archived=include') ? [ARCHIVED_AVA, ACTIVE_LIAM] : [ACTIVE_LIAM]);
      }
      if (url.startsWith('/api/claims/summary')) {
        return jsonResponse({ total: 1, draft: 0, submitted: 1, paid: 0, denied: 0, held: 0, totalAmount: 289, paidAmount: 0, pendingAmount: 289 });
      }
      if (url.startsWith('/api/claims?')) {
        return jsonResponse({ data: [AVA_CLAIM], pagination: { page: 1, limit: 50, total: 1, totalPages: 1, hasMore: false } });
      }
      if (url.startsWith('/api/claims/1006')) return jsonResponse(AVA_CLAIM);
      if (url.startsWith('/api/practices/')) return jsonResponse({ id: 1, name: 'Demo Practice' });
      if (url.startsWith('/api/insurances')) return jsonResponse([{ id: 1, name: 'Aetna' }]);
      return jsonResponse([]);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('asks for the patient list including archived patients', async () => {
    renderClaims();
    await screen.findByText(/DEMO-2-1006/);
    expect(patientListRequests.some((u) => u.includes('archived=include'))).toBe(true);
  });

  it('shows the archived patient\'s real name on the claim card, not "Unknown"', async () => {
    renderClaims();
    const card = (await screen.findByText(/DEMO-2-1006/)).closest('[class*="rounded"]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent('Ava Sample');
    expect(card).not.toHaveTextContent('Unknown');
  });

  it('shows the real name in the claim detail dialog header too', async () => {
    renderClaims();
    await screen.findByText(/DEMO-2-1006/);
    // View Details lives in the row menu (same menu as Delete draft).
    const trigger = await screen.findByTestId('menu-trigger-claim-1006');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByText(/view details/i));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Ava Sample');
    expect(dialog).not.toHaveTextContent('Unknown');
  });
});
