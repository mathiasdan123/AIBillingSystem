import { describe, expect, it } from 'vitest';
import { parsePlanSuggestion } from '@/lib/planSuggestion';

describe('parsePlanSuggestion', () => {
  it('splits the suggestion paragraph from the carried-forward plan', () => {
    const plan =
      'Suggested update: Add increased focus on bilateral coordination. Increased difficulty was observed during ball activities today.\n\nContinue skilled OT 1x45 min/week addressing motor planning and postural control.\n\nHome program unchanged.';
    const r = parsePlanSuggestion(plan)!;
    expect(r.suggestion).toContain('Suggested update: Add increased focus on bilateral coordination.');
    expect(r.suggestion).not.toContain('Continue skilled OT');
    expect(r.remainder).toContain('Continue skilled OT 1x45 min/week');
    expect(r.remainder).toContain('Home program unchanged.');
  });

  it('is case-insensitive on the prefix and tolerates leading whitespace', () => {
    expect(parsePlanSuggestion('  suggested update: X.\n\nRest.')).not.toBeNull();
  });

  it('returns null for a no-change plan', () => {
    expect(parsePlanSuggestion('Current plan remains appropriate; no changes recommended.\n\nContinue current frequency.')).toBeNull();
    expect(parsePlanSuggestion('')).toBeNull();
    expect(parsePlanSuggestion(undefined)).toBeNull();
  });

  it('handles a suggestion with no remainder', () => {
    const r = parsePlanSuggestion('Suggested update: only this.')!;
    expect(r.suggestion).toBe('Suggested update: only this.');
    expect(r.remainder).toBe('');
  });
});
