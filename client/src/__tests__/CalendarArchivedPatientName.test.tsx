/**
 * QA 2026-11-18 (follow-up to #474): while a patient is archived, their
 * existing appointments on the Calendar read "Patient" / "Appointment"
 * because the page resolved names from the default patient list, which
 * excludes archived patients since #472. The list used for name lookups must
 * include archived patients; the New Appointment picker must still leave
 * them out (the server refuses an appointment for an archived patient).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', practiceId: 1, role: 'admin' },
    isAuthenticated: true,
    isLoading: false,
    isAdmin: true,
    hasFinancialAccess: true,
  }),
}));
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

import CalendarPage from '../pages/calendar';

// 8:00 AM Eastern on Wed 2026-11-18; the appointment below is 9:00 AM.
const NOW = new Date('2026-11-18T13:00:00.000Z');

const ARCHIVED_AVA = { id: 1, firstName: 'Ava', lastName: 'Sample', practiceId: 1, archivedAt: '2026-11-18T15:00:00.000Z' };
const ACTIVE_LIAM = { id: 2, firstName: 'Liam', lastName: 'Demo', practiceId: 1, archivedAt: null };

const AVA_APPOINTMENT = {
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

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

function renderCalendar() {
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
  return render(
    <QueryClientProvider client={qc}>
      <CalendarPage />
    </QueryClientProvider>,
  );
}

describe('Calendar: patient name for an archived patient', () => {
  const patientListRequests: string[] = [];

  beforeEach(() => {
    patientListRequests.length = 0;
    // cmdk scrolls the highlighted item into view; jsdom has no layout.
    Element.prototype.scrollIntoView = vi.fn();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    // calendar.tsx fetches /api/locations with bare fetch().
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith('/api/patients')) {
        patientListRequests.push(url);
        // Mirrors the server: archived patients come back only when asked for.
        return jsonResponse(url.includes('archived=include') ? [ARCHIVED_AVA, ACTIVE_LIAM] : [ACTIVE_LIAM]);
      }
      if (url.startsWith('/api/appointments')) return jsonResponse([AVA_APPOINTMENT]);
      if (url.startsWith('/api/therapists')) return jsonResponse([]);
      return jsonResponse([]);
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('asks for the patient list including archived patients', async () => {
    renderCalendar();
    await screen.findByTestId('appointment-row-1');
    expect(patientListRequests.some((u) => u.includes('archived=include'))).toBe(true);
  });

  it("shows the archived patient's real name on the appointment, not a placeholder", async () => {
    renderCalendar();
    const row = await screen.findByTestId('appointment-row-1');
    expect(row).toHaveTextContent('Ava Sample');
    expect(screen.getByTestId('grid-cell-appointment-1')).toHaveTextContent('Ava Sample');
    expect(screen.queryByText(/Unknown/)).toBeNull();
  });

  it('the New Appointment patient picker still leaves the archived patient out', async () => {
    renderCalendar();
    await screen.findByTestId('appointment-row-1');

    const buttons = await screen.findAllByRole('button', { name: /new appointment/i });
    fireEvent.click(buttons[0]);
    const picker = await screen.findByTestId('button-patient-picker');
    // Only the active patient counts as pickable.
    expect(picker).toHaveTextContent('(1 available)');

    fireEvent.click(picker);
    const list = await screen.findByRole('listbox');
    expect(within(list).getByText('Liam Demo')).toBeInTheDocument();
    expect(within(list).queryByText('Ava Sample')).toBeNull();
  });
});
