import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../services/aiLearningService', () => ({}));

import { rejectIfDemoData, summarizeProposal } from '../routes/ai-assistant';

/**
 * Phase 5 — demo / practice mode.
 *
 * Verifies the guard helper that refuses mutations against demo rows, and
 * the proposal summaries for the two new tools (enable_demo_mode / clear_demo_data).
 * Full create/clear behavior is integration-tested manually on deploy.
 */

describe('rejectIfDemoData', () => {
  it('returns null for a real (non-demo) row, so the caller proceeds', () => {
    expect(rejectIfDemoData({ isDemo: false }, 'patient')).toBeNull();
    expect(rejectIfDemoData({}, 'patient')).toBeNull();
    expect(rejectIfDemoData(null, 'patient')).toBeNull();
    expect(rejectIfDemoData(undefined, 'claim')).toBeNull();
  });

  it('returns a friendly JSON error for a demo row', () => {
    const raw = rejectIfDemoData({ isDemo: true }, 'patient');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.code).toBe('demo_data_refused');
    expect(parsed.error).toMatch(/demo patient/i);
    expect(parsed.error).toMatch(/can't be submitted, sent, or charged/i);
    expect(parsed.error).toMatch(/clear_demo_data/i);
  });

  it("interpolates the 'what' label per resource type", () => {
    const patient = JSON.parse(rejectIfDemoData({ isDemo: true }, 'patient')!);
    const claim = JSON.parse(rejectIfDemoData({ isDemo: true }, 'claim')!);
    const appointment = JSON.parse(rejectIfDemoData({ isDemo: true }, 'appointment')!);
    expect(patient.error).toContain('demo patient');
    expect(claim.error).toContain('demo claim');
    expect(appointment.error).toContain('demo appointment');
  });
});

describe('rejectIfDemoData — error shape contract', () => {
  it('returns parseable JSON with both error and code fields', () => {
    const raw = rejectIfDemoData({ isDemo: true }, 'claim');
    expect(raw).not.toBeNull();
    expect(() => JSON.parse(raw!)).not.toThrow();
    const parsed = JSON.parse(raw!);
    // Contract that the submit/send/charge routes rely on for friendly errors.
    expect(parsed).toHaveProperty('error');
    expect(parsed).toHaveProperty('code', 'demo_data_refused');
  });
});

describe('summarizeProposal — Phase 5 tools', () => {
  it('describes enable_demo_mode with what it will create', () => {
    const summary = summarizeProposal('enable_demo_mode', {});
    expect(summary).toMatch(/demo mode/i);
    expect(summary).toMatch(/5 appointments/);
    expect(summary).toMatch(/5 claims/);
    expect(summary).toMatch(/draft\/submitted\/paid\/denied\/held/);
  });

  it('flags clear_demo_data as irreversible AND explains the 14-day recency filter', () => {
    const summary = summarizeProposal('clear_demo_data', {});
    expect(summary).toMatch(/clear recent demo/i);
    expect(summary).toMatch(/last 14 days/i);
    expect(summary).toMatch(/permanent showcase/i);
    expect(summary).toMatch(/irreversible/i);
  });

  it('describes mark_patients_as_demo with the count and the cascade behavior', () => {
    const one = summarizeProposal('mark_patients_as_demo', { patientIds: [42] });
    const many = summarizeProposal('mark_patients_as_demo', { patientIds: [42, 43, 44] });
    expect(one).toMatch(/1 patient\b/);
    expect(one).toMatch(/cascades/i);
    expect(many).toMatch(/3 patients/);
  });

  it('describes unmark_demo_patients with the count and the reverse cascade', () => {
    const summary = summarizeProposal('unmark_demo_patients', { patientIds: [42, 43] });
    expect(summary).toMatch(/un-mark 2 patients/i);
    expect(summary).toMatch(/real data again/i);
  });

  it('handles empty / missing patientIds without crashing', () => {
    expect(summarizeProposal('mark_patients_as_demo', {})).toMatch(/0 patients/);
    expect(summarizeProposal('unmark_demo_patients', { patientIds: [] })).toMatch(/0 patients/);
  });
});
