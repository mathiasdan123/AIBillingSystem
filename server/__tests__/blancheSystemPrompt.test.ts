import { describe, it, expect } from 'vitest';

vi.mock('../db', () => ({ db: {} }));
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../services/aiLearningService', () => ({}));
vi.mock('../services/practiceContext', () => ({ getUserPracticeContext: vi.fn() }));

import { vi } from 'vitest';
import { buildSystemPrompt } from '../routes/ai-assistant';

describe('buildSystemPrompt', () => {
  it('returns the base prompt unchanged when neither role nor pageContext is supplied', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toMatch(/Your name is Blanche\./);
    expect(prompt).not.toMatch(/## User Context/);
  });

  it('injects an admin-specific opener for role=admin', () => {
    const prompt = buildSystemPrompt({ role: 'admin' });
    expect(prompt).toMatch(/## User Context/);
    expect(prompt).toMatch(/practice ADMIN\/OWNER/);
    // Sanity: still contains base content
    expect(prompt).toMatch(/Your name is Blanche\./);
  });

  it('injects a therapist-specific opener for role=therapist', () => {
    const prompt = buildSystemPrompt({ role: 'therapist' });
    expect(prompt).toMatch(/THERAPIST\/CLINICIAN/);
    expect(prompt).not.toMatch(/practice ADMIN\/OWNER/);
  });

  it('injects a billing-specific opener for role=billing', () => {
    const prompt = buildSystemPrompt({ role: 'billing' });
    expect(prompt).toMatch(/BILLING \/ FRONT-DESK/);
    expect(prompt).not.toMatch(/practice ADMIN\/OWNER/);
    expect(prompt).not.toMatch(/THERAPIST\/CLINICIAN/);
  });

  it('is case-insensitive on role lookup', () => {
    const prompt = buildSystemPrompt({ role: 'ADMIN' });
    expect(prompt).toMatch(/practice ADMIN\/OWNER/);
  });

  it('emits a page-context line when pageContext is supplied', () => {
    const prompt = buildSystemPrompt({
      pageContext: { path: '/patients', title: 'Patients' },
    });
    expect(prompt).toMatch(/## User Context/);
    expect(prompt).toMatch(/Current page: Patients/);
    expect(prompt).toMatch(/\/patients/);
    expect(prompt).toMatch(/what can I do here\?/);
  });

  it('handles partial page context (title only)', () => {
    const prompt = buildSystemPrompt({
      pageContext: { path: null, title: 'SOAP Notes' },
    });
    expect(prompt).toMatch(/Current page: SOAP Notes/);
    // No trailing parens when path is missing
    expect(prompt).not.toMatch(/SOAP Notes \(\)/);
  });

  it('combines role + page context in the same block', () => {
    const prompt = buildSystemPrompt({
      role: 'therapist',
      pageContext: { path: '/calendar', title: 'Calendar' },
    });
    expect(prompt).toMatch(/THERAPIST\/CLINICIAN/);
    expect(prompt).toMatch(/Current page: Calendar/);
  });

  it('ignores an unknown role gracefully (no User Context block from role alone)', () => {
    const prompt = buildSystemPrompt({ role: 'cleaning_staff' });
    expect(prompt).not.toMatch(/## User Context/);
    expect(prompt).toMatch(/Your name is Blanche\./);
  });

  it('removed the hardcoded 5-step list (regression — Blanche must call the tool)', () => {
    // The old prompt enumerated 5 steps inline. Phase 2 moves the truth source
    // to the get_practice_setup_status tool. The base prompt should no longer
    // contain that exact enumeration.
    const prompt = buildSystemPrompt({});
    expect(prompt).not.toMatch(/1\. Add a patient\s*\n.*2\. Schedule a session/s);
    expect(prompt).toMatch(/CALL the get_practice_setup_status tool FIRST/);
  });
});
