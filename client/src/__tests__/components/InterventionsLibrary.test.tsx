import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InterventionsLibrary from '../../pages/interventions-library';

/**
 * Interventions Library (admin page) tests
 *
 * - Renders the categorized list with system items clearly distinguished
 *   from practice custom ones (badge, visibility switch vs edit/delete).
 * - Add flow: opens the dialog and POSTs the new custom intervention.
 */

// Mock the toast hook
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock the apiRequest helper
const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const libraryFixture = {
  categories: [
    {
      category: 'ADLs',
      items: [
        { id: 1, name: 'Dressing', description: 'Fasteners, sequencing', isCustom: false, isActive: true, sortOrder: 1, overrideId: null },
        { id: 2, name: 'Hidden default', description: null, isCustom: false, isActive: false, sortOrder: 2, overrideId: 40 },
        { id: 10, name: 'Custom feeding routine', description: null, isCustom: true, isActive: true, sortOrder: 9999, overrideId: null },
      ],
    },
    {
      category: 'Sensory',
      items: [
        { id: 3, name: 'Sensory Swing', description: null, isCustom: false, isActive: true, sortOrder: 1, overrideId: null },
      ],
    },
  ],
};

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });

function renderPage() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <InterventionsLibrary />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: GET returns the fixture; writes echo back an object.
  mockApiRequest.mockImplementation(async (method: string) => ({
    json: async () => (method === 'GET' ? libraryFixture : { id: 99 }),
  }));
});

describe('Interventions Library page', () => {
  it('renders categories with system and custom items distinguished', async () => {
    renderPage();

    expect(await screen.findByText('ADLs')).toBeInTheDocument();
    expect(screen.getByText('Sensory')).toBeInTheDocument();
    expect(screen.getByText('Dressing')).toBeInTheDocument();
    expect(screen.getByText('Custom feeding routine')).toBeInTheDocument();

    // Badges: 3 system items, 1 custom.
    expect(screen.getAllByText('System')).toHaveLength(3);
    expect(screen.getAllByText('Custom')).toHaveLength(1);

    // System items get a visibility switch, not edit/delete.
    expect(screen.getByTestId('switch-system-1')).toBeInTheDocument();
    expect(screen.queryByTestId('button-edit-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-delete-1')).not.toBeInTheDocument();

    // Hidden system default renders as hidden.
    expect(screen.getByText('Hidden')).toBeInTheDocument();

    // Custom items get edit/delete, not a switch.
    expect(screen.getByTestId('button-edit-10')).toBeInTheDocument();
    expect(screen.getByTestId('button-delete-10')).toBeInTheDocument();
    expect(screen.queryByTestId('switch-system-10')).not.toBeInTheDocument();
  });

  it('adds a custom intervention through the dialog', async () => {
    renderPage();
    await screen.findByText('ADLs');

    fireEvent.click(screen.getByTestId('button-add-intervention'));
    expect(await screen.findByText('Add custom intervention')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('input-name'), {
      target: { value: 'Oral motor exercises' },
    });
    fireEvent.click(screen.getByTestId('button-save-intervention'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        'POST',
        '/api/soap-intervention-templates',
        expect.objectContaining({ category: 'ADLs', name: 'Oral motor exercises' }),
      );
    });
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Intervention added' }),
      );
    });
  });

  it('hides a visible system default via the switch (POSTs a shadow row)', async () => {
    renderPage();
    await screen.findByText('ADLs');

    fireEvent.click(screen.getByTestId('switch-system-1'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        'POST',
        '/api/soap-intervention-templates',
        expect.objectContaining({ category: 'ADLs', name: 'Dressing', isActive: false }),
      );
    });
  });

  it('re-shows a hidden system default by PATCHing its override row', async () => {
    renderPage();
    await screen.findByText('ADLs');

    fireEvent.click(screen.getByTestId('switch-system-2'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        'PATCH',
        '/api/soap-intervention-templates/40',
        expect.objectContaining({ isActive: true }),
      );
    });
  });
});
