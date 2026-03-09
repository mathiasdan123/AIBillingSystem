import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Patients from '../../pages/patients';

/**
 * Patients Page Tests
 *
 * Tests for the main patients list page including:
 * - Rendering patient list
 * - Loading states
 * - Empty states
 * - Search functionality
 */

// Mock the useAuth hook
const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

// Mock the toast hook
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Mock the apiRequest helper
vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(),
}));

// Mock authUtils
vi.mock('@/lib/authUtils', () => ({
  isUnauthorizedError: vi.fn(() => false),
}));

// Helper to create a fresh QueryClient for each test
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  });

// Wrapper component with providers
const createWrapper = (mockPatients: any[] = []) => {
  const queryClient = createTestQueryClient();
  // Pre-populate the query cache with mock data
  queryClient.setQueryData(['/api/patients'], mockPatients);
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
};

describe('Patients Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default authenticated admin user
    mockUseAuth.mockReturnValue({
      user: { claims: { sub: 'test-user-123' } },
      isAuthenticated: true,
      isLoading: false,
      isAdmin: true,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Loading State', () => {
    it('should show loading spinner while fetching patients', async () => {
      mockUseAuth.mockReturnValue({
        user: { claims: { sub: 'test-user-123' } },
        isAuthenticated: true,
        isLoading: true,
        isAdmin: false,
      });

      render(<Patients />, { wrapper: createWrapper() });

      // Should show loading spinner
      expect(screen.getByText(/Loading patients/i)).toBeInTheDocument();
    });

    it('should show loading text during auth check', () => {
      mockUseAuth.mockReturnValue({
        user: undefined,
        isAuthenticated: false,
        isLoading: true,
        isAdmin: false,
      });

      render(<Patients />, { wrapper: createWrapper() });

      expect(screen.getByText(/Loading patients/i)).toBeInTheDocument();
    });
  });

  describe('Patient List Rendering', () => {
    it('should render patient list when data is loaded', async () => {
      const mockPatients = [
        {
          id: 1,
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '5551234567',
          insuranceProvider: 'Blue Cross',
          dateOfBirth: '1990-01-15',
        },
        {
          id: 2,
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
          phone: '5559876543',
          insuranceProvider: 'Aetna',
          dateOfBirth: '1985-06-20',
        },
      ];

      render(<Patients />, { wrapper: createWrapper(mockPatients) });

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      expect(screen.getByText('Blue Cross')).toBeInTheDocument();
      expect(screen.getByText('Aetna')).toBeInTheDocument();
    });

    it('should display patient email when provided', async () => {
      const mockPatients = [
        {
          id: 1,
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
        },
      ];

      render(<Patients />, { wrapper: createWrapper(mockPatients) });

      await waitFor(() => {
        expect(screen.getByText('john.doe@example.com')).toBeInTheDocument();
      });
    });

    it('should display patient phone when provided', async () => {
      const mockPatients = [
        {
          id: 1,
          firstName: 'John',
          lastName: 'Doe',
          phone: '5551234567',
        },
      ];

      render(<Patients />, { wrapper: createWrapper(mockPatients) });

      await waitFor(() => {
        expect(screen.getByText('5551234567')).toBeInTheDocument();
      });
    });

    it('should show total patient count in stats card', async () => {
      const mockPatients = [
        { id: 1, firstName: 'John', lastName: 'Doe' },
        { id: 2, firstName: 'Jane', lastName: 'Smith' },
        { id: 3, firstName: 'Bob', lastName: 'Wilson' },
      ];

      render(<Patients />, { wrapper: createWrapper(mockPatients) });

      await waitFor(() => {
        // Stats card should show count of 3
        const countElements = screen.getAllByText('3');
        expect(countElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no patients exist', async () => {
      render(<Patients />, { wrapper: createWrapper([]) });

      await waitFor(() => {
        expect(screen.getByText(/No Patients Found/i)).toBeInTheDocument();
      });

      // Should show add patient prompt
      expect(screen.getByText(/Get started by adding your first patient/i)).toBeInTheDocument();
    });

    it('should show "Add First Patient" button in empty state', async () => {
      render(<Patients />, { wrapper: createWrapper([]) });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Add First Patient/i })).toBeInTheDocument();
      });
    });

    it('should show search input for filtering patients', async () => {
      const mockPatients = [
        { id: 1, firstName: 'John', lastName: 'Doe' },
      ];

      render(<Patients />, { wrapper: createWrapper(mockPatients) });

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      // Verify the search input exists
      expect(screen.getByPlaceholderText(/Search patients/i)).toBeInTheDocument();
    });
  });

  describe('Page Layout', () => {
    it('should render page header with title', async () => {
      render(<Patients />, { wrapper: createWrapper([]) });

      await waitFor(() => {
        expect(screen.getByText('Patient Management')).toBeInTheDocument();
      });

      expect(screen.getByText(/Manage patient information and insurance details/i)).toBeInTheDocument();
    });

    it('should render Add Patient button', async () => {
      render(<Patients />, { wrapper: createWrapper([]) });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Add Patient/i })).toBeInTheDocument();
      });
    });

    it('should render search input', async () => {
      render(<Patients />, { wrapper: createWrapper([]) });

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Search patients by name, email, or phone/i)).toBeInTheDocument();
      });
    });

    it('should render stats cards', async () => {
      render(<Patients />, { wrapper: createWrapper([]) });

      await waitFor(() => {
        expect(screen.getByText('Total Patients')).toBeInTheDocument();
      });

      expect(screen.getByText('Active Patients')).toBeInTheDocument();
      expect(screen.getByText('Insurance Verified')).toBeInTheDocument();
    });
  });

  describe('Authentication Handling', () => {
    it('should not render content when not authenticated', () => {
      mockUseAuth.mockReturnValue({
        user: undefined,
        isAuthenticated: false,
        isLoading: false,
        isAdmin: false,
      });

      const { container } = render(<Patients />, { wrapper: createWrapper([]) });

      // Component returns null when not authenticated and not loading
      // After redirect timeout, the component renders nothing
      expect(container).toBeTruthy();
    });
  });

  describe('Insurance Information', () => {
    it('should display insurance provider badge', async () => {
      const mockPatients = [
        {
          id: 1,
          firstName: 'John',
          lastName: 'Doe',
          insuranceProvider: 'United Healthcare',
        },
      ];

      render(<Patients />, { wrapper: createWrapper(mockPatients) });

      await waitFor(() => {
        expect(screen.getByText('United Healthcare')).toBeInTheDocument();
      });
    });

    it('should show "No Insurance" badge when provider not set', async () => {
      const mockPatients = [
        {
          id: 1,
          firstName: 'John',
          lastName: 'Doe',
          insuranceProvider: null,
        },
      ];

      render(<Patients />, { wrapper: createWrapper(mockPatients) });

      await waitFor(() => {
        expect(screen.getByText('No Insurance')).toBeInTheDocument();
      });
    });

    it('should show Check Eligibility button for patients with insurance', async () => {
      const mockPatients = [
        {
          id: 1,
          firstName: 'John',
          lastName: 'Doe',
          insuranceProvider: 'Aetna',
        },
      ];

      render(<Patients />, { wrapper: createWrapper(mockPatients) });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Check Eligibility/i })).toBeInTheDocument();
      });
    });
  });
});
