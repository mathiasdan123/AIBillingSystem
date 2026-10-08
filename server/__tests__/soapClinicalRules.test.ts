import { describe, expect, it, vi } from 'vitest';

vi.mock('../storage', () => ({ storage: {} }));

import { buildSystemPrompt } from '../services/aiSoapBillingService';

describe('buildSystemPrompt — clinician-authored writing rules', () => {
  const prompt = buildSystemPrompt(null);

  it('frames the AI as a clinical editor, not an autonomous writer', () => {
    expect(prompt).toContain('CLINICAL EDITOR AND REASONING ASSISTANT');
    expect(prompt).toContain('flag possible changes rather than making unsupported decisions');
  });

  it('carries the clinician rule set', () => {
    expect(prompt).toContain('CLINICAL WRITING RULES');
    expect(prompt).toContain('PRESERVE QUANTITATIVE DATA EXACTLY');
    expect(prompt).toContain('NO VAGUE FILLER');
    expect(prompt).toContain('DO NOT OVERSTATE CAUSATION');
    expect(prompt).toContain('ESTABLISHED CONCEPTS ONLY');
    expect(prompt).toContain('NEVER change treatment frequency or duration');
    expect(prompt).toContain('FLAG the conflict in auditNotes');
  });

  it('includes the Objective statement hierarchy with the never-example', () => {
    expect(prompt).toContain('OBJECTIVE STATEMENT HIERARCHY');
    expect(prompt).toContain('Did scooter board and had fun');
  });

  it('pins the per-activity CPT pairing rules (conservative 97530 default, therapist decides)', () => {
    expect(prompt).toContain('PER-ACTIVITY CPT PAIRING (CONSERVATIVE)');
    expect(prompt).toContain('suggest EXACTLY ONE CPT code for EACH');
    // Kelli's conservatism: unclear activity ⇒ 97530 Therapeutic Activities.
    expect(prompt).toContain('suggest 97530');
    expect(prompt).toContain('Therapeutic Activities is the defensible conservative choice');
    // Suggestions never final — accuracy framing, therapist makes every decision.
    expect(prompt).toContain('never final');
    expect(prompt).toContain('makes every\n  coding decision');
  });

  it('pins the goals-are-context-not-content grounding charter', () => {
    expect(prompt).toContain('TREATMENT GOALS ARE CONTEXT, NOT CONTENT');
    expect(prompt).toContain('NEVER claim progress toward a goal');
    expect(prompt).toContain('Goals never supply\n   observations');
  });
});
