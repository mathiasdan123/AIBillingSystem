import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockApiRequest: vi.fn(async () => ({ json: async () => ({}) })),
  queryResults: {} as Record<string, any>,
  mockSetLocation: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.mockToast }),
}));

vi.mock('@/lib/queryClient', () => ({
  apiRequest: (...args: any[]) => (mocks.mockApiRequest as any)(...args),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/evaluations/5', mocks.mockSetLocation],
  useRoute: () => [true, { id: '5' }],
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
      mutate: vi.fn(() => opts.mutationFn?.()),
      isPending: false,
    }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

import InitialEvaluationPage from '../pages/initial-evaluation';

const evaluation = {
  id: 5,
  patientId: 42,
  status: 'composed',
  evaluationDate: '2026-10-01',
  personalInfo: { childName: 'Avery T.', primaryDiagnosis: 'DCD' },
  healthHistory: { developmentalMilestones: 'Walked at 18 months' },
  caregiverConcerns: { primaryConcerns: 'Dressing and handwriting' },
  subjectiveComments: 'Parent reports frustration.',
  objectiveActivities: 'Sock donning with moderate assist.',
  assessmentResults: 'PDMS-2 administered.',
  skillAreas: 'Fine motor, self-care',
  aiWriteUp: {
    patientHistory: 'History text',
    reasonForEvaluation: 'Referral text',
    observations: 'Observation text',
    assessmentResults: 'Results text',
    proposedPlanOfCare: 'Plan narrative',
    goals: 'Goals narrative',
  },
  proposedPlan: {
    sessionsPerWeek: 2,
    durationWeeks: 24,
    startDate: '2026-10-08',
    endDate: '2027-03-25',
    rationale: 'Documented deficits support 2x/week.',
    status: 'proposed',
  },
  proposedGoals: [
    {
      skillArea: 'fine motor control',
      goalText: 'Patient will improve fine motor control ... in 3/4 trials to improve independence with pre-writing skills.',
      term: 'short_term',
      durationWeeks: 12,
      startDate: '2026-10-08',
      endDate: '2026-12-31',
      rationale: 'Observed grasp + parent concerns.',
      status: 'proposed',
    },
  ],
  treatmentPlanId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryResults['/api/evaluations/5'] = { data: evaluation, isLoading: false };
});

describe('InitialEvaluationPage', () => {
  it('renders the sectioned eval form with the AI-review disclaimer', () => {
    render(<InitialEvaluationPage />);
    expect(screen.getByTestId('initial-evaluation-page')).toBeInTheDocument();
    // The therapist-in-control framing is visible
    expect(screen.getByTestId('ai-disclaimer').textContent).toMatch(/review, edit, and approve/i);
    expect(screen.getByTestId('ai-disclaimer').textContent).toMatch(/assists with documentation accuracy/i);
    // All four input stages render
    expect(screen.getByTestId('section-personal-info')).toBeInTheDocument();
    expect(screen.getByTestId('section-health-history')).toBeInTheDocument();
    expect(screen.getByTestId('section-caregiver-concerns')).toBeInTheDocument();
    expect(screen.getByTestId('section-free-text')).toBeInTheDocument();
    // Prefilled personal info is populated and editable
    expect(screen.getByTestId('input-personal-childName')).toHaveValue('Avery T.');
  });

  it('shows the editable write-up and the Accept/Edit/Reject proposal cards', () => {
    render(<InitialEvaluationPage />);
    expect(screen.getByTestId('section-write-up')).toBeInTheDocument();
    expect(screen.getByTestId('write-up-observations')).toHaveValue('Observation text');
    // Plan proposal card with its decision buttons
    expect(screen.getByTestId('plan-card')).toBeInTheDocument();
    expect(screen.getByTestId('plan-summary').textContent).toContain('2x per week for 24 weeks');
    expect(screen.getByTestId('button-accept-plan')).toBeInTheDocument();
    expect(screen.getByTestId('button-reject-plan')).toBeInTheDocument();
    // Goal proposal card
    expect(screen.getByTestId('goal-card-0')).toBeInTheDocument();
    expect(screen.getByTestId('goal-text-0').textContent).toContain('improve independence with pre-writing skills');
    expect(screen.getByTestId('button-accept-goal-0')).toBeInTheDocument();
    expect(screen.getByTestId('button-edit-goal-0')).toBeInTheDocument();
    expect(screen.getByTestId('button-reject-goal-0')).toBeInTheDocument();
  });

  it('locks the form once finalized (no compose/save/decision buttons)', () => {
    mocks.queryResults['/api/evaluations/5'] = {
      data: { ...evaluation, status: 'finalized' },
      isLoading: false,
    };
    render(<InitialEvaluationPage />);
    expect(screen.getByTestId('evaluation-status').textContent).toMatch(/finalized/i);
    expect(screen.queryByTestId('button-compose')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-finalize')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-accept-goal-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('input-personal-childName')).toBeDisabled();
  });
});
