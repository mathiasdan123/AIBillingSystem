import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock apiRequest
const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', () => ({
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));

vi.mock('@/lib/authUtils', () => ({
  isUnauthorizedError: () => false,
}));

// Mock useToast
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock radix Select since jsdom can't handle portals
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, value }: any) => (
    <div data-testid="mock-select">
      {children}
      <select
        data-testid="native-select"
        value={value || ''}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        <option value="">Select</option>
        <option value="male">Male</option>
        <option value="female">Female</option>
      </select>
    </div>
  ),
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}));

// Mock ScrollArea (it wraps content in portals/custom scrollbars)
vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

// Mock RadioGroup components
vi.mock('@/components/ui/radio-group', () => ({
  RadioGroup: ({ children, onValueChange, value }: any) => (
    <div role="radiogroup" data-value={value}>
      {children}
    </div>
  ),
  RadioGroupItem: ({ value, id }: any) => (
    <input type="radio" value={value} id={id} name="radio" readOnly />
  ),
}));

import PatientIntakeForm from '@/components/PatientIntakeForm';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** Helper: type text into an input using fireEvent */
function typeText(element: HTMLElement, text: string) {
  fireEvent.focus(element);
  fireEvent.change(element, { target: { value: text } });
}

/** Helper: navigate from step 1 to step 2 */
async function goToStep2(onSuccess: () => void) {
  renderWithProviders(<PatientIntakeForm practiceId={1} onSuccess={onSuccess} />);

  // Check the HIPAA consent checkbox
  const checkbox = screen.getByRole('checkbox');
  fireEvent.click(checkbox);

  // Type a signature
  const signatureInput = screen.getByPlaceholderText('John Doe');
  typeText(signatureInput, 'Jane Smith');

  // Click Next
  fireEvent.click(screen.getByRole('button', { name: /next/i }));

  await waitFor(() => {
    expect(screen.getByText('Patient Information')).toBeInTheDocument();
  });
}

describe('PatientIntakeForm', () => {
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 1, firstName: 'John', lastName: 'Doe' }),
    });
  });

  it('renders step 1 (HIPAA Policy) by default', () => {
    renderWithProviders(<PatientIntakeForm practiceId={1} onSuccess={onSuccess} />);
    expect(screen.getByText('HIPAA Notice of Privacy Practices')).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 15/)).toBeInTheDocument();
  });

  it('renders the progress indicator with step label', () => {
    renderWithProviders(<PatientIntakeForm practiceId={1} onSuccess={onSuccess} />);
    expect(screen.getByText('HIPAA Policy')).toBeInTheDocument();
  });

  it('disables Next button when HIPAA consent is not given', () => {
    renderWithProviders(<PatientIntakeForm practiceId={1} onSuccess={onSuccess} />);
    const nextButton = screen.getByRole('button', { name: /next/i });
    expect(nextButton).toBeDisabled();
  });

  it('navigates to step 2 when HIPAA consent is given and Next is clicked', async () => {
    await goToStep2(onSuccess);
    expect(screen.getByText('Patient Information')).toBeInTheDocument();
    expect(screen.getByText(/Step 2 of 15/)).toBeInTheDocument();
  });

  it('renders patient info fields on step 2', async () => {
    await goToStep2(onSuccess);

    // Required fields
    expect(screen.getByText('First Name *')).toBeInTheDocument();
    expect(screen.getByText('Last Name *')).toBeInTheDocument();

    // Optional fields
    expect(screen.getByText('Middle Name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText('Address')).toBeInTheDocument();
  });

  it('shows validation error for invalid email on step 2', async () => {
    await goToStep2(onSuccess);

    // Type invalid email and blur to trigger validation
    const emailInput = screen.getByPlaceholderText('john.doe@example.com');
    typeText(emailInput, 'not-an-email');
    fireEvent.blur(emailInput);

    await waitFor(() => {
      expect(screen.getByText('Invalid email address')).toBeInTheDocument();
    });
  });

  it('navigates back with Previous button', async () => {
    await goToStep2(onSuccess);

    // Click Previous
    fireEvent.click(screen.getByRole('button', { name: /previous/i }));

    await waitFor(() => {
      expect(screen.getByText('HIPAA Notice of Privacy Practices')).toBeInTheDocument();
    });
  });

  it('shows validation error when first name is empty on blur', async () => {
    await goToStep2(onSuccess);

    // Touch firstName then blur (it's empty)
    const firstNameInput = screen.getByPlaceholderText('John');
    fireEvent.focus(firstNameInput);
    fireEvent.blur(firstNameInput);

    await waitFor(() => {
      expect(screen.getByText('First name is required')).toBeInTheDocument();
    });
  });

  it('renders the form element with proper structure', () => {
    const { container } = renderWithProviders(
      <PatientIntakeForm practiceId={1} onSuccess={onSuccess} />,
    );
    const form = container.querySelector('form');
    expect(form).toBeTruthy();
  });
});
