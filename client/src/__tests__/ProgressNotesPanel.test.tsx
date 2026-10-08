import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * Progress Notes panel (Progress tab) — due indicator, goal table with
 * therapist-entered %, per-goal commentary, extension rationale gating,
 * and the finalized lock.
 */

const mocks = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockApiRequest: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  queryResults: {} as Record<string, any>,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.mockToast }),
}));

vi.mock('@/lib/queryClient', () => ({
  apiRequest: (...args: any[]) => (mocks.mockApiRequest as any)(...args),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (opts: any) => {
      const key = Array.isArray(opts.queryKey) ? opts.queryKey[0] : opts.queryKey;
      return mocks.queryResults[key] ?? { data: undefined, isLoading: false };
    },
    useMutation: (opts: any) => ({
      mutate: vi.fn((arg?: any) => opts.mutationFn?.(arg)),
      isPending: false,
    }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

import ProgressNotesPanel from '../components/ProgressNotesPanel';

const draftNote = {
  id: 50,
  status: 'draft',
  windowStart: '2026-07-01',
  windowEnd: '2026-10-08',
  sessionsReviewed: 10,
  goalEntries: [
    {
      goalId: 1, goalText: 'Fine motor goal', goalTerm: 'short_term', durationWeeks: 12,
      startDate: '2026-07-01', endDate: '2026-09-23', progressPercent: 60,
      interventions: 'Quadrupod grasp facilitation.', assistanceLevels: 'Minimal verbal cues.',
      currentAbility: 'Maintains grasp with set-up.',
    },
    {
      goalId: 2, goalText: 'Legacy goal', goalTerm: null, durationWeeks: null,
      startDate: null, endDate: null, progressPercent: null,
      interventions: '', assistanceLevels: '', currentAbility: '',
    },
  ],
  presentLevel: 'Present level narrative.',
  annualGoals: '1. Fine motor goal',
  recommendations: 'Continue 45-minute sessions 2x weekly.',
  extensionRequested: false,
  extensionNewEndDate: null,
  extensionRationale: null,
  generatedAt: '2026-10-08T12:00:00Z',
  finalizedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryResults = {
    '/api/progress-notes/patient/42': { data: [draftNote], isLoading: false },
    '/api/progress-notes/patient/42/cadence': {
      data: {
        due: true, reason: 'sessions', anchorDate: '2026-07-01',
        completedSessionsSinceAnchor: 10, daysSinceAnchor: 99, sessionsUntilDue: 0, daysUntilDue: 0,
      },
      isLoading: false,
    },
    '/api/progress-notes/50': { data: draftNote, isLoading: false },
  };
});

describe('ProgressNotesPanel', () => {
  it('shows the due indicator when the cadence trips and lists existing notes', () => {
    render(<ProgressNotesPanel patientId={42} />);
    expect(screen.getByTestId('badge-progress-note-due').textContent).toMatch(/Progress note due/i);
    expect(screen.getByTestId('badge-progress-note-due').textContent).toMatch(/10 sessions/);
    expect(screen.getByTestId('row-progress-note-50')).toBeInTheDocument();
    expect(screen.getByTestId('button-start-progress-note')).toBeInTheDocument();
    // Compliance framing: therapist reviews and approves; % is their judgment.
    expect(screen.getByTestId('progress-notes-panel').textContent).toMatch(/reviews, edits, and approves/i);
  });

  it('shows the countdown instead of the due badge when not yet due', () => {
    mocks.queryResults['/api/progress-notes/patient/42/cadence'] = {
      data: {
        due: false, reason: null, anchorDate: '2026-09-20',
        completedSessionsSinceAnchor: 4, daysSinceAnchor: 18, sessionsUntilDue: 6, daysUntilDue: 72,
      },
      isLoading: false,
    };
    render(<ProgressNotesPanel patientId={42} />);
    expect(screen.queryByTestId('badge-progress-note-due')).not.toBeInTheDocument();
    expect(screen.getByTestId('text-progress-note-countdown').textContent).toMatch(/6 sessions or 72 days/);
  });

  it('opens the editor with the goal table (legacy nulls as dashes) and per-goal commentary', () => {
    render(<ProgressNotesPanel patientId={42} />);
    fireEvent.click(screen.getByTestId('button-open-progress-note-50'));
    expect(screen.getByTestId('progress-note-editor')).toBeInTheDocument();
    // Goal table rows
    expect(screen.getByTestId('row-goal-1').textContent).toContain('Fine motor goal');
    expect(screen.getByTestId('row-goal-1').textContent).toContain('Short Term');
    // Legacy goal: metadata shows as em dashes, never invented
    expect(screen.getByTestId('row-goal-2').textContent).toContain('—');
    // Therapist-entered % inputs
    expect(screen.getByTestId('input-progress-percent-1')).toHaveValue(60);
    expect(screen.getByTestId('input-progress-percent-2')).toHaveValue(null);
    // Per-goal commentary textareas
    expect(screen.getByTestId('textarea-interventions-1')).toHaveValue('Quadrupod grasp facilitation.');
    expect(screen.getByTestId('textarea-assistanceLevels-1')).toHaveValue('Minimal verbal cues.');
    expect(screen.getByTestId('textarea-currentAbility-1')).toHaveValue('Maintains grasp with set-up.');
    // Narrative sections
    expect(screen.getByTestId('textarea-note-presentLevel')).toHaveValue('Present level narrative.');
    expect(screen.getByTestId('textarea-note-annualGoals')).toBeInTheDocument();
    expect(screen.getByTestId('textarea-note-recommendations')).toBeInTheDocument();
    expect(screen.getByTestId('button-finalize-progress-note')).toBeInTheDocument();
  });

  it('reveals the REQUIRED rationale box when the plan extension is selected', () => {
    render(<ProgressNotesPanel patientId={42} />);
    fireEvent.click(screen.getByTestId('button-open-progress-note-50'));
    expect(screen.queryByTestId('textarea-extension-rationale')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('checkbox-extension-requested'));
    expect(screen.getByTestId('textarea-extension-rationale')).toBeInTheDocument();
    expect(screen.getByTestId('input-extension-end-date')).toBeInTheDocument();
    // The rationale is framed as required medical-necessity documentation.
    expect(screen.getByTestId('progress-note-editor').textContent).toMatch(/medically necessary/i);
  });

  it('locks a finalized note: no editing controls, finalized badge shown', () => {
    const finalized = { ...draftNote, status: 'finalized', finalizedAt: '2026-10-08T15:00:00Z' };
    mocks.queryResults['/api/progress-notes/patient/42'] = { data: [finalized], isLoading: false };
    mocks.queryResults['/api/progress-notes/50'] = { data: finalized, isLoading: false };
    render(<ProgressNotesPanel patientId={42} />);
    fireEvent.click(screen.getByTestId('button-open-progress-note-50'));
    expect(screen.queryByTestId('button-finalize-progress-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-generate-progress-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-save-progress-note')).not.toBeInTheDocument();
    // Percent renders as text, not an input
    expect(screen.queryByTestId('input-progress-percent-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('row-goal-1').textContent).toContain('60%');
  });
});
