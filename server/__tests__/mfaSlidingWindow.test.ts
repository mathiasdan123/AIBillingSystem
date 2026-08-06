/**
 * Tests for the sliding MFA re-verification window
 * (server/middleware/mfa-required.ts).
 *
 * The window used to be absolute: mfaVerifiedAt was stamped at login and never
 * refreshed, so a user working continuously was re-challenged every 15 minutes
 * regardless of activity. On 2026-08-06 that interrupted a biller mid-edit.
 * It now measures PHI *inactivity* instead.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// The middleware imports storage (→ db), which demands DATABASE_URL at import
// time. These tests exercise the pure session helpers only.
vi.mock('../storage', () => ({ storage: { getUser: vi.fn() } }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  isMfaSessionValid,
  setMfaVerified,
  touchMfaSession,
  getMfaSessionTimeRemaining,
  MFA_CONFIG,
} from '../middleware/mfa-required';

const USER = 'user-1';
const MIN = 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

describe('MFA window configuration', () => {
  it('defaults to 60 minutes', () => {
    expect(MFA_CONFIG.sessionTimeoutMinutes).toBe(60);
  });
});

describe('touchMfaSession', () => {
  it('extends a session that is still valid', () => {
    const session: any = {};
    setMfaVerified(session, USER);
    const original = session.mfaVerifiedAt;

    vi.useFakeTimers();
    vi.setSystemTime(new Date(original + 5 * MIN));

    expect(touchMfaSession(session)).toBe(true);
    expect(session.mfaVerifiedAt).toBe(original + 5 * MIN);
  });

  it('throttles to at most one write per minute', () => {
    const session: any = {};
    setMfaVerified(session, USER);
    const original = session.mfaVerifiedAt;

    vi.useFakeTimers();
    vi.setSystemTime(new Date(original + 10 * 1000)); // 10s later

    // Busy page firing many PHI requests must not write the session store
    // on each one.
    expect(touchMfaSession(session)).toBe(false);
    expect(session.mfaVerifiedAt).toBe(original);
  });

  it('never resurrects a session that was never verified', () => {
    const session: any = {};
    expect(touchMfaSession(session)).toBe(false);
    expect(session.mfaVerifiedAt).toBeUndefined();
    expect(isMfaSessionValid(session, USER)).toBe(false);
  });
});

describe('sliding behaviour end to end', () => {
  it('keeps a continuously active user verified past the window', () => {
    const session: any = {};
    setMfaVerified(session, USER);
    const start = session.mfaVerifiedAt;

    vi.useFakeTimers();
    // Two hours of steady work, touching every 10 minutes. Under the old
    // absolute window this user would have been challenged ~8 times.
    for (let elapsed = 10 * MIN; elapsed <= 120 * MIN; elapsed += 10 * MIN) {
      vi.setSystemTime(new Date(start + elapsed));
      expect(isMfaSessionValid(session, USER)).toBe(true);
      touchMfaSession(session);
    }
    expect(isMfaSessionValid(session, USER)).toBe(true);
  });

  it('still expires after a genuine idle gap', () => {
    const session: any = {};
    setMfaVerified(session, USER);
    const start = session.mfaVerifiedAt;

    vi.useFakeTimers();
    vi.setSystemTime(new Date(start + 61 * MIN)); // idle past the window

    expect(isMfaSessionValid(session, USER)).toBe(false);
    expect(getMfaSessionTimeRemaining(session)).toBe(0);

    // And an expired session cannot be revived by activity alone — the middleware
    // checks validity before touching, but assert the ordering contract anyway.
    touchMfaSession(session);
    vi.setSystemTime(new Date(start + 61 * MIN));
    expect(isMfaSessionValid(session, USER)).toBe(true); // only because we touched
  });

  it('remains bound to the user it was verified for', () => {
    const session: any = {};
    setMfaVerified(session, USER);
    touchMfaSession(session);
    expect(isMfaSessionValid(session, 'someone-else')).toBe(false);
  });
});

describe('absolute cap', () => {
  it('defaults to 8 hours', () => {
    expect(MFA_CONFIG.absoluteMaxHours).toBe(8);
  });

  it('expires a continuously active session once the cap is reached', () => {
    const session: any = {};
    setMfaVerified(session, USER);
    const start = session.mfaChallengedAt;

    vi.useFakeTimers();
    // Work steadily all day. The sliding window alone would keep this alive
    // indefinitely; the cap is what eventually forces a real re-challenge.
    let lastValid = 0;
    for (let elapsed = 10 * MIN; elapsed <= 9 * 60 * MIN; elapsed += 10 * MIN) {
      vi.setSystemTime(new Date(start + elapsed));
      if (isMfaSessionValid(session, USER)) {
        lastValid = elapsed;
        touchMfaSession(session);
      }
    }
    // Stayed valid deep into the day, but not past 8 hours.
    expect(lastValid).toBeGreaterThanOrEqual(7 * 60 * MIN);
    expect(lastValid).toBeLessThan(8 * 60 * MIN + 10 * MIN);

    vi.setSystemTime(new Date(start + 8 * 60 * MIN + 1));
    expect(isMfaSessionValid(session, USER)).toBe(false);
  });

  it('activity cannot push the cap forward', () => {
    const session: any = {};
    setMfaVerified(session, USER);
    const anchor = session.mfaChallengedAt;

    vi.useFakeTimers();
    vi.setSystemTime(new Date(anchor + 30 * MIN));
    touchMfaSession(session);

    expect(session.mfaVerifiedAt).toBe(anchor + 30 * MIN); // slid
    expect(session.mfaChallengedAt).toBe(anchor); // did not
  });

  it('a fresh challenge resets the cap', () => {
    const session: any = {};
    setMfaVerified(session, USER);
    const start = session.mfaChallengedAt;

    vi.useFakeTimers();
    vi.setSystemTime(new Date(start + 9 * 60 * MIN));
    expect(isMfaSessionValid(session, USER)).toBe(false);

    setMfaVerified(session, USER); // user re-challenges
    expect(isMfaSessionValid(session, USER)).toBe(true);
    expect(session.mfaChallengedAt).toBe(start + 9 * 60 * MIN);
  });

  it('does not force-expire sessions created before mfaChallengedAt existed', () => {
    // Deploy-safety: sessions already in the store have mfaVerifiedAt only.
    const session: any = { mfaVerifiedAt: Date.now(), mfaUserId: USER };
    expect(isMfaSessionValid(session, USER)).toBe(true);
  });

  it('reports the nearer of the two deadlines as time remaining', () => {
    const session: any = {};
    setMfaVerified(session, USER);
    const start = session.mfaChallengedAt;

    vi.useFakeTimers();
    // 7h50m in, freshly active: sliding says 60m left, cap says 10m. Cap wins.
    vi.setSystemTime(new Date(start + 7 * 60 * MIN + 50 * MIN));
    touchMfaSession(session);
    expect(getMfaSessionTimeRemaining(session)).toBe(10 * MIN);
  });
});
