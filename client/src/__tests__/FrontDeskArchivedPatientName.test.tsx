/**
 * QA 2026-11-18 (follow-up to #474): while a patient is archived, their
 * appointment on the Front Desk board read "Patient #1" because the page
 * resolved names from the default patient list, which excludes archived
 * patients since #472. The list used for name lookups must include archived
 * patients; the Walk-in dialog's picker must still leave them out (the server
 * refuses an appointment for an archived patient).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => (typeof opts === 'string' ? opts : opts?.defaultValue ?? key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));

import FrontDesk from '../pages/front-desk';

const ARCHIVED_AVA = { id: 1, firstName: 'Ava', lastName: 'Sample', practiceId: 1, archivedAt: '2026-11-18T15:00:00.000Z' };
const ACTIVE_LIAM = { id: 2, firstName: 'Liam', lastName: 'Demo', practiceId: 1, archivedAt: null };

// Checked in, session not started: lands in the "Waiting" column whatever
// the clock says.
const now = new Date();
const AVA_WAITING = {
  id: 1,
  practiceId: 1,
  patientId: 1,
  therapistId: null,
  title: 'Individual Therapy',
  startTime: now.toISOString(),
  endTime: new Date(now.getTime() + 45 * 60_000).toISOString(),
  durationMinutes: 45,
  status: 'scheduled',
  checkedInAt: now.toISOString(),
  sessionStartedAt: null,
  sessionEndedAt: null,
  checkedOutAt: null,
};

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

function renderFrontDesk() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        // front-desk.tsx uses the app's default queryFn for patients and
        // therapists; in the app it joins the key into a URL. Same here.
        queryFn: async ({ queryKey }) => {
          const res = await mockApiRequest('GET', (queryKey as string[]).join(''));
          return res.json();
        },
      },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <FrontDesk />
    </QueryClientProvider>,
  );
}

describe('Front Desk: patient name for an archived patient', () => {
  const patientListRequests: string[] = [];

  beforeEach(() => {
    patientListRequests.length = 0;
    // cmdk scrolls the highlighted item into view; jsdom has no layout.
    Element.prototype.scrollIntoView = vi.fn();
    // Today's appointments are fetched with bare fetch().
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => jsonResponse(url.startsWith('/api/appointments') ? [AVA_WAITING] : [])),
    );
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith('/api/patients')) {
        patientListRequests.push(url);
        // Mirrors the server: archived patients come back only when asked for.
        return jsonResponse(url.includes('archived=include') ? [ARCHIVED_AVA, ACTIVE_LIAM] : [ACTIVE_LIAM]);
      }
      return jsonResponse([]);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('asks for the patient list including archived patients', async () => {
    renderFrontDesk();
    await screen.findByText('Ava Sample');
    expect(patientListRequests.some((u) => u.includes('archived=include'))).toBe(true);
  });

  it("shows the archived patient's real name on the board card, not \"Patient #1\"", async () => {
    renderFrontDesk();
    expect(await screen.findByText('Ava Sample')).toBeInTheDocument();
    expect(screen.queryByText(/Patient #1/)).toBeNull();
    expect(screen.queryByText(/Unknown patient/)).toBeNull();
  });

  it('the Walk-in patient picker still leaves the archived patient out', async () => {
    renderFrontDesk();
    await screen.findByText('Ava Sample');

    fireEvent.click(screen.getByTestId('walk-in-button'));
    // A combobox takes no accessible name from its content, so find the
    // trigger by its placeholder text.
    fireEvent.click((await screen.findByText('Select patient...')).closest('button')!);

    const list = await screen.findByRole('listbox');
    expect(within(list).getByText('Liam Demo')).toBeInTheDocument();
    expect(within(list).queryByText('Ava Sample')).toBeNull();
  });
});
