import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Pdms2ScoringWorkflow from '../components/pdms2/Pdms2ScoringWorkflow';

/**
 * PDMS-2 structured scoring workflow tests
 *
 * - Keyboard item entry (0/1/2) drives live basal/ceiling indicators and the
 *   credited raw score.
 * - Manual standard-score entry shows the descriptive band and feeds the
 *   quotient lookup sums; the Examiner's Manual labeling is present.
 * - Save POSTs the entered scores; narrative drafting saves first, then
 *   requests a draft the therapist can edit.
 */

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });

function renderWorkflow(props: Partial<React.ComponentProps<typeof Pdms2ScoringWorkflow>> = {}) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Pdms2ScoringWorkflow patientId={1} patientName="Avery Kim" onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

function typeScore(testid: string, key: string) {
  fireEvent.keyDown(screen.getByTestId(testid), { key });
}

// Radix TabsTrigger activates on mousedown, not click.
function clickTab(testid: string) {
  const trigger = screen.getByTestId(testid);
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.click(trigger);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApiRequest.mockImplementation(async (_method: string, url: string) => ({
    json: async () =>
      url.endsWith('/narrative')
        ? { narrative: 'Drafted summary of entered scores.' }
        : { id: 42 },
  }));
});

describe('PDMS-2 scoring workflow', () => {
  it('shows the Examiner\'s Manual copyright framing and age entry', () => {
    renderWorkflow();
    expect(screen.getByTestId('pdms2-manual-notice').textContent).toMatch(
      /your own PDMS-2 Examiner's Manual/,
    );
    expect(screen.getByTestId('pdms2-manual-notice').textContent).toMatch(
      /does not contain or reproduce them/,
    );
    expect(screen.getByTestId('input-pdms2-age')).toBeInTheDocument();
  });

  it('detects basal and ceiling live and computes the credited raw score', () => {
    renderWorkflow();
    fireEvent.change(screen.getByTestId('input-pdms2-age'), { target: { value: '30' } });

    // Stationary tab is the default. Entry point at item 5.
    typeScore('pdms2-item-stationary-5', '2');
    typeScore('pdms2-item-stationary-6', '2');

    // Two consecutive 2s: no basal yet.
    expect(screen.getByTestId('pdms2-basal-stationary').textContent).toMatch(/No basal yet/);

    typeScore('pdms2-item-stationary-7', '2');

    // Basal at item 5 — items 1-4 auto-credited (+8).
    expect(screen.getByTestId('pdms2-basal-stationary').textContent).toMatch(
      /Basal established at item 5/,
    );
    expect(screen.getByTestId('pdms2-raw-stationary').textContent).toBe('14');

    typeScore('pdms2-item-stationary-8', '1');
    typeScore('pdms2-item-stationary-9', '0');
    typeScore('pdms2-item-stationary-10', '0');

    expect(screen.getByTestId('pdms2-ceiling-stationary').textContent).toMatch(/No ceiling yet/);

    typeScore('pdms2-item-stationary-11', '0');

    expect(screen.getByTestId('pdms2-ceiling-stationary').textContent).toMatch(
      /Ceiling reached at item 11 — subtest complete/,
    );
    // Raw: 8 credits + 2+2+2+1+0+0+0 = 15
    expect(screen.getByTestId('pdms2-raw-stationary').textContent).toBe('15');
  });

  it('labels manual entries as manual lookups, shows the band, and builds quotient sums', () => {
    renderWorkflow();
    fireEvent.change(screen.getByTestId('input-pdms2-age'), { target: { value: '30' } });

    // Standard score entered from the therapist's own normative tables.
    expect(screen.getAllByText(/From your PDMS-2 Examiner's Manual/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByTestId('input-pdms2-ss-stationary'), { target: { value: '7' } });
    expect(screen.getByTestId('pdms2-band-stationary').textContent).toBe('Below Average');

    // At 30 months the GMQ sum awaits Locomotion + Object Manipulation (not Reflexes).
    expect(screen.getByTestId('pdms2-sum-gmq').textContent).toMatch(
      /Awaiting standard scores for: Locomotion, Object Manipulation/,
    );

    // Fill the fine-motor subtests via their tabs.
    clickTab('tab-pdms2-grasping');
    fireEvent.change(screen.getByTestId('input-pdms2-ss-grasping'), { target: { value: '8' } });
    clickTab('tab-pdms2-visualMotor');
    fireEvent.change(screen.getByTestId('input-pdms2-ss-visualMotor'), { target: { value: '11' } });

    expect(screen.getByTestId('pdms2-sum-fmq').textContent).toMatch(
      /Sum of standard scores to look up: 19/,
    );

    // Quotient entered manually gets its descriptive band.
    fireEvent.change(screen.getByTestId('input-pdms2-fmq'), { target: { value: '97' } });
    expect(screen.getByTestId('pdms2-band-fmq').textContent).toBe('Average');
  });

  it('warns when Reflexes is scored for a child over 12 months', () => {
    renderWorkflow();
    fireEvent.change(screen.getByTestId('input-pdms2-age'), { target: { value: '24' } });
    clickTab('tab-pdms2-reflexes');
    typeScore('pdms2-item-reflexes-1', '2');
    expect(screen.getByTestId('pdms2-age-warning-reflexes').textContent).toMatch(
      /first year of life/,
    );
  });

  it('saves the assessment with the entered item scores', async () => {
    renderWorkflow();
    fireEvent.change(screen.getByTestId('input-pdms2-age'), { target: { value: '30' } });
    typeScore('pdms2-item-stationary-5', '2');
    typeScore('pdms2-item-stationary-6', '2');
    typeScore('pdms2-item-stationary-7', '2');

    fireEvent.click(screen.getByTestId('button-pdms2-save'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        'POST',
        '/api/pdms2-assessments',
        expect.objectContaining({
          patientId: 1,
          ageInMonths: 30,
          subtests: expect.objectContaining({
            stationary: expect.objectContaining({
              itemScores: { '5': 2, '6': 2, '7': 2 },
            }),
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'PDMS-2 Assessment Saved' }),
      );
    });
  });

  it('drafts the narrative via the AI endpoint and places it in the editable field', async () => {
    renderWorkflow();
    fireEvent.change(screen.getByTestId('input-pdms2-age'), { target: { value: '30' } });
    typeScore('pdms2-item-stationary-5', '2');

    fireEvent.click(screen.getByTestId('button-pdms2-generate-narrative'));

    // New assessment: saved first, then the narrative draft is requested.
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('POST', '/api/pdms2-assessments', expect.anything());
      expect(mockApiRequest).toHaveBeenCalledWith('POST', '/api/pdms2-assessments/42/narrative', {});
    });
    await waitFor(() => {
      expect(screen.getByTestId('input-pdms2-narrative')).toHaveValue(
        'Drafted summary of entered scores.',
      );
    });
  });

  it('loads an existing assessment for editing', () => {
    renderWorkflow({
      existing: {
        id: 7,
        patientId: 1,
        ageInMonths: 18,
        subtests: {
          stationary: { itemScores: { '1': 2, '2': 2, '3': 2 }, standardScore: 9 },
        },
        grossMotorQuotient: 91,
        narrative: 'Existing narrative.',
      },
    });
    expect(screen.getByTestId('input-pdms2-age')).toHaveValue('18');
    expect(screen.getByTestId('pdms2-raw-stationary').textContent).toBe('6');
    expect(screen.getByTestId('input-pdms2-narrative')).toHaveValue('Existing narrative.');
    expect(screen.getByTestId('pdms2-band-gmq').textContent).toBe('Average');
  });
});
