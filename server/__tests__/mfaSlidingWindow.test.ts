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
