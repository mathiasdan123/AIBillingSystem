/**
 * Patients > View Details > Edit details must let a biller complete a
 * quick-added patient: name and date of birth. Quick-add flows save with no
 * DOB since #457 (no more fabricated 2000-01-01), and this dialog was the only
 * edit surface for demographics yet exposed only email/phone/sex/address
 * (QA sweep 2026-11-18).
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
// Insurance sub-sections of the dialog fetch their own data in shapes this
// test does not model; they are not under test.
vi.mock('@/components/PriorAuthorizationsSection', () => ({ default: () => null }));
vi.mock('@/components/InsuranceDocumentsSection', () => ({ default: () => null }));
vi.mock('@/components/BenefitsVerificationCard', () => ({ default: () => null }));
vi.mock('@/components/CoordinationOfBenefitsCard', () => ({ default: () => null }));
vi.mock('@/components/BenefitsSummary', () => ({ default: () => null }));
vi.mock('@/components/PatientInsuranceData/CostEstimationCard', () => ({ default: () => null }));

import Patients from '../pages/patients';

// A quick-added patient: name only, no DOB (the #457 shape).
const RILEY = { id: 7, practiceId: 1, firstName: 'Riley', lastName: 'Nodob', dateOfBirth: null };

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

describe('Patient details: name and date of birth editing', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', practiceId: 1, role: 'admin' },
      isAuthenticated: true,
      isLoading: false,
      isAdmin: true,
      hasFinancialAccess: true,
    });
    mockApiRequest.mockImplementation(async (method: string, url: string, body?: any) => {
      if (method === 'PATCH' && url === '/api/patients/7/details') {
        return jsonResponse({ ...RILEY, ...body });
      }
      if (url.startsWith('/api/appointments')) return jsonResponse([]);
      if (url.startsWith('/api/patients')) return jsonResponse([RILEY]);
      return jsonResponse({});
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  const openEditForm = async () => {
    const view = await screen.findAllByRole('button', { name: /view details/i });
    fireEvent.click(view[0]);
    fireEvent.click(await screen.findByTestId('button-edit-patient-details'));
  };

  it('shows name and DOB fields, prefilled from the patient (blank DOB stays blank)', async () => {
    render(<Patients />, { wrapper: createWrapper() });
    await openEditForm();

    expect(screen.getByTestId('input-edit-patient-first-name')).toHaveValue('Riley');
    expect(screen.getByTestId('input-edit-patient-last-name')).toHaveValue('Nodob');
    const dob = screen.getByTestId('input-edit-patient-dob') as HTMLInputElement;
    expect(dob.type).toBe('date');
    expect(dob.value).toBe('');
  });

  it('saves edited name and DOB in the PATCH payload and reflects them in the open dialog', async () => {
    render(<Patients />, { wrapper: createWrapper() });
    await openEditForm();

    fireEvent.change(screen.getByTestId('input-edit-patient-last-name'), { target: { value: 'Nodob-Smith' } });
    fireEvent.change(screen.getByTestId('input-edit-patient-dob'), { target: { value: '2018-04-12' } });
    fireEvent.click(screen.getByTestId('button-save-patient-details'));

    await waitFor(() => {
      const patch = mockApiRequest.mock.calls.find((c) => c[0] === 'PATCH');
      expect(patch).toBeDefined();
      expect(patch![1]).toBe('/api/patients/7/details');
      expect(patch![2]).toMatchObject({ firstName: 'Riley', lastName: 'Nodob-Smith', dateOfBirth: '2018-04-12' });
    });
    // Dialog title updates from the server's response without a reload.
    expect(await screen.findByText('Riley Nodob-Smith')).toBeInTheDocument();
  });

  it('refuses to save a blank name client-side (never sends the PATCH)', async () => {
    render(<Patients />, { wrapper: createWrapper() });
    await openEditForm();

    fireEvent.change(screen.getByTestId('input-edit-patient-first-name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('button-save-patient-details'));

    await waitFor(() => {
      // The mutation settles (error path) without a PATCH ever being issued.
      expect(mockApiRequest.mock.calls.some((c) => c[0] === 'PATCH')).toBe(false);
    });
    expect(screen.getByTestId('input-edit-patient-first-name')).toBeInTheDocument();
  });
});
