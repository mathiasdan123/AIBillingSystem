import { describe, it, expect } from 'vitest';
import { needsTransmissionEvidence, transmissionEvidence } from '../services/claimTransmissionEvidence';

describe('transmissionEvidence', () => {
  const none = { status: 'held', submittedAt: null, clearinghouseSubmittedAt: null, clearinghouseClaimId: null };
  it('a claim with no submitted timestamp, no clearinghouse attempt and no submitted event was never sent', () => {
    expect(transmissionEvidence(none)).toEqual({ transmitted: false, signal: null });
    expect(transmissionEvidence(none, [{ eventType: 'denied' }])).toEqual({ transmitted: false, signal: null });
  });
  it('any one signal is enough', () => {
    expect(transmissionEvidence({ ...none, submittedAt: new Date() }).signal).toBe('submitted_at');
    expect(transmissionEvidence({ ...none, clearinghouseSubmittedAt: '2026-11-18T15:00:00Z' }).signal).toBe('clearinghouse_attempt');
    expect(transmissionEvidence({ ...none, clearinghouseClaimId: 'STEDI-1' }).signal).toBe('clearinghouse_attempt');
    expect(transmissionEvidence(none, [{ eventType: 'submitted' }]).signal).toBe('submitted_event');
  });
  it('only draft and held need evidence', () => {
    expect(needsTransmissionEvidence('draft')).toBe(true);
    expect(needsTransmissionEvidence('held')).toBe(true);
    for (const s of ['submitted', 'paid', 'partial', 'denied', 'appeal']) expect(needsTransmissionEvidence(s)).toBe(false);
  });
});
