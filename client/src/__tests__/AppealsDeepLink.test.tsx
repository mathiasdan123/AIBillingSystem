/**
 * /appeals?appealId=N opens that appeal's drawer (QA sweep 2026-11-18: the
 * Revenue at Risk "Review appeal" link carried the id but the page ignored it).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'biller-a', practiceId: 1, role: 'billing' },
    isAuthenticated: true,
    isLoading: false,
    isAdmin: false,
    hasFinancialAccess: true,
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  apiRequest: vi.fn(),
}));
vi.mock('@/components/TextToSpeech', () => ({ TextToSpeech: () => null }));

import Appeals from '../pages/appeals';

const appeal = (id: number, claimNumber: string, status = 'ready') => ({
  id,
  claimId: id * 10,
  practiceId: 1,
  appealLevel: 'first_level',
  status,
  denialCategory: null,
  deadlineDate: '2027-01-17T00:00:00.000Z',
  submittedDate: null,
  resolvedDate: null,
  appealedAmount: '300.00',
  recoveredAmount: null,
  appealLetter: `Letter for ${claimNumber}`,
  supportingDocs: [],
  insurerResponse: null,
  notes: null,
  assignedTo: null,
  createdAt: '2026-11-18T00:00:00.000Z',
  claim: { id: id * 10, claimNumber, totalAmount: '300.00', denialReason: 'Not medically necessary' },
  patientName: `Patient ${id}`,
});

const dashboard = {
  totalDeniedAwaitingAppeal: 0,
  appealsPendingSubmission: 2,
  appealsPastDeadline: 0,
  successRate: 0,
  totalRecovered: 0,
  last90DaysWon: 0,
  last90DaysTotal: 0,
};

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } });
  qc.setQueryData(['/api/appeals/dashboard'], dashboard);
  qc.setQueryData(['/api/appeals/denied-claims'], []);
  qc.setQueryData(['/api/appeals'], [appeal(1, 'DEMO-2-1005'), appeal(2, 'DEMO-2-1006')]);
  return render(
    <QueryClientProvider client={qc}>
      <Appeals />
    </QueryClientProvider>,
  );
}

describe('/appeals?appealId=N', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('opens the drawer for the linked appeal once appeals load', async () => {
    renderAt('/appeals?appealId=2');
    // The Sheet's description names the claim + patient of the selected appeal.
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent('DEMO-2-1006');
    });
    expect(screen.getByRole('dialog')).toHaveTextContent('Patient 2');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('DEMO-2-1005');
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('does nothing without the param', async () => {
    renderAt('/appeals');
    await screen.findByTestId('appeal-card-1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tells the user when the id is not one of this practice\'s appeals', async () => {
    renderAt('/appeals?appealId=999');
    await screen.findByTestId('appeal-card-1');
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Appeal not found' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
