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
  interviewOutline: {
    sections: [
      {
        key: 'patientHistory',
        title: 'Patient history',
        questions: [{ question: 'How did feeding go in the first year?', notes: '' }],
      },
      {
        key: 'referralInformation',
        title: 'Referral information',
        questions: [{ question: 'What prompted the referral?', notes: '' }],
      },
      {
        key: 'parentConcerns',
        title: 'Parent concerns',
        questions: [{ question: 'Which routines are hardest?', notes: 'Mornings — dressing.' }],
      },
    ],
    generatedAt: '2026-10-07T12:00:00.000Z',
  },
  proposedPlan: {
    sessionsPerWeek: 2,
    sessionLengthMinutes: 45,
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
      term: 'long_term',
      durationWeeks: 26,
      startDate: '2026-10-08',
      endDate: '2027-04-08',
      rationale: 'Observed grasp + parent concerns.',
      status: 'proposed',
      pairIndex: 0,
    },
    {
      skillArea: 'fine motor control',
      goalText: 'Patient will improve fine motor control ... with moderate cues in 2/4 trials to improve independence with pre-writing skills.',
      term: 'short_term',
      durationWeeks: 12,
      startDate: '2026-10-08',
      endDate: '2026-12-31',
      rationale: 'Steps the long-term goal down with more support and fewer trials.',
      status: 'proposed',
      pairIndex: 0,
    },
  ],
  evalCodeSuggestion: {
    code: '97166',
    rationale: 'Documented caregiver concerns and dressing/fine-motor observations reflect moderate complexity.',
    suggestedAt: '2026-10-08T12:00:00.000Z',
  },
  evalCodeFinal: null,
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

  it('renders the plan card constrained to Wonder Kids reality (45-minute 1:1 sessions)', () => {
    render(<InitialEvaluationPage />);
    expect(screen.getByTestId('plan-title').textContent).toContain('45-minute individual (1:1) sessions');
    // The proposal card explains the constraint set the AI works within.
    expect(screen.getByTestId('section-proposals').textContent).toMatch(/45-minute individual \(1:1\)\s*sessions, 1x or 2x weekly/);
    expect(screen.getByTestId('section-proposals').textContent).toMatch(/6-month default/);
  });

  it('renders goal pairs visually linked by skill area with an accept-pair convenience', () => {
    render(<InitialEvaluationPage />);
    // Pair wrapper groups both halves under the shared underlying skill
    expect(screen.getByTestId('goal-pair-0')).toBeInTheDocument();
    expect(screen.getByTestId('goal-pair-skill-0').textContent).toContain('fine motor control');
    expect(screen.getByTestId('goal-pair-skill-0').textContent).toMatch(/Long-term goal \+ short-term step-down/);
    // Both goal cards render inside the pair, per-goal decisions intact
    expect(screen.getByTestId('goal-card-0')).toBeInTheDocument();
    expect(screen.getByTestId('goal-card-1')).toBeInTheDocument();
    expect(screen.getByTestId('button-accept-goal-0')).toBeInTheDocument();
    expect(screen.getByTestId('button-reject-goal-1')).toBeInTheDocument();
    // Accept-pair convenience when both halves are still proposed
    expect(screen.getByTestId('button-accept-pair-0')).toBeInTheDocument();
  });

  it('hides accept-pair once a half of the pair has been decided', () => {
    const decided = JSON.parse(JSON.stringify(evaluation));
    decided.proposedGoals[1].status = 'rejected';
    mocks.queryResults['/api/evaluations/5'] = { data: decided, isLoading: false };
    render(<InitialEvaluationPage />);
    expect(screen.queryByTestId('button-accept-pair-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-accept-goal-0')).toBeInTheDocument();
  });

  it('renders the editable parent interview outline with per-question notes', () => {
    render(<InitialEvaluationPage />);
    expect(screen.getByTestId('section-interview-outline')).toBeInTheDocument();
    // Drafted from intake, grounds the subjective write-up — framing visible
    expect(screen.getByTestId('section-interview-outline').textContent).toMatch(/intake data/i);
    expect(screen.getByTestId('section-interview-outline').textContent).toMatch(/subjective narrative/i);
    // The three fixed sections with editable questions and captured notes
    expect(screen.getByTestId('outline-section-patientHistory')).toBeInTheDocument();
    expect(screen.getByTestId('outline-section-referralInformation')).toBeInTheDocument();
    expect(screen.getByTestId('outline-section-parentConcerns')).toBeInTheDocument();
    expect(screen.getByTestId('outline-question-patientHistory-0')).toHaveValue('How did feeding go in the first year?');
    expect(screen.getByTestId('outline-notes-parentConcerns-0')).toHaveValue('Mornings — dressing.');
    expect(screen.getByTestId('button-draft-outline')).toBeInTheDocument();
    expect(screen.getByTestId('button-save-outline')).toBeInTheDocument();
  });

  it('shows the suggested evaluation code with accuracy framing and a therapist-decided selector', () => {
    render(<InitialEvaluationPage />);
    expect(screen.getByTestId('section-eval-code')).toBeInTheDocument();
    expect(screen.getByTestId('eval-code-suggested').textContent).toContain('97166');
    expect(screen.getByTestId('eval-code-rationale').textContent).toContain('moderate complexity');
    // Compliance framing: suggestion for accuracy, provider decides; claims wiring is a follow-up
    const framing = screen.getByTestId('section-eval-code').textContent ?? '';
    expect(framing).toMatch(/billing accuracy/i);
    expect(framing).toMatch(/reviewed and approved by the treating\s*provider/i);
    expect(framing).toMatch(/not yet applied to claims/i);
    expect(screen.getByTestId('select-eval-code')).toBeInTheDocument();
    expect(screen.getByTestId('button-suggest-eval-code')).toBeInTheDocument();
    expect(screen.getByTestId('button-save-eval-code')).toBeInTheDocument();
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
    expect(screen.queryByTestId('button-accept-pair-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-draft-outline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-save-outline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-suggest-eval-code')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-save-eval-code')).not.toBeInTheDocument();
    expect(screen.getByTestId('input-personal-childName')).toBeDisabled();
    expect(screen.getByTestId('outline-notes-parentConcerns-0')).toBeDisabled();
  });
});
