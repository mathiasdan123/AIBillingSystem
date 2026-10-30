import { describe, expect, it, vi } from 'vitest';

// The service module imports the storage layer (which demands DATABASE_URL at
// import time); the function under test never touches it.
vi.mock('../storage', () => ({ storage: {} }));

import { stripUnsupportedPlanClosing } from '../services/aiSoapBillingService';

// Deterministic backstop for a fabrication that recurred three times despite
// prompt-level prohibition across #421-#424: a generic "[Patient] will
// continue to benefit from/participate in skilled occupational therapy to
// address identified deficits..." closing sentence in CASE A (no prior plan,
// no active treatment goals), where there's nothing to ground that claim in.
describe('stripUnsupportedPlanClosing', () => {
  const noPlanContext = false;
  const noGoalsContext = false;

  it('strips the exact fabricated sentences confirmed in production testing', () => {
    const cases = [
      'Next session will focus on bilateral coordination. No home program assigned this session. Patient will continue to benefit from skilled occupational therapy services to address identified deficits in endurance, motor planning, and bilateral coordination supporting functional participation in age-appropriate activities.',
      "Next session will focus on bilateral coordination. No home program assigned this session. Sofia will continue to participate in skilled occupational therapy services to address identified areas of need through graded therapeutic activities and neuromuscular re-education.",
      'Next session will focus on bilateral coordination. No home program assigned this session. Patient will continue to participate in skilled occupational therapy to address identified deficits in strength, endurance, bilateral coordination, and sustained attention through graded therapeutic activities and neuromuscular re-education.',
    ];
    for (const plan of cases) {
      const stripped = stripUnsupportedPlanClosing(plan, noPlanContext, noGoalsContext);
      expect(stripped).not.toMatch(/skilled/i);
      expect(stripped).not.toMatch(/continue to (benefit from|participate in)/i);
      expect(stripped).toContain('Next session will focus on bilateral coordination.');
      expect(stripped).toContain('No home program assigned this session.');
    }
  });

  it('does not touch legitimate CASE A content', () => {
    const legitimate = [
      'Continue current treatment frequency.',
      'No home program assigned this session.',
      'Next session will focus on bilateral coordination and sustained attention through graded therapeutic activities.',
    ];
    for (const plan of legitimate) {
      expect(stripUnsupportedPlanClosing(plan, noPlanContext, noGoalsContext)).toBe(plan);
    }
  });

  it('does not touch legitimate CASE B (carry-forward) content, even with similar vocabulary', () => {
    const planWithContext =
      'Current plan remains appropriate; no changes recommended. Continue OT 2x/week focusing on bilateral coordination. Treatment frequency: Continue current treatment frequency.';
    expect(stripUnsupportedPlanClosing(planWithContext, true, false)).toBe(planWithContext);
    expect(stripUnsupportedPlanClosing(planWithContext, false, true)).toBe(planWithContext);
  });

  it('leaves the plan untouched when there is no match', () => {
    const plan = 'Goals: Improve bilateral coordination for ball skills.';
    expect(stripUnsupportedPlanClosing(plan, noPlanContext, noGoalsContext)).toBe(plan);
  });

  it('handles empty input', () => {
    expect(stripUnsupportedPlanClosing('', noPlanContext, noGoalsContext)).toBe('');
  });
});
