/**
 * Patients > View Details > Archive patient (QA sweep 2026-11-18: no delete
 * or archive control existed). The action sits behind an in-page
 * AlertDialog, never a native confirm(), and the Archived view lists archived
 * patients with an Unarchive action.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));
vi.mock('@/lib/authUtils', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  isUnauthorizedError: vi.fn(() => false),
}));
vi.mock('@/components/PriorAuthorizationsSection', () => ({ default: () => null }));
vi.mock('@/components/InsuranceDocumentsSection', () => ({ default: () => null }));
vi.mock('@/components/BenefitsVerificationCard', () => ({ default: () => null }));
vi.mock('@/components/CoordinationOfBenefitsCard', () => ({ default: () => null }));
vi.mock('@/components/BenefitsSummary', () => ({ default: () => null }));
vi.mock('@/components/PatientInsuranceData/CostEstimationCard', () => ({ default: () => null }));

import Patients from '../pages/patients';

const RILEY = { id: 7, practiceId: 1, firstName: 'Riley', lastName: 'Nodob', dateOfBirth: null, archivedAt: null };
const ARCHIVED_SAM = { id: 8, practiceId: 1, firstName: 'Sam', lastName: 'Archived', dateOfBirth: null, archivedAt: '2026-11-18T15:00:00.000Z' };

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const createWrapper = () => {
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
  qc.setQueryData(['/api/patients'], [RILEY]);
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
};

describe('Patient archive', () => {
  const confirmSpy = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('confirm', confirmSpy);
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', practiceId: 1, role: 'admin' },
      isAuthenticated: true,
      isLoading: false,
      isAdmin: true,
      hasFinancialAccess: true,
    });
    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === 'PATCH' && url === '/api/patients/7/archive') return jsonResponse({ ...RILEY, archivedAt: '2026-11-18T16:00:00.000Z' });
      if (method === 'PATCH' && url === '/api/patients/8/unarchive') return jsonResponse({ ...ARCHIVED_SAM, archivedAt: null });
      if (url.startsWith('/api/appointments')) return jsonResponse([]);
      if (url === '/api/patients?archived=only') return jsonResponse([ARCHIVED_SAM]);
      if (url.startsWith('/api/patients')) return jsonResponse([RILEY]);
      return jsonResponse({});
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('Archive patient opens an in-page dialog (no native confirm); Cancel sends nothing', async () => {
    render(<Patients />, { wrapper: createWrapper() });
    fireEvent.click((await screen.findAllByRole('button', { name: /view details/i }))[0]);
    fireEvent.click(await screen.findByTestId('button-archive-patient'));

    expect(await screen.findByTestId('dialog-archive-patient')).toBeInTheDocument();
    expect(screen.getByText(/Archive Riley Nodob\?/)).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('button-cancel-archive-patient'));
    await waitFor(() => expect(screen.queryByTestId('dialog-archive-patient')).toBeNull());
    expect(mockApiRequest.mock.calls.some(([m]) => m === 'PATCH')).toBe(false);
  });

  it('confirming archives via PATCH /api/patients/:id/archive and closes the details dialog', async () => {
    render(<Patients />, { wrapper: createWrapper() });
    fireEvent.click((await screen.findAllByRole('button', { name: /view details/i }))[0]);
    fireEvent.click(await screen.findByTestId('button-archive-patient'));
    fireEvent.click(await screen.findByTestId('button-confirm-archive-patient'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('PATCH', '/api/patients/7/archive');
    });
    await waitFor(() => expect(screen.queryByTestId('button-archive-patient')).toBeNull());
  });

  it('Show archived lists archived patients with a badge, and their dialog offers Unarchive', async () => {
    render(<Patients />, { wrapper: createWrapper() });
    await screen.findByText('Riley Nodob');
    fireEvent.click(screen.getByTestId('toggle-show-archived'));

    expect(await screen.findByText('Sam Archived')).toBeInTheDocument();
    expect(screen.getByTestId('badge-archived-8')).toHaveTextContent('Archived');
    expect(screen.queryByText('Riley Nodob')).toBeNull();

    fireEvent.click((await screen.findAllByRole('button', { name: /view details/i }))[0]);
    expect(await screen.findByTestId('archived-notice')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-unarchive-patient'));
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('PATCH', '/api/patients/8/unarchive');
    });
  });
});
