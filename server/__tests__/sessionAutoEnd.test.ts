/**
 * Sessions close themselves at their scheduled end.
 *
 * Requiring the front desk to click "End session" at the right moment meant
 * sessions sat open whenever the desk was busy — which is most of the time —
 * distorting the in-session board and wait-time analytics and leaving visits
 * looking unfinished.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: {}, getDb: () => ({}) }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { expectedSessionEnd, DEFAULT_SESSION_MINUTES } from '../services/sessionAutoEndService';

const at = (iso: string) => new Date(iso);

describe('expectedSessionEnd', () => {
  it('defaults to 45 minutes when the appointment has no usable duration', () => {
    expect(DEFAULT_SESSION_MINUTES).toBe(45);

    const end = expectedSessionEnd({ sessionStartedAt: at('2026-08-24T14:00:00Z') });
    expect(end.toISOString()).toBe('2026-08-24T14:45:00.000Z');
  });

  it('uses the scheduled LENGTH applied to the real start, so a late start is not cut short', () => {
    // Scheduled 09:00-09:45, but the session actually began at 09:20.
    const end = expectedSessionEnd({
      sessionStartedAt: at('2026-08-24T09:20:00Z'),
      startTime: at('2026-08-24T09:00:00Z'),
      endTime: at('2026-08-24T09:45:00Z'),
    });

    // Full 45 minutes from when it started — not the 09:45 scheduled end,
    // which would have given the patient 25 minutes.
    expect(end.toISOString()).toBe('2026-08-24T10:05:00.000Z');
  });

  it('honors a non-standard scheduled length', () => {
    const end = expectedSessionEnd({
      sessionStartedAt: at('2026-08-24T14:00:00Z'),
      startTime: at('2026-08-24T14:00:00Z'),
      endTime: at('2026-08-24T15:30:00Z'), // 90-minute eval
    });
    expect(end.toISOString()).toBe('2026-08-24T15:30:00.000Z');
  });

  it('ignores a zero or inverted duration rather than closing the session instantly', () => {
    const zero = expectedSessionEnd({
      sessionStartedAt: at('2026-08-24T14:00:00Z'),
      startTime: at('2026-08-24T14:00:00Z'),
      endTime: at('2026-08-24T14:00:00Z'),
    });
    expect(zero.toISOString()).toBe('2026-08-24T14:45:00.000Z');

    const inverted = expectedSessionEnd({
      sessionStartedAt: at('2026-08-24T14:00:00Z'),
      startTime: at('2026-08-24T15:00:00Z'),
      endTime: at('2026-08-24T14:00:00Z'),
    });
    expect(inverted.toISOString()).toBe('2026-08-24T14:45:00.000Z');
  });

  it('ignores an all-day block rather than holding a session open for days', () => {
    const end = expectedSessionEnd({
      sessionStartedAt: at('2026-08-24T14:00:00Z'),
      startTime: at('2026-08-24T00:00:00Z'),
      endTime: at('2026-08-25T00:00:00Z'), // 24h
    });
    expect(end.toISOString()).toBe('2026-08-24T14:45:00.000Z');
  });
});
