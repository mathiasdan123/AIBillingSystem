import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Hoisted mock for controlling useQuery results
const mocks = vi.hoisted(() => ({
  arData: undefined as any,
  isLoading: false,
  role: 'admin' as string,
}));

// A/R is financial data: the component renders null for non-financial roles,
// so these tests run as an admin by default (see the role-gating test below).
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: mocks.role }, isAuthenticated: true, isLoading: false }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: () => ({
      data: mocks.arData,
      isLoading: mocks.isLoading,
    }),
  };
});

import PatientArAgingSummary from '@/components/PatientArAgingSummary';

function renderComponent() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PatientArAgingSummary />
    </QueryClientProvider>
  );
}

describe('PatientArAgingSummary', () => {
  beforeEach(() => {
    mocks.arData = undefined;
    mocks.isLoading = false;
    mocks.role = 'admin';
  });

  it('returns null when no data is available', () => {
    mocks.arData = undefined;
    const { container } = renderComponent();
    // Component returns null when no data
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for therapist-role users even when data exists', () => {
    mocks.role = 'therapist';
    mocks.arData = {
      totalOutstanding: 100,
      buckets: [{ bucket: '0-30', count: 1, amount: 100 }],
      byPatient: [],
    };
    const { container } = renderComponent();
    expect(container.innerHTML).toBe('');
  });

  it('renders aging bucket labels and amounts', () => {
    mocks.arData = {
      totalOutstanding: 1500.5,
      buckets: [
        { bucket: '0-30', count: 3, amount: 500 },
        { bucket: '31-60', count: 2, amount: 400 },
        { bucket: '61-90', count: 1, amount: 300.5 },
        { bucket: '90+', count: 1, amount: 300 },
      ],
      byPatient: [],
    };
    renderComponent();

    expect(screen.getByText('Patient A/R Aging')).toBeInTheDocument();
    expect(screen.getByText('0-30')).toBeInTheDocument();
    expect(screen.getByText('31-60')).toBeInTheDocument();
    expect(screen.getByText('61-90')).toBeInTheDocument();
    expect(screen.getByText('90+')).toBeInTheDocument();
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.getByText('$300.50')).toBeInTheDocument();
  });

  it('renders statement count labels for each bucket', () => {
    mocks.arData = {
      totalOutstanding: 900,
      buckets: [
        { bucket: '0-30', count: 1, amount: 500 },
        { bucket: '31-60', count: 3, amount: 400 },
      ],
      byPatient: [],
    };
    renderComponent();

    expect(screen.getByText('1 stmt')).toBeInTheDocument();
    expect(screen.getByText('3 stmts')).toBeInTheDocument();
  });

  it('shows zero balance message when totalOutstanding is 0', () => {
    mocks.arData = {
      totalOutstanding: 0,
      buckets: [
        { bucket: '0-30', count: 0, amount: 0 },
      ],
      byPatient: [],
    };
    renderComponent();

    expect(screen.getByText('No outstanding patient balances')).toBeInTheDocument();
  });

  it('renders top patients with outstanding balances', () => {
    mocks.arData = {
      totalOutstanding: 2500,
      buckets: [
        { bucket: '0-30', count: 2, amount: 2500 },
      ],
      byPatient: [
        { patientId: 1, patientName: 'Alice Smith', totalOwed: 1500, oldestDays: 25 },
        { patientId: 2, patientName: 'Bob Johnson', totalOwed: 1000, oldestDays: 10 },
      ],
    };
    renderComponent();

    expect(screen.getByText('Top Outstanding Balances')).toBeInTheDocument();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Johnson')).toBeInTheDocument();
    expect(screen.getByText('25d')).toBeInTheDocument();
    expect(screen.getByText('10d')).toBeInTheDocument();
  });
});
