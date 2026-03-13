import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Hoisted mocks
const mocks = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockApiRequest: vi.fn(),
  queryResults: {} as Record<string, any>,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.mockToast }),
}));

vi.mock('@/lib/queryClient', () => ({
  apiRequest: (...args: any[]) => mocks.mockApiRequest(...args),
}));

// Mock Select since jsdom doesn't handle Radix portals
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, value }: any) => (
    <div data-testid="mock-select">{children}</div>
  ),
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
  SelectValue: () => <span>Credit/Debit Card</span>,
}));

// Mock Dialog for jsdom compatibility
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

// Override useQuery to return non-loading state with empty data by default
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (opts: any) => {
      const key = Array.isArray(opts.queryKey) ? opts.queryKey[0] : opts.queryKey;
      const result = mocks.queryResults[key];
      return result || { data: undefined, isLoading: false };
    },
    useMutation: (opts: any) => {
      return {
        mutate: vi.fn(() => {
          opts.mutationFn?.();
        }),
        isPending: false,
      };
    },
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
    }),
  };
});

import PatientBillingTab from '@/components/PatientBillingTab';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderBillingTab(props?: Partial<{ patientId: number; patientName: string }>) {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <PatientBillingTab
        patientId={props?.patientId ?? 1}
        patientName={props?.patientName ?? 'John Doe'}
      />
    </QueryClientProvider>
  );
}

describe('PatientBillingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockApiRequest.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
  });

  it('renders balance summary cards', () => {
    renderBillingTab();
    expect(screen.getByText('Total Charges')).toBeInTheDocument();
    expect(screen.getByText('Total Payments')).toBeInTheDocument();
    expect(screen.getByText('Adjustments')).toBeInTheDocument();
    expect(screen.getByText('Balance Due')).toBeInTheDocument();
  });

  it('displays default zero amounts when no balance data', () => {
    renderBillingTab();
    const zeroAmounts = screen.getAllByText('$0.00');
    expect(zeroAmounts.length).toBeGreaterThanOrEqual(4);
  });

  it('renders Generate Statement button', () => {
    renderBillingTab();
    expect(screen.getByRole('button', { name: /generate statement/i })).toBeInTheDocument();
  });

  it('renders Record Payment button', () => {
    renderBillingTab();
    expect(screen.getByRole('button', { name: /record payment/i })).toBeInTheDocument();
  });

  it('opens payment dialog when Record Payment is clicked', async () => {
    renderBillingTab();
    const buttons = screen.getAllByRole('button', { name: /record payment/i });
    // Click the action button (first one)
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(screen.getByTestId('dialog')).toBeInTheDocument();
      expect(screen.getByText(/Record a payment for John Doe/)).toBeInTheDocument();
    });
  });

  it('shows empty state text when no statements exist', () => {
    mocks.queryResults = {};
    renderBillingTab();
    expect(screen.getByText('No statements yet')).toBeInTheDocument();
  });

  it('shows empty state text when no payments exist', () => {
    mocks.queryResults = {};
    renderBillingTab();
    expect(screen.getByText('No payments recorded')).toBeInTheDocument();
  });
});
