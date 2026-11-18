/**
 * Regression: an appointment saved at 9:00 AM local must render at 9:00 AM
 * everywhere it is shown — the calendar day/week grid, the Today's and
 * Upcoming lists on the calendar page, and the patient-details banner.
 *
 * QA sweep 2026-11-18: the dialog stores the instant correctly (9:00 AM
 * Eastern → 14:00Z) and the patient banner formatted it locally (9:00 AM),
 * but the calendar grid and lists read `getUTCHours()` and drew 2:00 PM for
 * the same row. The browser zone in the report was America/New_York, so the
 * client suite is pinned to it in vitest.config.client.ts (a TZ assignment
 * inside a test file is ignored off the main thread), and the first test
 * asserts the pin took before anything else.
 *
 * Also covers the therapist picker in the same dialog: pre-selects the
 * logged-in therapist, and explains itself when the practice has no
 * therapist users instead of silently saving an unassigned appointment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));
vi.mock('@/lib/authUtils', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  isUnauthorizedError: vi.fn(() => false),
}));

// Insurance sub-sections of the patient-details dialog each fetch their own
// data in shapes this test does not model (one iterates a list, one expects
// an object). They are not under test; a generic stub keeps a shape mismatch
// in one of them from unmounting the dialog whose banner IS under test.
// (vi.mock is hoisted above every other statement, so each factory inlines
// its stub rather than sharing a top-level one.)
vi.mock('@/components/PriorAuthorizationsSection', () => ({ default: () => null }));
vi.mock('@/components/InsuranceDocumentsSection', () => ({ default: () => null }));
vi.mock('@/components/BenefitsVerificationCard', () => ({ default: () => null }));
vi.mock('@/components/CoordinationOfBenefitsCard', () => ({ default: () => null }));
vi.mock('@/components/BenefitsSummary', () => ({ default: () => null }));
vi.mock('@/components/PatientInsuranceData/CostEstimationCard', () => ({ default: () => null }));

import CalendarPage from '../pages/calendar';
import Patients from '../pages/patients';

// 8:00 AM Eastern on Wed 2026-11-18 (EST, UTC-5). Early enough that a 9:00 AM
// appointment is both "today" and "upcoming".
const NOW = new Date('2026-11-18T13:00:00.000Z');

// What the dialog sends for "2026-11-18, 9:00 AM, 45 min" in New York:
// new Date('2026-11-18T09:00:00').toISOString() === '2026-11-18T14:00:00.000Z'.
const NINE_AM = {
  id: 1,
  practiceId: 1,
  patientId: 1,
  therapistId: null,
  title: 'Individual Therapy',
  startTime: '2026-11-18T14:00:00.000Z',
  endTime: '2026-11-18T14:45:00.000Z',
  durationMinutes: 45,
  status: 'scheduled',
};
// 8:00 PM Eastern the same evening = 01:00Z on the 19th. Under the old UTC
// date matching this fell into Thursday; it belongs to Wednesday's "Today".
const EIGHT_PM = {
  ...NINE_AM,
  id: 2,
  startTime: '2026-11-19T01:00:00.000Z',
  endTime: '2026-11-19T01:45:00.000Z',
};
const PATIENT = { id: 1, firstName: 'Riley', lastName: 'Nodob', practiceId: 1 };

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

function routeApi(opts: { appointments: any[]; therapists?: any[] }) {
  mockApiRequest.mockImplementation(async (_method: string, url: string) => {
    if (url.startsWith('/api/appointments')) return jsonResponse(opts.appointments);
    if (url.startsWith('/api/patients')) return jsonResponse([PATIENT]);
    if (url.startsWith('/api/therapists')) return jsonResponse(opts.therapists ?? []);
    if (url.startsWith('/api/booking/appointment-types')) return jsonResponse([]);
    return jsonResponse({});
  });
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        // The calendar's appointments query has no queryFn of its own; in the
        // app the shared queryClient joins the key into a URL and fetches it.
        // Do the same here, through the one mock every request goes to.
        queryFn: async ({ queryKey }) => {
          const res = await mockApiRequest('GET', (queryKey as string[]).join(''));
          return res.json();
        },
      },
    },
  });
  queryClient.setQueryData(['/api/patients'], [PATIENT]);
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

describe('appointment times render as the entered local time (America/New_York)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', practiceId: 1, role: 'admin' },
      isAuthenticated: true,
      isLoading: false,
      isAdmin: true,
      hasFinancialAccess: true,
    });
    // calendar.tsx fetches /api/locations with bare fetch().
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('the test process really is in America/New_York (otherwise nothing below proves anything)', () => {
    expect(new Date(NINE_AM.startTime).getHours()).toBe(9);
    expect(new Date(NINE_AM.startTime).getUTCHours()).toBe(14);
  });

  it('calendar grid block, Today\'s list and Upcoming list all show 9:00 AM, never 2:00 PM', async () => {
    routeApi({ appointments: [NINE_AM, EIGHT_PM] });

    render(<CalendarPage />, { wrapper: createWrapper() });

    // Day/week grid block: text and vertical placement (grid starts at 8 AM,
    // 64px per hour → 9:00 is 64px down, 45 min is 48px tall).
    const grid = await screen.findByTestId('grid-cell-appointment-1');
    expect(grid).toHaveTextContent('9:00 AM');
    expect(grid.style.top).toBe('64px');
    expect(grid.style.height).toBe('48px');

    // Mobile day/week list.
    expect(screen.getByTestId('appointment-cell-1')).toHaveTextContent('9:00 AM - 9:45 AM');

    // Today's Appointments (check-in dashboard).
    expect(screen.getByTestId('appointment-row-1')).toHaveTextContent('9:00 AM - 9:45 AM');

    // Upcoming Appointments card.
    const upcomingTitle = screen.getByText('Upcoming Appointments');
    const upcomingCard = upcomingTitle.closest('[class*="rounded"]') as HTMLElement;
    expect(upcomingCard).not.toBeNull();
    expect(within(upcomingCard).getByText(/at 9:00 AM - 9:45 AM/)).toBeInTheDocument();

    // The 5-hour-shifted rendering must be gone from every surface.
    expect(screen.queryByText(/2:00 PM/)).toBeNull();
    expect(screen.queryByText(/2:45 PM/)).toBeNull();
  });

  it('an 8:00 PM appointment stays on today, not tomorrow (UTC date was the 19th)', async () => {
    routeApi({ appointments: [NINE_AM, EIGHT_PM] });

    render(<CalendarPage />, { wrapper: createWrapper() });

    await screen.findByTestId('appointment-row-1');
    const lateRow = screen.getByTestId('appointment-row-2');
    expect(lateRow).toHaveTextContent('8:00 PM - 8:45 PM');
    // Under the old getUTCHours() it read 1:00 AM.
    expect(screen.queryByText(/1:00 AM/)).toBeNull();
  });

  it('patient details banner shows "Next: Today at 9:00 AM" for the same row', async () => {
    routeApi({ appointments: [NINE_AM] });

    render(<Patients />, { wrapper: createWrapper() });

    const viewDetails = await screen.findAllByRole('button', { name: /view details/i });
    fireEvent.click(viewDetails[0]);

    expect(await screen.findByText(/Next: Today at 9:00 AM/)).toBeInTheDocument();
    expect(screen.queryByText(/2:00 PM/)).toBeNull();
  });
});

describe('New Appointment dialog therapist picker', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const openDialog = async () => {
    const buttons = await screen.findAllByRole('button', { name: /new appointment/i });
    fireEvent.click(buttons[0]);
    return screen.findByTestId('select-therapist');
  };

  it('pre-selects the logged-in user when they are a therapist in the practice', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'therapist-7', practiceId: 1, role: 'therapist' },
      isAuthenticated: true, isLoading: false, isAdmin: false, hasFinancialAccess: false,
    });
    routeApi({
      appointments: [],
      therapists: [
        { id: 'therapist-7', firstName: 'Maya', lastName: 'Chen' },
        { id: 'therapist-8', firstName: 'Sam', lastName: 'Ortiz' },
      ],
    });

    render(<CalendarPage />, { wrapper: createWrapper() });
    const trigger = await openDialog();

    expect(trigger).toHaveTextContent('Maya Chen');
    expect(screen.queryByTestId('therapist-empty-hint')).toBeNull();
  });

  it('pre-selects the only therapist when the admin scheduling is not one', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'admin-1', practiceId: 1, role: 'admin' },
      isAuthenticated: true, isLoading: false, isAdmin: true, hasFinancialAccess: true,
    });
    routeApi({ appointments: [], therapists: [{ id: 'therapist-7', firstName: 'Maya', lastName: 'Chen' }] });

    render(<CalendarPage />, { wrapper: createWrapper() });
    const trigger = await openDialog();

    expect(trigger).toHaveTextContent('Maya Chen');
  });

  it('says so, and disables the picker, when the practice has no therapist users', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'admin-1', practiceId: 1, role: 'admin' },
      isAuthenticated: true, isLoading: false, isAdmin: true, hasFinancialAccess: true,
    });
    routeApi({ appointments: [], therapists: [] });

    render(<CalendarPage />, { wrapper: createWrapper() });
    const trigger = await openDialog();

    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent('No therapists available');
    expect(await screen.findByTestId('therapist-empty-hint')).toHaveTextContent(/saved without one/);
  });
});
