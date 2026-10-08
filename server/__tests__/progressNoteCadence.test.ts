import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Progress note cadence — due every 10 completed sessions or 90 days,
 * whichever comes first, from the later of plan start / last finalized
 * progress note. Computed at read time; no scheduler.
 */

const mockStorage = vi.hoisted(() => ({
  getActiveTreatmentPlan: vi.fn(),
  getLastFinalizedProgressNote: vi.fn(),
  getFirstCompletedSessionDate: vi.fn(),
  countCompletedSessionsSince: vi.fn(),
}));
vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/activityProgressService', () => ({ getActivityProgress: vi.fn(async () => []) }));
vi.mock('../utils/phiAiGuard', () => ({ assertPhiAiAllowed: vi.fn() }));
vi.mock('../services/aiProvider', () => ({ isAiConfigured: () => false, createAiClient: vi.fn() }));

import { buildGoalEntries, computeCadence, getProgressNoteCadence } from '../services/progressNoteService';

describe('computeCadence (pure math)', () => {
  const base = { today: '2026-10-08', anchorDate: '2026-09-01' };

  it('is NOT due at 9 sessions and under 90 days', () => {
    const c = computeCadence({ ...base, completedSessionsSinceAnchor: 9 });
    expect(c.due).toBe(false);
    expect(c.reason).toBeNull();
    expect(c.sessionsUntilDue).toBe(1);
  });

  it('is due at EXACTLY 10 sessions (boundary)', () => {
    const c = computeCadence({ ...base, completedSessionsSinceAnchor: 10 });
    expect(c.due).toBe(true);
    expect(c.reason).toBe('sessions');
    expect(c.sessionsUntilDue).toBe(0);
  });

  it('is NOT due at 89 days (boundary)', () => {
    const c = computeCadence({ today: '2026-10-08', anchorDate: '2026-07-11', completedSessionsSinceAnchor: 0 });
    expect(c.daysSinceAnchor).toBe(89);
    expect(c.due).toBe(false);
    expect(c.daysUntilDue).toBe(1);
  });

  it('is due at EXACTLY 90 days (boundary) even with few sessions', () => {
    const c = computeCadence({ today: '2026-10-08', anchorDate: '2026-07-10', completedSessionsSinceAnchor: 3 });
    expect(c.daysSinceAnchor).toBe(90);
    expect(c.due).toBe(true);
    expect(c.reason).toBe('days');
  });

  it('whichever comes first: 10 sessions inside 90 days still trips due', () => {
    const c = computeCadence({ today: '2026-10-08', anchorDate: '2026-09-20', completedSessionsSinceAnchor: 11 });
    expect(c.due).toBe(true);
    expect(c.reason).toBe('sessions');
  });

  it('is never due with no anchor at all', () => {
    const c = computeCadence({ today: '2026-10-08', anchorDate: null, completedSessionsSinceAnchor: 0 });
    expect(c.due).toBe(false);
    expect(c.anchorDate).toBeNull();
  });
});

describe('getProgressNoteCadence (anchor resolution)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getActiveTreatmentPlan.mockResolvedValue(undefined);
    mockStorage.getLastFinalizedProgressNote.mockResolvedValue(undefined);
    mockStorage.getFirstCompletedSessionDate.mockResolvedValue(null);
    mockStorage.countCompletedSessionsSince.mockResolvedValue(0);
  });

  it('anchors on plan start when there is no finalized note', async () => {
    mockStorage.getActiveTreatmentPlan.mockResolvedValue({ id: 1, startDate: '2026-08-01' });
    const c = await getProgressNoteCadence(1, 7, '2026-10-08');
    expect(c.anchorDate).toBe('2026-08-01');
    expect(mockStorage.countCompletedSessionsSince).toHaveBeenCalledWith(1, 7, '2026-08-01');
  });

  it('anchors on the LATER of plan start and last finalized note', async () => {
    mockStorage.getActiveTreatmentPlan.mockResolvedValue({ id: 1, startDate: '2026-05-01' });
    mockStorage.getLastFinalizedProgressNote.mockResolvedValue({
      id: 9, windowEnd: '2026-09-15', finalizedAt: new Date('2026-09-16T12:00:00Z'),
    });
    const c = await getProgressNoteCadence(1, 7, '2026-10-08');
    expect(c.anchorDate).toBe('2026-09-15');
  });

  it('falls back to the first completed session for legacy patients with no plan/notes', async () => {
    mockStorage.getFirstCompletedSessionDate.mockResolvedValue('2026-06-01');
    mockStorage.countCompletedSessionsSince.mockResolvedValue(4);
    const c = await getProgressNoteCadence(1, 7, '2026-10-08');
    expect(c.anchorDate).toBe('2026-06-01');
    expect(c.due).toBe(true); // > 90 days
    expect(c.reason).toBe('days');
  });

  it('is not due when there is nothing to anchor on at all', async () => {
    const c = await getProgressNoteCadence(1, 7, '2026-10-08');
    expect(c.due).toBe(false);
    expect(c.anchorDate).toBeNull();
    expect(mockStorage.countCompletedSessionsSince).not.toHaveBeenCalled();
  });
});

describe('buildGoalEntries (legacy-null goal metadata)', () => {
  it('carries term/duration/start through and keeps legacy nulls null — never invented', () => {
    const entries = buildGoalEntries([
      {
        id: 1, description: 'New-style goal', goalTerm: 'short_term', durationWeeks: 12,
        startDate: '2026-09-01', targetDate: '2026-11-24',
      } as any,
      {
        id: 2, description: 'Legacy goal (pre-#377)', goalTerm: null, durationWeeks: null,
        startDate: null, targetDate: null,
      } as any,
    ]);
    expect(entries[0]).toMatchObject({
      goalId: 1, goalTerm: 'short_term', durationWeeks: 12, startDate: '2026-09-01', endDate: '2026-11-24',
    });
    expect(entries[1]).toMatchObject({
      goalId: 2, goalTerm: null, durationWeeks: null, startDate: null, endDate: null,
    });
    // Progress % starts empty everywhere — therapist judgment, never seeded.
    expect(entries.every((e) => e.progressPercent === null)).toBe(true);
  });
});
