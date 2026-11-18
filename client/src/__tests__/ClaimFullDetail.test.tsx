/**
 * Claim detail modal totals follow the live claim, not the clicked row.
 *
 * QA sweep 2026-11-18: edit a draft claim's line from 3 to 2 units; the list
 * row showed $200 but the open modal's Billed Amount / Total Billed stayed
 * $300 until a reload, because the modal rendered the row snapshot it was
 * opened with. ClaimFullDetail now reads /api/claims/:id itself, which the
 * line-item mutations already invalidate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', practiceId: 1, role: 'admin' }, isAuthenticated: true, isLoading: false, isAdmin: true, hasFinancialAccess: true }),
}));
const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));

import { ClaimFullDetail } from '../pages/claims';

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

// The row the user clicked: 3 units of 97110 at $100 = $300.
const SNAPSHOT: any = {
  id: 5,
  claimNumber: 'CLM-0005',
  practiceId: 1,
  patientId: 1,
  insuranceId: 1,
  status: 'draft',
  totalAmount: '300.00',
  paidAmount: null,
  createdAt: '2026-11-18T14:00:00.000Z',
};
// What the server now holds after the 3 → 2 unit edit.
let liveClaim: any = { ...SNAPSHOT, totalAmount: '200.00' };

const LINE_ITEMS = [
  { id: 11, cptCodeId: 1, cptCode: { code: '97110', description: 'Therapeutic Exercise' }, units: 2, rate: '100.00', amount: '200.00', dateOfService: '2026-11-18' },
];

function renderDetail() {
  const queryClient = new QueryClient({
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
  const noop = { mutate: vi.fn(), isPending: false } as any;
  return render(
    <QueryClientProvider client={queryClient}>
      <ClaimFullDetail
        claim={SNAPSHOT}
        lineItems={LINE_ITEMS}
        loadingLineItems={false}
        appeals={[]}
        loadingAppeals={false}
        getPatientName={() => 'Riley Nodob'}
        getInsuranceName={() => 'Aetna'}
        getStatusBadge={() => ''}
        submitSecondaryMutation={noop}
        regenerateAppealMutation={noop}
        cptCodes={[]}
        onLineItemAdded={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('ClaimFullDetail billed totals', () => {
  beforeEach(() => {
    mockApiRequest.mockImplementation(async (_m: string, url: string) => {
      if (url === '/api/claims/5') return jsonResponse(liveClaim);
      if (url.startsWith('/api/payment-postings')) return jsonResponse([]);
      if (url.startsWith('/api/patients/')) return jsonResponse({ patientId: 1, balance: 0 });
      if (url.startsWith('/api/icd10-codes')) return jsonResponse([]);
      return jsonResponse({});
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the live claim total ($200) rather than the clicked row snapshot ($300)', async () => {
    renderDetail();

    await waitFor(() => {
      expect(screen.getByText('Billed Amount').parentElement).toHaveTextContent('$200.00');
    });
    expect(screen.getByText('Total Billed:').parentElement).toHaveTextContent('$200.00');
    expect(screen.queryByText('$300.00')).toBeNull();
  });

  it('falls back to the snapshot until the live claim has loaded', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mockApiRequest.mockImplementation(async (_m: string, url: string) => {
      if (url === '/api/claims/5') { await gate; return jsonResponse(liveClaim); }
      return jsonResponse([]);
    });

    renderDetail();
    // First paint: snapshot value, so the modal is never blank.
    expect(screen.getByText('Billed Amount').parentElement).toHaveTextContent('$300.00');

    release();
    await waitFor(() => {
      expect(screen.getByText('Billed Amount').parentElement).toHaveTextContent('$200.00');
    });
  });
});
