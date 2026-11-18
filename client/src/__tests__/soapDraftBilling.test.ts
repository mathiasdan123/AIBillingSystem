/**
 * Draft billing round-trip (QA sweep 2026-11-18): a generated note with
 * 97110 x3 ($300) saved to the draft and restored must come back with the
 * same codes, units, time blocks, rationale and total — not "$0 / 0 units".
 */
import { describe, it, expect } from 'vitest';
import { toDraftBilling, fromDraftBilling, emptyDraftBilling } from '@/lib/soapDraftBilling';

const generated = {
  cptCodes: [
    {
      code: '97110',
      name: 'Therapeutic Exercise',
      units: 3,
      rationale: 'Three 15-minute blocks of strengthening (trampoline).',
      reimbursement: 300,
      activitiesAssigned: ['Trampoline - Strengthening'],
    },
  ],
  activityCptPairings: [
    { activity: 'Trampoline - Strengthening', code: '97110', minutes: 45 } as any,
  ],
  timeBlocks: [
    { blockNumber: 1, startMinute: 0, endMinute: 15, code: '97110', codeName: 'Therapeutic Exercise', rate: 100, activities: ['Trampoline - Strengthening'] },
    { blockNumber: 2, startMinute: 15, endMinute: 30, code: '97110', codeName: 'Therapeutic Exercise', rate: 100, activities: ['Trampoline - Strengthening'] },
    { blockNumber: 3, startMinute: 30, endMinute: 45, code: '97110', codeName: 'Therapeutic Exercise', rate: 100, activities: ['Trampoline - Strengthening'] },
  ],
  billingRationale: '45 minutes of timed therapeutic exercise = 3 units of 97110.',
  auditNotes: ['Units follow the 8-minute rule.'],
  totalReimbursement: 300,
  generationMode: 'ai' as const,
};

describe('soap draft billing round-trip', () => {
  it('restores codes, units, time blocks, rationale and total exactly as saved', () => {
    // Simulate the jsonb column: what goes over the wire is plain JSON.
    const stored = JSON.parse(JSON.stringify(toDraftBilling(generated)));
    const restored = fromDraftBilling(stored);

    expect(restored.cptCodes).toHaveLength(1);
    expect(restored.cptCodes[0]).toMatchObject({ code: '97110', units: 3, reimbursement: 300 });
    expect(restored.timeBlocks).toHaveLength(3);
    expect(restored.activityCptPairings).toHaveLength(1);
    expect(restored.billingRationale).toBe(generated.billingRationale);
    expect(restored.auditNotes).toEqual(generated.auditNotes);
    expect(restored.totalReimbursement).toBe(300);
    expect(restored.generationMode).toBe('ai');

    // The two numbers the QA repro saw reset: units and dollars.
    const units = restored.cptCodes.reduce((n, c) => n + c.units, 0);
    expect(units).toBe(3);
    expect(restored.totalReimbursement).not.toBe(0);
  });

  it('keeps the rule-based fallback flag so the banner still shows after a restore', () => {
    const restored = fromDraftBilling(toDraftBilling({ ...generated, generationMode: 'fallback' }));
    expect(restored.generationMode).toBe('fallback');
  });

  it('treats a draft saved before the billing column existed as empty billing', () => {
    expect(fromDraftBilling(null)).toEqual(emptyDraftBilling());
    expect(fromDraftBilling(undefined)).toEqual(emptyDraftBilling());
  });

  it('never throws on malformed stored JSON and drops entries without a code', () => {
    const restored = fromDraftBilling({
      v: 1,
      cptCodes: [{ units: 2 }, 'nope', { code: '97530', units: 1, name: '', rationale: '', reimbursement: 50 }],
      timeBlocks: 'not-an-array',
      totalReimbursement: 'abc',
      auditNotes: [1, 'kept'],
    });
    expect(restored.cptCodes.map((c) => c.code)).toEqual(['97530']);
    expect(restored.timeBlocks).toEqual([]);
    expect(restored.totalReimbursement).toBe(0);
    expect(restored.auditNotes).toEqual(['kept']);
    expect(fromDraftBilling('garbage')).toEqual(emptyDraftBilling());
    expect(fromDraftBilling([1, 2])).toEqual(emptyDraftBilling());
  });
});
