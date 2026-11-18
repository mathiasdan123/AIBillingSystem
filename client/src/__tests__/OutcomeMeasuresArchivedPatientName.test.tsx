/**
 * QA 2026-11-18 (follow-up to #474): while a patient is archived, their
 * assessment history on Outcome Measures was unreachable: the one patient
 * selector drew from the default patient list, which excludes archived
 * patients since #472, so the patient could not be chosen and a remembered
 * selection read "Choose a patient...". That selector picks whose HISTORY to
 * view as much as whom to assess next, so it must include archived patients
 * (labelled). Recording a NEW assessment for one is refused instead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: (...args: any[]) => mockToast(...args) }) }));
const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));

import OutcomeMeasures from '../pages/outcome-measures';

const ARCHIVED_AVA = { id: 1, firstName: 'Ava', lastName: 'Sample', practiceId: 1, archivedAt: '2026-11-18T15:00:00.000Z' };
const ACTIVE_LIAM = { id: 2, firstName: 'Liam', lastName: 'Demo', practiceId: 1, archivedAt: null };

const TEMPLATE = {
  id: 7,
  name: 'Peabody Developmental Motor Scales',
  abbreviation: 'PDMS-2',
  description: 'Motor development',
  category: 'Motor Development',
  questions: [{ id: 1, text: 'Stationary', options: [{ value: 0, label: '0' }, { value: 1, label: '1' }] }],
  scoringRanges: [{ min: 0, max: 1, label: 'Typical', severity: 'minimal' }],
  maxScore: 1,
  isActive: true,
};

const AVA_ASSESSMENT = {
  id: 11,
  patientId: 1,
  templateId: 7,
  totalScore: 1,
  maxScore: 1,
  responses: { 1: 1 },
  assessmentDate: '2026-11-03T14:00:00.000Z',
};

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

function renderPage() {
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
      <OutcomeMeasures />
    </QueryClientProvider>,
  );
}

const activateTab = async (name: RegExp) => {
  const tab = await screen.findByRole('tab', { name });
  // Radix tabs activate on mousedown.
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
};

describe('Outcome Measures: archived patient history', () => {
  const patientListRequests: string[] = [];

  beforeEach(() => {
    patientListRequests.length = 0;
    // cmdk scrolls the highlighted item into view; jsdom has no layout.
    Element.prototype.scrollIntoView = vi.fn();
    // Templates and the patient list go through the default queryFn; the
    // per-patient history queries use bare fetch().
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith('/api/patients')) {
        patientListRequests.push(url);
        // Mirrors the server: archived patients come back only when asked for.
        return jsonResponse(url.includes('archived=include') ? [ARCHIVED_AVA, ACTIVE_LIAM] : [ACTIVE_LIAM]);
      }
      if (url.startsWith('/api/outcome-measures/templates')) return jsonResponse([TEMPLATE]);
      return jsonResponse([]);
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/patients/1/assessments') return jsonResponse([AVA_ASSESSMENT]);
        if (url.startsWith('/api/patients/1/assessments/trends')) return jsonResponse({ assessments: [], trends: [] });
        return jsonResponse([]);
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const openSelector = async () => {
    // A combobox takes no accessible name from its content, so find the
    // trigger by its placeholder text.
    fireEvent.click((await screen.findByText('Search or type patient name...')).closest('button')!);
    return screen.findByRole('listbox');
  };

  it('asks for the patient list including archived patients', async () => {
    renderPage();
    await openSelector();
    expect(patientListRequests.some((u) => u.includes('archived=include'))).toBe(true);
  });

  it('lists the archived patient (labelled) next to active ones, so their history can be opened', async () => {
    renderPage();
    const list = await openSelector();
    expect(within(list).getByText('Liam Demo')).toBeInTheDocument();
    const ava = within(list).getByText('Ava Sample');
    expect(ava.closest('[cmdk-item]')).toHaveTextContent('(archived)');
  });

  it("selecting the archived patient shows their name and their history, not \"Choose a patient...\"", async () => {
    renderPage();
    const list = await openSelector();
    fireEvent.click(within(list).getByText('Ava Sample'));

    // The popover closes on select, so the only "Ava Sample" left is the trigger.
    const picker = (await screen.findByText('Ava Sample')).closest('button')!;
    expect(picker).toHaveAttribute('role', 'combobox');
    expect(picker).not.toHaveTextContent('Choose a patient');

    await activateTab(/history/i);
    expect(await screen.findByText(/PDMS-2 - Peabody Developmental Motor Scales/)).toBeInTheDocument();
    expect(screen.queryByText(/No assessments recorded/)).toBeNull();
  });

  it('refuses to start a NEW assessment for the archived patient, with a toast', async () => {
    renderPage();
    const list = await openSelector();
    fireEvent.click(within(list).getByText('Ava Sample'));
    await screen.findByText('Ava Sample');

    fireEvent.click(screen.getByRole('button', { name: /start assessment/i }));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Patient is archived' }));
    // The questionnaire dialog never opened.
    expect(screen.queryByText('Stationary')).toBeNull();

    mockToast.mockClear();
    fireEvent.click(screen.getByTestId('button-start-pdms2-workflow'));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Patient is archived' }));
  });
});
