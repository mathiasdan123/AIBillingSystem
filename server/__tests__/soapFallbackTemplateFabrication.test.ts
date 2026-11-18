/**
 * Fallback SOAP template: undocumented claims are omitted, the same way the
 * AI path's backstops strip them (therapybill-qa #2 retest, PR #456 fixture).
 *
 * The retest found four fabrication classes in the rule-based template when
 * run for a patient with no plan, no goals, and blank assessment fields:
 *   1. a home-program review that never happened,
 *   2. "current treatment goals" that do not exist,
 *   3. "with assistance" when no assistance level was documented,
 *   4. dangling empty labels ("Assistance level: .", "Strength/endurance: .").
 * These tests pin the omissions, and that documented input still appears.
 */
import { describe, it, expect, vi } from 'vitest';

// fallbackGeneration is pure, but importing the service module pulls in the
// storage layer, which demands a database. Same stub as soapNarrativePrompt.test.ts.
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../utils/phiAiGuard', () => ({ assertPhiAiAllowed: vi.fn() }));

import { fallbackGeneration } from '../services/aiSoapBillingService';

const PATIENT = { firstName: 'Riley', lastName: 'Nodob', dateOfBirth: null };

function request(overrides: Partial<any> = {}) {
  return {
    patientId: 7,
    practiceId: 1,
    activities: ['Trampoline'],
    mood: '',
    duration: 45,
    location: 'Clinic',
    assessment: { performance: '', assistance: '', strength: '', motorPlanning: '', sensoryRegulation: '' },
    planNextSteps: '',
    ...overrides,
  } as any;
}

/**
 * The two shapes an empty field used to render as: "Label: ." (sentence form)
 * and "• Label: " with nothing after it (bullet form). Section headers that
 * legitimately end in a colon before their bullets ("Activities performed:")
 * are not artifacts and are not matched.
 */
const DANGLING_LABEL = /:\s*\.(\s|$)|•\s[^:\n]+:\s*$/m;

describe('fallbackGeneration — blank input, no plan or goals on file (CASE A)', () => {
  const out = fallbackGeneration(request(), PATIENT, 3);
  const all = [out.subjective, out.objective, out.assessment, out.plan].join('\n');

  it('does not fabricate a home-program review; says none was assigned', () => {
    expect(out.plan).not.toMatch(/continuation of current home strategies/i);
    expect(out.plan).toContain('Home program:\n• No home program assigned this session.');
  });

  it('does not assert treatment goals that do not exist', () => {
    expect(out.plan).not.toMatch(/treatment goals/i);
    expect(out.plan).not.toMatch(/plan of care/i);
  });

  it('does not assert an assistance level that was not documented', () => {
    expect(out.assessment).not.toMatch(/with\s+assistance/i);
    expect(out.assessment).not.toMatch(/with\s+\w*\s*assistance/i);
    expect(out.objective).not.toMatch(/Assistance level/);
    expect(out.assessment).toContain('Riley participated in skilled occupational therapy.');
  });

  it('renders no dangling empty labels anywhere in the note', () => {
    expect(all).not.toMatch(DANGLING_LABEL);
    expect(out.objective).not.toMatch(/Overall performance:|Strength\/endurance:|Motor planning:|Sensory regulation:/);
    expect(out.assessment).not.toMatch(/Functional performance this session/);
    expect(out.objective).toContain('Clinical observations: not documented for this session');
  });

  it('still records what WAS documented: location, duration, units, activities', () => {
    expect(out.objective).toContain('Session conducted in Clinic for 45 minutes (3 billable units).');
    expect(out.objective).toContain('• Trampoline');
  });

  it('omits the next-session subsection when both fields are blank', () => {
    expect(out.plan).not.toMatch(/Next session focus/);
  });
});

describe('fallbackGeneration — documented input appears, in the therapist\'s words', () => {
  it('includes the assistance level, each filled observation, and the home program', () => {
    const out = fallbackGeneration(
      request({
        mood: 'Cooperative',
        assessment: { performance: 'Improved', assistance: 'Minimal', strength: '', motorPlanning: 'Mild difficulty', sensoryRegulation: '' },
        planNextSteps: 'Grade the obstacle course up one level',
        homeProgram: 'Animal walks 5 min daily',
      }),
      PATIENT,
      3,
    );
    expect(out.objective).toContain('Assistance level: Minimal.');
    expect(out.objective).toContain('• Overall performance: Improved');
    expect(out.objective).toContain('• Motor planning: Mild difficulty');
    expect(out.objective).not.toMatch(/Strength\/endurance|Sensory regulation/);
    expect(out.assessment).toContain('presented as cooperative and participated in skilled occupational therapy with minimal assistance.');
    expect(out.assessment).toContain('Functional performance this session: Improved. Motor planning: Mild difficulty.');
    expect(out.plan).toContain('Next session focus:\n• Grade the obstacle course up one level');
    expect(out.plan).toContain('Home program:\n• Animal walks 5 min daily');
    expect([out.objective, out.assessment, out.plan].join('\n')).not.toMatch(DANGLING_LABEL);
  });

  it('asserts medical necessity only when a documented observation shows a deficit', () => {
    const thin = fallbackGeneration(request(), PATIENT, 3);
    expect(thin.assessment).not.toMatch(/medically necessary|Skilled OT was required/);
    const deficit = fallbackGeneration(
      request({ assessment: { performance: '', assistance: '', strength: 'Decreased core strength', motorPlanning: '', sensoryRegulation: '' } }),
      PATIENT,
      3,
    );
    expect(deficit.assessment).toContain('Skilled OT was required');
  });
});

describe('fallbackGeneration — prior plan and goals on file (CASE B)', () => {
  it('may refer to current goals and continue the existing home program', () => {
    const out = fallbackGeneration(request(), PATIENT, 3, { hasPriorPlan: true, hasGoals: true });
    expect(out.plan).toContain('Continue occupational therapy to address current treatment goals.');
    expect(out.plan).toContain('Reviewed continuation of current home strategies; no changes to home program at this time.');
  });

  it('a prior plan without goals continues the home program but names no goals', () => {
    const out = fallbackGeneration(request(), PATIENT, 3, { hasPriorPlan: true, hasGoals: false });
    expect(out.plan).not.toMatch(/treatment goals/i);
    expect(out.plan).toContain('Reviewed continuation of current home strategies');
  });

  it('a typed home program always wins over either default', () => {
    const out = fallbackGeneration(request({ homeProgram: 'Putty squeezes' }), PATIENT, 3, { hasPriorPlan: true, hasGoals: true });
    expect(out.plan).toContain('• Putty squeezes');
    expect(out.plan).not.toMatch(/continuation of current home strategies|No home program assigned/);
  });
});
