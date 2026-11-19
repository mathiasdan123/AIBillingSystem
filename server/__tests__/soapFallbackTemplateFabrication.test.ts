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
    expect(out.assessment).toContain('Riley attended a 45-minute occupational therapy session.');
    expect(out.assessment).not.toMatch(/Assistance level/);
  });

  it('renders no dangling empty labels anywhere in the note', () => {
    expect(all).not.toMatch(DANGLING_LABEL);
    expect(out.objective).not.toMatch(/Overall performance:|Strength\/endurance:|Motor planning:|Sensory regulation:/);
    expect(out.assessment).not.toMatch(/Functional performance this session/);
    expect(out.objective).toContain('Clinical observations: none entered for this session');
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
    expect(out.assessment).toContain('Riley attended a 45-minute occupational therapy session. Riley presented as cooperative. Assistance level documented: minimal.');
    expect(out.assessment).toContain('Functional performance this session: Improved. Motor planning: Mild difficulty.');
    expect(out.plan).toContain('Next session focus:\n• Grade the obstacle course up one level');
    expect(out.plan).toContain('Home program:\n• Animal walks 5 min daily');
    expect([out.objective, out.assessment, out.plan].join('\n')).not.toMatch(DANGLING_LABEL);
  });

  it('asserts medical necessity only when a documented observation shows a deficit', () => {
    const thin = fallbackGeneration(request(), PATIENT, 3);
    expect(thin.assessment).not.toMatch(/medically necessary|addressed|indicated|skilled/i);
    const deficit = fallbackGeneration(
      request({ assessment: { performance: '', assistance: '', strength: 'Decreased core strength', motorPlanning: '', sensoryRegulation: '' } }),
      PATIENT,
      3,
    );
    expect(deficit.assessment).toContain(
      'Continued skilled occupational therapy is indicated to address the deficits documented above (strength/endurance: decreased core strength).',
    );
    // Names only the rated deficits; never says what the therapy "addressed".
    expect(deficit.assessment).not.toMatch(/addressed|support(?:ing|ed)? safer/i);
  });
});

/**
 * QA sweep 2026-11-18 (Riley Nodob, forceFallback): thin input with ONE
 * activity account -- "five sets of ten jumps, one-minute pauses, no pain" --
 * and every rating blank. The template (a) dropped the account and said no
 * observations were documented beyond the activity list, and (b) asserted
 * "skilled clinical analysis and therapist-directed adaptation were
 * provided" with nothing entered to support either half.
 */
describe('fallbackGeneration — activity account passthrough and no unsupported skilled-service claims', () => {
  const RILEY_THIN = request({
    activities: ['Trampoline - Strengthening'],
    activityDetails: [{ name: 'Trampoline - Strengthening', response: 'five sets of ten jumps, one-minute pauses, no pain' }],
    nextSessionFocus: 'reassess jumping endurance',
  });
  const out = fallbackGeneration(RILEY_THIN, PATIENT, 3);

  it('carries the entered account into the Objective, verbatim, under its activity', () => {
    expect(out.objective).toContain("• Trampoline - Strengthening\n  Therapist's account: five sets of ten jumps, one-minute pauses, no pain");
  });

  it('does not claim observations were not documented when an account was entered', () => {
    expect(out.objective).not.toMatch(/Clinical observations:/);
    expect(out.objective).not.toMatch(/not documented|none entered/i);
  });

  it('does not assert skilled analysis or therapist-directed adaptation with no supporting input', () => {
    expect(out.assessment).toBe('Riley attended a 45-minute occupational therapy session.');
    // "skilled" appears only in the deficit-gated continuation sentence, never unconditionally.
    expect(out.assessment).not.toMatch(/skilled/i);
    expect(out.assessment).not.toMatch(/skilled clinical analysis|therapist-directed|adaptation|graded|monitored/i);
  });

  it('asserts no negative finding the account did not state, in any section', () => {
    const all = [out.subjective, out.objective, out.assessment, out.plan].join('\n');
    expect(all).not.toMatch(/distress|standardized|without (signs|difficulty)|tolerated/i);
    // The one negative the therapist DID write survives, in their words.
    expect(out.objective).toContain('no pain');
  });

  it('still carries the plan field the therapist typed', () => {
    expect(out.plan).toContain('Next session focus:\n• reassess jumping endurance');
  });

  it('never writes a skilled-analysis / therapist-directed-adaptation sentence, whatever was entered (no field records it)', () => {
    const ratingsOnly = fallbackGeneration(
      request({ assessment: { performance: 'Improved', assistance: '', strength: '', motorPlanning: '', sensoryRegulation: '' } }),
      PATIENT, 3,
    );
    expect(ratingsOnly.assessment).not.toMatch(/skilled clinical analysis|therapist-directed|adaptation/i);
    // The entered rating itself still appears.
    expect(ratingsOnly.assessment).toContain('Functional performance this session: Improved.');

    const assistOnly = fallbackGeneration(
      request({ assessment: { performance: '', assistance: 'Minimal', strength: '', motorPlanning: '', sensoryRegulation: '' } }),
      PATIENT, 3,
    );
    expect(assistOnly.assessment).not.toMatch(/skilled clinical analysis|therapist-directed|adaptation/i);
    expect(assistOnly.assessment).toContain('Assistance level documented: minimal.');
    expect(assistOnly.assessment).not.toMatch(/skilled/i);
    expect(assistOnly.objective).toContain('Assistance level: Minimal.');
  });

  it('Objective carries the per-exercise narrative AND the entered assistance level together', () => {
    const out = fallbackGeneration(
      request({
        activities: ['Trampoline - Strengthening', 'Thera-Putty - Strengthening'],
        activityDetails: [
          { name: 'Trampoline - Strengthening', response: 'five sets of ten jumps, one-minute pauses, no pain' },
          { name: 'Thera-Putty - Strengthening', response: 'two minutes of pinching, switched hands' },
        ],
        assessment: { performance: '', assistance: 'Supervision', strength: '', motorPlanning: '', sensoryRegulation: '' },
      }),
      PATIENT, 3,
    );
    expect(out.objective).toContain("• Trampoline - Strengthening\n  Therapist's account: five sets of ten jumps, one-minute pauses, no pain");
    expect(out.objective).toContain("• Thera-Putty - Strengthening\n  Therapist's account: two minutes of pinching, switched hands");
    expect(out.objective).toContain('Assistance level: Supervision.');
  });

  it('necessity paragraph (only with a rated deficit) does not claim the therapist graded or adapted anything', () => {
    const out = fallbackGeneration(
      request({ assessment: { performance: '', assistance: '', strength: 'poor endurance', motorPlanning: '', sensoryRegulation: '' } }),
      PATIENT, 3,
    );
    expect(out.assessment).toContain('Continued skilled occupational therapy is indicated to address the deficits documented above (strength/endurance: poor endurance).');
    expect(out.assessment).not.toMatch(/grade|adapt|monitor|cue|addressed/i);
    // And no necessity paragraph at all without a rated deficit.
    expect(fallbackGeneration(RILEY_THIN, PATIENT, 3).assessment).not.toMatch(/necessity|indicated|required/i);
  });

  it('an activity without an account still renders as a plain bullet', () => {
    const mixed = fallbackGeneration(
      request({
        activities: ['Trampoline - Strengthening', 'Pegboard'],
        activityDetails: [{ name: 'Trampoline - Strengthening', response: 'five sets of ten jumps' }],
      }),
      PATIENT, 3,
    );
    expect(mixed.objective).toContain("• Trampoline - Strengthening\n  Therapist's account: five sets of ten jumps\n• Pegboard");
  });
});

/**
 * Post-deploy retest of #464 (2026-11-18): "Minimal Assist" selected via
 * Apply to All / per exercise reached neither path. The route now carries
 * per-activity ratings in activityDetails and derives the global; the
 * template must print both.
 */
describe('fallbackGeneration — assistance level reaches the Objective', () => {
  it('prints a per-activity assistance level under its activity', () => {
    const out = fallbackGeneration(
      request({
        activities: ['Trampoline - Strengthening'],
        activityDetails: [{ name: 'Trampoline - Strengthening', response: 'five sets of ten jumps', assistance: 'Minimal Assist' }],
      }),
      PATIENT, 3,
    );
    expect(out.objective).toContain("• Trampoline - Strengthening\n  Therapist's account: five sets of ten jumps\n  Assistance: Minimal Assist");
  });

  it('prints the global assistance level (as derived by the route from Apply to All) as the session line', () => {
    const out = fallbackGeneration(
      request({
        activities: ['Trampoline - Strengthening'],
        activityDetails: [{ name: 'Trampoline - Strengthening', assistance: 'Minimal Assist', performance: 'Improved' }],
        assessment: { performance: '', assistance: 'Minimal Assist', strength: '', motorPlanning: '', sensoryRegulation: '' },
      }),
      PATIENT, 3,
    );
    expect(out.objective).toContain('Assistance level: Minimal Assist.');
    expect(out.objective).toContain('  Assistance: Minimal Assist; Performance: Improved');
    expect(out.objective).not.toMatch(/none entered/);
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

/**
 * QA follow-up 2026-11-18: (1) the fallback picked 97112 for "Trampoline -
 * Strengthening" because the keyword pass matched the noun before the
 * category, while the AI path keys off the entered category (→ 97110);
 * (2) the Audit Support lines ("Documentation supports assigned CPT codes",
 * "Activities match code descriptions") and the 97112 rationale ("targeting
 * postural control, balance, and motor planning") asserted a review and a
 * clinical objective nobody entered.
 */
describe('fallbackGeneration — CPT code from the entered activity category, neutral billing text', () => {
  const codeFor = (activity: string) =>
    fallbackGeneration(request({ activities: [activity] }), PATIENT, 3).activityCptPairings[0];

  it('Trampoline - Strengthening → 97110 Therapeutic Exercise (category beats the "trampoline" keyword), matching the AI path', () => {
    const p = codeFor('Trampoline - Strengthening');
    expect(p.code).toBe('97110');
    expect(p.name).toBe('Therapeutic Exercise');
    expect(p.rationale).toContain('"Strengthening"');
  });

  it('maps the other picker categories: Balance/Coordination/Motor Planning → 97112, Functional/ADL → 97530', () => {
    expect(codeFor('Platform Swing - Balance').code).toBe('97112');
    expect(codeFor('Scooter Board - Coordination').code).toBe('97112');
    expect(codeFor('Obstacle Course - Motor Planning').code).toBe('97112');
    expect(codeFor('Pegboard - Functional').code).toBe('97530');
    expect(codeFor('Dressing Practice - ADL').code).toBe('97530');
    expect(codeFor('Thera-Putty - Hand Strength / Endurance').code).toBe('97110');
  });

  it('falls back to the activity-name keyword when no category was entered, then to the conservative default', () => {
    const bare = codeFor('Trampoline');
    expect(bare.code).toBe('97112');
    expect(bare.rationale).toContain('no category was entered');
    const unknown = codeFor('Board game');
    expect(unknown.code).toBe('97530');
    expect(unknown.source).toBe('default');
  });

  it('aggregate codes follow the pairings, so the thin Riley note bills 97110 only', () => {
    const out = fallbackGeneration(
      request({
        activities: ['Trampoline - Strengthening'],
        activityDetails: [{ name: 'Trampoline - Strengthening', response: 'five sets of ten jumps, one-minute pauses, no pain' }],
      }),
      PATIENT, 3,
    );
    expect(out.cptCodes.map((c) => c.code)).toEqual(['97110']);
    expect(out.cptCodes[0].units).toBe(3);
    expect(out.timeBlocks.every((b) => b.code === '97110')).toBe(true);
  });

  it('audit notes and rationales never claim a documentation review or an undocumented clinical objective', () => {
    const out = fallbackGeneration(
      request({ activities: ['Trampoline - Strengthening', 'Platform Swing - Balance', 'Pegboard - Functional'] }),
      PATIENT, 3,
    );
    const billingText = [out.billingRationale, ...out.auditNotes, ...out.cptCodes.map((c) => c.rationale), ...out.activityCptPairings.map((p) => p.rationale)].join('\n');
    expect(billingText).not.toMatch(/documentation supports|activities match|targeting|postural control|supports assigned/i);
    expect(billingText).not.toMatch(/accuracy checks/i);
    expect(out.auditNotes).toEqual([
      'Codes were suggested by rule-based mapping from the entered activity categories and names; this is not a review of the documentation.',
      'Units derived from the documented session duration: 45 minutes → 3 timed unit(s).',
    ]);
    // Every rationale is suggestion-framed for provider review.
    for (const r of [out.billingRationale, ...out.cptCodes.map((c) => c.rationale), ...out.activityCptPairings.map((p) => p.rationale)]) {
      expect(r).toMatch(/treating provider makes the final coding decision/);
    }
  });
});
